import { Type, type TSchema } from "@sinclair/typebox";
import {
  PublicationListResultSchema,
  PublishedDocumentSchema,
  StorageListResultSchema,
  type ServerPluginApi,
  type PublishedRoute,
} from "#instatic-sdk";
import { parseOptions, siteOrigin, validate, type SiteOptions } from "./config";
import {
  GeneratedPageSchema,
  generateDocument,
  fingerprint,
  type GeneratedPage,
} from "./page";
import {
  contentZip,
  eligibleTranslations,
  llmsTxt,
  markdownPath,
  redirectsFor,
  robotsTxt,
  sitemapFiles,
} from "./discovery";
import {
  append,
  attribute,
  elements,
  escapeHtml,
  parsePage,
  remove,
  serializePage,
} from "./html";
import { auditSite } from "./audit";
import { HistorySchema, type HistoryPoint } from "./adminSchemas";
import {
  OG_PATH,
  fromBase64,
  ogJobs,
  ogKey,
  renderOgPng,
  toBase64,
  usesGenerated,
} from "./og/images";
import { decodeLogo, logoHash, type LogoUpload } from "./og/logo";
import type { Bitmap } from "./og/raster";
import {
  OG_HEIGHT,
  OG_WIDTH,
  ogData,
  parseOgTemplate,
  resolveTemplate,
  type OgTemplate,
} from "./og/template";
import { VisibilityReportSchema, type VisibilityReport } from "./integrations";

const RedirectSchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  status: Type.Union([Type.Literal(301), Type.Literal(308)]),
});
const GenerationSchema = Type.Object({
  id: Type.String(),
  revision: Type.String(),
  configuration: Type.String(),
  origin: Type.String(),
  routes: Type.Array(Type.String()),
  completedAt: Type.String(),
  siteName: Type.String(),
  redirects: Type.Array(RedirectSchema),
});
const PendingSchema = Type.Object({
  id: Type.String(),
  revision: Type.String(),
  configuration: Type.String(),
  origin: Type.String(),
  offset: Type.Integer(),
  total: Type.Integer(),
  siteName: Type.String(),
  htmlOffset: Type.Integer(),
  bytes: Type.Integer(),
  imageOffset: Type.Optional(Type.Integer()),
});
/** Stored social images: content key -> storage record id. */
const OgIndexSchema = Type.Record(Type.String(), Type.String());
/** Uploaded logos: hash -> upload time (ms). */
const LogoIndexSchema = Type.Record(Type.String(), Type.Number());
const StoredLogoSchema = Type.Object({
  name: Type.String(),
  width: Type.Integer(),
  height: Type.Integer(),
  data: Type.String(),
});

export class PublicationService {
  readonly api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  };
  private running = false;
  private indexNowTail: Promise<void> = Promise.resolve();
  private cachedInventory?: { revision: string; routes: PublishedRoute[] };
  private logoCache = new Map<string, Bitmap | null>();
  constructor(api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  }) {
    this.api = api;
  }

  invalidate(): void {
    this.cachedInventory = undefined;
  }
  /** The saved social-image design; an unreadable one counts as switched off. */
  ogTemplate(): OgTemplate {
    try {
      return parseOgTemplate(this.api.cms.settings.get("ogTemplate"));
    } catch (error) {
      console.error("[plugin:instatic.seo-geo] Social image template:", error);
      return {};
    }
  }
  /** Store a logo prepared in the admin; returns its content hash. */
  async saveLogo(upload: LogoUpload) {
    decodeLogo(upload); // Validates the pixels before anything is stored.
    const hash = await logoHash(upload);
    await this.save("og-logo:" + hash, upload);
    const index = (await this.state("og-logos", LogoIndexSchema)) ?? {};
    index[hash] = Date.now();
    await this.save("og-logos", index);
    return { hash, width: upload.width, height: upload.height };
  }
  async logo(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    return (await this.state("og-logo:" + hash, StoredLogoSchema)) ?? null;
  }
  /** Decoded logo pixels, cached for the life of the worker. */
  private async logoBitmap(template: OgTemplate): Promise<Bitmap | undefined> {
    const hash = template.logo?.hash;
    if (!hash) return undefined;
    if (!this.logoCache.has(hash)) {
      const stored = await this.logo(hash);
      this.logoCache.set(hash, stored ? decodeLogo(stored) : null);
    }
    return this.logoCache.get(hash) ?? undefined;
  }
  async ogIndex(): Promise<Record<string, string>> {
    return (await this.state("og-index", OgIndexSchema)) ?? {};
  }
  /** Section (collection) per route id, used for the badge on each image. */
  private sections(routes: readonly PublishedRoute[]) {
    return new Map(routes.map((route) => [route.id, route.tableSlug ?? ""]));
  }
  /** Serve a stored social image. Names are content hashes, so they cache forever. */
  async ogFile(key: string) {
    const id = (await this.ogIndex())[key];
    const record = id
      ? (await this.records("images", { key }))[0]
      : undefined;
    if (!record || typeof record.data.content !== "string")
      return {
        __response: true,
        status: 404,
        headers: { "Cache-Control": "no-store" },
        body: "Not found",
      };
    return {
      __response: true,
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
      body: fromBase64(record.data.content),
    };
  }
  configuration(): {
    origin: string;
    options: SiteOptions;
    llms: boolean;
    format: number;
    analytics?: string;
    ogTemplate?: string;
  } {
    const analytics = (this.api.cms.settings.get("analytics") ?? "").trim();
    const ogTemplate = (this.api.cms.settings.get("ogTemplate") ?? "").trim();
    return {
      ...(ogTemplate && ogTemplate !== "{}" ? { ogTemplate } : {}),
      // Tags change published HTML, so they take part in the fingerprint.
      // Blank keeps existing fingerprints stable for sites without tags.
      ...(analytics && analytics !== "{}" ? { analytics } : {}),
      // Changing generation semantics invalidates exports, including after a plugin upgrade.
      format: 2,
      origin: siteOrigin(this.api.cms.settings.get("siteUrl") ?? ""),
      options: parseOptions(this.api.cms.settings.get("options") ?? "{}"),
      llms: this.api.cms.settings.get<boolean>("llmsEnabled") === true,
    };
  }
  private async records(resource: string, filter: Record<string, string> = {}) {
    const collection = this.api.cms.storage.collection(resource);
    const first = validate(
      StorageListResultSchema,
      await collection.list({ filter, limit: 1000 }),
    );
    const records = [...first.records];
    for (let offset = 1000; offset < first.totalCount; offset += 1000)
      records.push(
        ...validate(
          StorageListResultSchema,
          await collection.list({ filter, limit: 1000, offset }),
        ).records,
      );
    return records;
  }
  private async state<T extends TSchema>(
    key: string,
    schema: T,
  ): Promise<import("@sinclair/typebox").Static<T> | undefined> {
    const record = (await this.records("state", { key }))[0];
    if (!record) return undefined;
    if (typeof record.data.value !== "string")
      throw new Error("Corrupt generation state");
    return validate(schema, JSON.parse(record.data.value), key);
  }
  private async save(key: string, value: unknown): Promise<void> {
    const collection = this.api.cms.storage.collection("state");
    const previous = (await this.records("state", { key }))[0];
    const data = { key, value: JSON.stringify(value) };
    if (previous) await collection.update(previous.id, data);
    else await collection.create(data);
  }
  private async clear(key: string): Promise<void> {
    for (const record of await this.records("state", { key }))
      await this.api.cms.storage.collection("state").delete(record.id);
  }
  private async pages(generation: string): Promise<GeneratedPage[]> {
    return (await this.records("documents", { generation })).map((record) => {
      if (typeof record.data.content !== "string")
        throw new Error("Corrupt generated document");
      return validate(
        GeneratedPageSchema,
        JSON.parse(record.data.content),
        "document",
      );
    });
  }
  async inventory() {
    const first = validate(
      PublicationListResultSchema,
      await this.api.cms.publication.list({ limit: 200 }),
    );
    if (this.cachedInventory?.revision === first.revision)
      return { ...first, routes: this.cachedInventory.routes };
    const routes = [...first.routes];
    for (let offset = 200; offset < first.totalCount; offset += 200)
      routes.push(
        ...validate(
          PublicationListResultSchema,
          await this.api.cms.publication.list({
            offset,
            limit: 200,
            revision: first.revision,
          }),
        ).routes,
      );
    this.cachedInventory = { revision: first.revision, routes };
    return { ...first, routes };
  }
  async current() {
    const config = this.configuration();
    const configuration = await fingerprint(config);
    const inventory = await this.inventory();
    const generation = await this.state("current", GenerationSchema);
    const pages =
      generation && generation.configuration === configuration
        ? (await this.pages(generation.id)).filter((page) =>
            inventory.routes.some(
              (route) =>
                route.id === page.id &&
                route.path === page.path &&
                route.revision === page.revision,
            ),
          )
        : [];
    await this.api.cms.publication.list({
      limit: 1,
      revision: inventory.revision,
    });
    if ((await fingerprint(this.configuration())) !== configuration)
      throw new Error("Configuration changed while reading exports; retry.");
    return { ...config, configuration, inventory, generation, pages };
  }
  async status() {
    if (!this.api.cms.settings.get("siteUrl"))
      return {
        configured: false,
        stage: "configuration",
        total: 0,
        generated: 0,
        indexable: 0,
        pending: false,
        completedAt: "",
        findings: [],
        suggestions: [],
        siteName: "",
        pages: [],
      };
    const state = await this.current();
    const pending = await this.state("pending", PendingSchema);
    const audit = auditSite(state.pages, state.origin, state.options);
    const sections = this.sections(state.inventory.routes);
    // Generated card URL per page, only for images that exist.
    const ogImages = new Map<string, string>();
    const template = this.ogTemplate();
    if (resolveTemplate(template).enabled && state.generation) {
      const stored = await this.ogIndex();
      for (const job of await ogJobs(template, state.pages, state.generation.siteName, sections))
        if (stored[job.key]) ogImages.set(job.path, `${state.origin}/og/${job.key}.png`);
    }
    return {
      configured: true,
      stage: pending
        ? "generating"
        : state.generation
          ? "ready"
          : "configuration",
      total: state.inventory.totalCount,
      generated: state.pages.length,
      indexable: state.pages.filter((page) => page.indexable).length,
      pending: !!pending,
      completedAt: state.generation?.completedAt ?? "",
      ...audit,
      siteName: state.generation?.siteName ?? "",
      pages: state.pages.map((page) => ({
        path: page.path,
        title: page.title,
        canonical: page.canonical,
        indexable: page.indexable,
        lastModified: page.dateModified,
        description: page.description,
        datePublished: page.datePublished,
        section: sections.get(page.id) ?? "",
        socialImage: page.socialImage ?? "none",
        ...(ogImages.has(page.path) ? { ogImage: ogImages.get(page.path) } : {}),
        ...(page.aio ? { aio: page.aio } : {}),
      })),
    };
  }

  /** One resumable, serialized batch. The current pointer is committed last. */
  async rebuild(
    force = false,
  ): Promise<{
    done: boolean;
    offset: number;
    total: number;
    phase?: string;
    refreshed?: number;
    images?: number;
    imageTotal?: number;
  }> {
    if (this.running)
      throw new Error("A generation batch is already running; retry shortly.");
    this.running = true;
    try {
      const config = this.configuration(),
        configuration = await fingerprint(config);
      const inventory = await this.inventory();
      const allowedRoutes = inventory.routes.filter(
        (route) =>
          route.kind === "page" ||
          (config.options.collectionTables ?? ["posts"]).includes(
            route.tableSlug,
          ),
      );
      const current = await this.state("current", GenerationSchema);
      let pending = await this.state("pending", PendingSchema);
      if (
        !pending &&
        !force &&
        current?.revision === inventory.revision &&
        current.configuration === configuration
      )
        return {
          done: true,
          offset: allowedRoutes.length,
          total: allowedRoutes.length,
        };
      if (
        !pending ||
        pending.revision !== inventory.revision ||
        pending.configuration !== configuration
      ) {
        pending = {
          id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
          revision: inventory.revision,
          configuration,
          origin: config.origin,
          offset: 0,
          total: allowedRoutes.length,
          siteName: "",
          htmlOffset: 0,
          bytes: 0,
          imageOffset: 0,
        };
        await this.save("pending", pending);
      }
      pending.bytes = (
        await this.records("documents", { generation: pending.id })
      ).reduce(
        (total, record) =>
          total +
          new TextEncoder().encode(String(record.data.content ?? "")).length,
        0,
      );
      const previous = current ? await this.pages(current.id) : [];
      const routes = allowedRoutes.slice(pending.offset, pending.offset + 3);
      for (const route of routes) {
        const raw = await this.api.cms.publication.render({
          path: route.path,
          origin: config.origin,
          revision: pending.revision,
        });
        if (!raw)
          throw new Error(
            "A published route disappeared during generation. Retry the rebuild.",
          );
        const document = validate(PublishedDocumentSchema, raw);
        if (new TextEncoder().encode(document.html).byteLength > 1024 * 1024)
          throw new Error(
            `Published HTML exceeds the 1 MiB per-page processing limit: ${route.path}`,
          );
        const { page } = await generateDocument(
          document,
          config.origin,
          config.options,
          configuration,
          inventory.routes,
          previous.find((page) => page.id === route.id),
        );
        const content = JSON.stringify(page);
        const collection = this.api.cms.storage.collection("documents");
        const existing = (
          await this.records("documents", {
            generation: pending.id,
            path: route.path,
          })
        )[0];
        pending.bytes +=
          new TextEncoder().encode(content).length -
          (existing
            ? new TextEncoder().encode(String(existing.data.content ?? ""))
                .length
            : 0);
        if (pending.bytes > 24 * 1024 * 1024)
          throw new Error(
            "Generation exceeds the 24 MiB document budget. Restrict the published collection allowlist.",
          );
        if (existing)
          await collection.update(existing.id, {
            generation: pending.id,
            path: route.path,
            content,
          });
        else
          await collection.create({
            generation: pending.id,
            path: route.path,
            content,
          });
        pending.offset++;
        pending.siteName = document.siteName;
        await this.save("pending", pending);
      }
      if (pending.offset < allowedRoutes.length)
        return {
          done: false,
          offset: pending.offset,
          total: pending.total,
          phase: "documents",
          refreshed: pending.htmlOffset,
        };
      // Social images render between documents and the HTML refresh, so
      // refreshed pages can point at images that already exist.
      const template = this.ogTemplate();
      if (resolveTemplate(template).enabled) {
        const jobs = await ogJobs(
          template,
          await this.pages(pending.id),
          pending.siteName,
          this.sections(inventory.routes),
        );
        const first = pending.imageOffset ?? 0;
        // Rendering takes about a second in the sandbox; start a fresh
        // request after the documents batch and stop well inside the budget.
        const started = Date.now();
        let index = first;
        if (!routes.length) {
          const stored = await this.ogIndex();
          const logo = await this.logoBitmap(template);
          let last = 0;
          while (index < jobs.length) {
            // Predict the next render from the last one so a request never
            // runs past the sandbox's per-call budget.
            if (index > first && Date.now() - started + last > 2800) break;
            const job = jobs[index]!;
            if (!stored[job.key]) {
              const renderStart = Date.now();
              const png = renderOgPng(template, job.data, logo);
              last = Date.now() - renderStart;
              const record = await this.api.cms.storage
                .collection("images")
                .create({ key: job.key, content: toBase64(png) });
              stored[job.key] = record.id;
              await this.save("og-index", stored);
            }
            index++;
          }
          if (index !== first) {
            pending.imageOffset = index;
            await this.save("pending", pending);
          }
        }
        if (index < jobs.length)
          return {
            done: false,
            offset: pending.offset,
            total: pending.total,
            phase: "images",
            refreshed: pending.htmlOffset,
            images: index,
            imageTotal: jobs.length,
          };
      }
      // Re-render only existing published versions, in small batches, before
      // exposing the new export pointer. Drafts never enter this pipeline.
      const refresh = allowedRoutes
        .slice(pending.htmlOffset, pending.htmlOffset + 3)
        .map((route) => route.path);
      if (refresh.length) {
        await this.api.cms.publication.refresh({
          paths: refresh,
          origin: config.origin,
          revision: pending.revision,
        });
        pending.htmlOffset += refresh.length;
        await this.save("pending", pending);
      }
      if (pending.htmlOffset < allowedRoutes.length)
        return {
          done: false,
          offset: pending.offset,
          total: pending.total,
          phase: "html",
          refreshed: pending.htmlOffset,
        };
      const check = validate(
        PublicationListResultSchema,
        await this.api.cms.publication.list({
          limit: 1,
          revision: pending.revision,
        }),
      );
      if (
        check.revision !== pending.revision ||
        (await fingerprint(this.configuration())) !== configuration
      )
        throw new Error(
          "Publication or configuration changed; restart generation.",
        );
      const pages = await this.pages(pending.id);
      const redirects = redirectsFor(
        config.options,
        previous,
        pages,
        current?.redirects,
      );
      // Validate discovery files before committing, retaining the old pointer
      // if any XML size or redirect validation fails.
      sitemapFiles(pages, config.origin, config.options);
      const committed = pending;
      await this.serializeIndexNow(async () => {
        await this.api.cms.publication.list({
          limit: 1,
          revision: committed.revision,
        });
        if ((await fingerprint(this.configuration())) !== configuration)
          throw new Error(
            "Configuration changed before generation commit; retry.",
          );
        const queued = await this.indexNowQueue();
        await this.save("indexnow-queue", {
          urls: [
            ...new Set([
              ...queued.urls,
              ...pages
                .filter(
                  (page) =>
                    page.indexable &&
                    !previous.some(
                      (old) =>
                        old.path === page.path &&
                        old.contentHash === page.contentHash,
                    ),
                )
                .map((page) => page.canonical),
              ...previous
                .filter(
                  (old) =>
                    old.indexable &&
                    !pages.some(
                      (page) => page.indexable && page.path === old.path,
                    ),
                )
                .map((page) => page.canonical),
            ]),
          ],
          attempts: queued.attempts,
          nextAttempt: queued.nextAttempt,
        });
        await this.save("current", {
          id: committed.id,
          revision: committed.revision,
          configuration,
          origin: config.origin,
          routes: pages.map((page) => page.path),
          completedAt: new Date().toISOString(),
          siteName: committed.siteName,
          redirects,
        });
        await this.clear("pending");
      });
      return { done: true, offset: pages.length, total: pages.length };
    } finally {
      this.running = false;
    }
  }
  async cleanup(): Promise<void> {
    const current = await this.state("current", GenerationSchema),
      pending = await this.state("pending", PendingSchema);
    const records = await this.api.cms.storage.collection("documents").list({
      filter: current ? { generation: { ne: current.id } } : {},
      limit: 100,
    });
    for (const record of validate(StorageListResultSchema, records).records)
      if (
        record.data.generation !== current?.id &&
        record.data.generation !== pending?.id
      )
        await this.api.cms.storage.collection("documents").delete(record.id);
    await this.cleanupImages(current, pending);
    await this.cleanupLogos(this.ogTemplate());
  }
  /** Remove social images no page uses any more (after a design or text change). */
  private async cleanupImages(
    current: { id: string; siteName: string } | undefined,
    pending: { id: string } | undefined,
  ) {
    const index = await this.ogIndex();
    if (!Object.keys(index).length || pending) return;
    const template = this.ogTemplate();
    const keep = new Set<string>();
    if (current && resolveTemplate(template).enabled) {
      const inventory = await this.inventory();
      for (const job of await ogJobs(
        template,
        await this.pages(current.id),
        current.siteName,
        this.sections(inventory.routes),
      ))
        keep.add(job.key);
    }
    let changed = false;
    for (const [key, id] of Object.entries(index)) {
      if (keep.has(key)) continue;
      await this.api.cms.storage.collection("images").delete(id);
      delete index[key];
      changed = true;
    }
    if (changed) await this.save("og-index", index);
  }
  /** Drop logos the saved design no longer uses, after a day's grace for unsaved picks. */
  private async cleanupLogos(template: OgTemplate) {
    const index = (await this.state("og-logos", LogoIndexSchema)) ?? {};
    let changed = false;
    for (const [hash, uploaded] of Object.entries(index)) {
      if (hash === template.logo?.hash || Date.now() - uploaded < 86400000) continue;
      await this.clear("og-logo:" + hash);
      delete index[hash];
      this.logoCache.delete(hash);
      changed = true;
    }
    if (changed) await this.save("og-logos", index);
  }
  /** Daily site-health snapshots, oldest first, for trend charts. */
  async history(): Promise<HistoryPoint[]> {
    return (await this.state("history", HistorySchema)) ?? [];
  }
  /**
   * Record today's health once a day, or refresh it after a manual
   * generation. Keeps a rolling year so the chart shows long-term progress.
   */
  async recordSnapshot(force = false): Promise<void> {
    const status = await this.status();
    if (!status.configured || !status.generated) return;
    const date = new Date().toISOString().slice(0, 10);
    const history = await this.history();
    if (!force && history.at(-1)?.date === date) return;
    const aio = status.pages.filter((page) => page.aio);
    const point: HistoryPoint = {
      date,
      total: status.total,
      generated: status.generated,
      indexable: status.indexable,
      errors: status.findings.filter((f) => f.severity === "error").length,
      warnings: status.findings.filter((f) => f.severity === "warning").length,
      notices: status.findings.filter((f) => f.severity === "info").length,
      aioReviewed: aio.length,
      aioReady: aio.filter((page) =>
        page.aio!.checks.every((check) => check.status === "pass"),
      ).length,
    };
    await this.save(
      "history",
      [...history.filter((entry) => entry.date !== date), point].slice(-366),
    );
  }
  async lastReport(provider: string): Promise<VisibilityReport | null> {
    return (
      (await this.state("report:" + provider, VisibilityReportSchema)) ?? null
    );
  }
  async saveReport(report: VisibilityReport): Promise<void> {
    await this.save("report:" + report.provider, report);
  }
  async enrich(
    html: string,
    context: {
      urlPath: string;
      pageId: string;
      contentId?: string;
      tableSlug?: string;
      publishedAt?: string;
      firstPublishedAt?: string;
    },
  ) {
    if (!this.api.cms.settings.get("siteUrl")) return html;
    const config = this.configuration(),
      configuration = await fingerprint(config);
    const generation = await this.state("current", GenerationSchema);
    const pending = await this.state("pending", PendingSchema);
    const generated =
      pending?.offset === pending?.total &&
      pending?.configuration === configuration
        ? await this.pages(pending.id)
        : generation
          ? await this.pages(generation.id)
          : [];
    const previous = generated.find(
      (page) => page.id === (context.contentId ?? context.pageId),
    );
    const inventory = await this.inventory();
    // Emit reciprocal alternates only for eligible documents in a completed
    // stage. Before the first generation, the audit will explain missing groups.
    const route: PublishedRoute = {
      path: context.urlPath,
      id: context.contentId ?? context.pageId,
      kind: context.tableSlug ? "entry" : "page",
      tableSlug: context.tableSlug ?? "pages",
      title: "",
      revision: "",
      publishedAt: context.publishedAt ?? "",
      firstPublishedAt:
        context.firstPublishedAt ??
        previous?.datePublished ??
        context.publishedAt ??
        "",
    };
    const enriched = await generateDocument(
      {
        route,
        html,
        siteId: "",
        siteName: pending?.siteName || generation?.siteName || "",
        language: "",
        revision: "",
        version: 0,
      },
      config.origin,
      config.options,
      configuration,
      inventory.routes,
      previous,
    );
    const parsed = parsePage(enriched.html);
    for (const link of elements(parsed.head, "link").filter((node) =>
      attribute(node, "hreflang"),
    ))
      remove(link);
    for (const link of elements(parsed.head, "link").filter(
      (node) => attribute(node, "type") === "text/markdown",
    ))
      remove(link);
    if (
      previous?.indexable &&
      previous.configuration === configuration &&
      inventory.routes.some(
        (item) =>
          item.id === previous.id &&
          item.path === previous.path &&
          item.revision === previous.revision,
      )
    ) {
      append(
        parsed.head,
        '<link rel="alternate" type="text/markdown" href="' +
          escapeHtml(config.origin + markdownPath(context.urlPath)) +
          '">',
      );
    }
    await this.applySocialImage(parsed.head, previous, context.tableSlug, {
      origin: config.origin,
      siteName: pending?.siteName || generation?.siteName || "",
    });
    const group =
      eligibleTranslations(generated, config.options).find((group) =>
        group.some((entry) => entry.path === context.urlPath),
      ) ?? [];
    for (const entry of group)
      append(
        parsed.head,
        '<link rel="alternate" hreflang="' +
          escapeHtml(entry.language) +
          '" href="' +
          escapeHtml(new URL(entry.path, config.origin).href) +
          '">',
      );
    return serializePage(parsed.document);
  }
  /**
   * Point og:image / twitter:image at the generated card when the design is on
   * and this page should use it. Pages keep their own image otherwise.
   */
  private async applySocialImage(
    head: ReturnType<typeof parsePage>["head"],
    page: GeneratedPage | undefined,
    tableSlug: string | undefined,
    site: { origin: string; siteName: string },
  ) {
    const raw = this.ogTemplate();
    const template = resolveTemplate(raw);
    if (!page || !usesGenerated(template, page)) return;
    const data = ogData(template, { ...page, tableSlug }, site.siteName);
    const key = await ogKey(template, data);
    if (!(await this.ogIndex())[key]) return; // Not rendered yet; keep the page's tags.
    for (const node of elements(head, "meta")) {
      const name = attribute(node, "property") ?? attribute(node, "name") ?? "";
      if (/^og:image(:|$)/.test(name) || name === "twitter:image" || name === "twitter:card" || name === "twitter:image:alt")
        remove(node);
    }
    const url = escapeHtml(`${site.origin}/og/${key}.png`);
    const alt = escapeHtml(data.title);
    append(
      head,
      `<meta property="og:image" content="${url}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="${OG_WIDTH}"><meta property="og:image:height" content="${OG_HEIGHT}"><meta property="og:image:alt" content="${alt}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${url}"><meta name="twitter:image:alt" content="${alt}">`,
    );
  }
  async publicFile(path: string) {
    const og = OG_PATH.exec(path);
    if (og) return this.ogFile(og[1]!);
    const notFound = {
      __response: true,
      status: 404,
      body: "Not found",
      headers: { "Cache-Control": "no-store" },
    };
    if (!this.api.cms.settings.get("siteUrl")) return notFound;
    const state = await this.current();
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const key = this.api.cms.settings.get("indexNowKey") ?? "";
    if (
      this.api.cms.settings.get<boolean>("indexNowEnabled") &&
      /^[a-zA-Z0-9-]{8,128}$/.test(key) &&
      path === "/" + key + ".txt"
    )
      return {
        __response: true,
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        body: key,
      };
    if (path === "/robots.txt")
      return {
        __response: true,
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        body: robotsTxt(state.origin, state.options),
      };
    const managed =
      path === "/sitemap.xml" ||
      path === "/robots.txt" ||
      (path === "/llms.txt" && state.llms) ||
      /^\/sitemaps\/\d+\.xml$/.test(path) ||
      path.startsWith("/markdown/");
    if (
      !managed &&
      !state.generation?.redirects.some((redirect) => redirect.from === path) &&
      !state.options.redirects?.some((redirect) => redirect.from === path)
    )
      return notFound;
    if (
      !state.generation ||
      state.generation.configuration !== state.configuration
    )
      return {
        __response: true,
        status: 503,
        headers: { ...headers, "Retry-After": "60" },
        body: "SEO generation is pending. Run Generate in the plugin admin page.",
      };
    const redirect = redirectsFor(
      state.options,
      [],
      state.pages,
      state.generation.redirects,
    ).find((redirect) => redirect.from === path);
    if (redirect)
      return {
        __response: true,
        status: redirect.status,
        headers: { ...headers, Location: state.origin + redirect.to },
        body: "",
      };
    const page = state.pages.find(
      (page) => page.indexable && markdownPath(page.path) === path,
    );
    if (page)
      return {
        __response: true,
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/markdown; charset=utf-8",
          ETag: '"' + page.contentHash + '"',
          "X-Robots-Tag": "noindex",
          Link: `<${page.canonical}>; rel="canonical"`,
        },
        body: page.markdown,
      };
    if (path === "/llms.txt" && state.llms)
      return {
        __response: true,
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        body: llmsTxt(state.pages, state.generation.siteName),
      };
    if (path === "/sitemap.xml" || /^\/sitemaps\/\d+\.xml$/.test(path)) {
      const body = sitemapFiles(state.pages, state.origin, state.options)[path];
      if (body)
        return {
          __response: true,
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "application/xml; charset=utf-8",
          },
          body,
        };
    }
    return notFound;
  }
  async download() {
    const state = await this.current();
    if (
      !state.generation ||
      state.generation.configuration !== state.configuration
    )
      throw new Error("Generate current content before downloading.");
    return {
      __response: true,
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="seo-geo-content.zip"',
        "Cache-Control": "no-store",
      },
      body: contentZip(
        state.pages,
        state.origin,
        state.options,
        state.generation.id,
      ),
    };
  }
  /** Serialize submissions with generation commits so acknowledgements never erase new changes. */
  async serializeIndexNow<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.indexNowTail;
    let release: () => void = () => {};
    this.indexNowTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
  async indexNowQueue() {
    return (
      (await this.state(
        "indexnow-queue",
        Type.Object({
          urls: Type.Array(Type.String()),
          attempts: Type.Integer(),
          nextAttempt: Type.Number(),
        }),
      )) ?? { urls: [], attempts: 0, nextAttempt: 0 }
    );
  }
  async saveIndexNowQueue(value: {
    urls: string[];
    attempts: number;
    nextAttempt: number;
  }) {
    await this.save("indexnow-queue", value);
  }
}
