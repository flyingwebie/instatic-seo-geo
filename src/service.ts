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
});

export class PublicationService {
  readonly api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  };
  private running = false;
  private indexNowTail: Promise<void> = Promise.resolve();
  private cachedInventory?: { revision: string; routes: PublishedRoute[] };
  constructor(api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  }) {
    this.api = api;
  }

  invalidate(): void {
    this.cachedInventory = undefined;
  }
  configuration(): { origin: string; options: SiteOptions; llms: boolean } {
    return {
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
        pages: [],
      };
    const state = await this.current();
    const pending = await this.state("pending", PendingSchema);
    const audit = auditSite(state.pages, state.origin, state.options);
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
      pages: state.pages.map((page) => ({
        path: page.path,
        title: page.title,
        canonical: page.canonical,
        indexable: page.indexable,
        lastModified: page.dateModified,
      })),
    };
  }

  /** One resumable, serialized batch. The current pointer is committed last. */
  async rebuild(
    force = false,
  ): Promise<{ done: boolean; offset: number; total: number }> {
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
            `Published HTML exceeds the alpha 1 MiB per-page processing limit: ${route.path}`,
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
            "Generation exceeds the alpha 24 MiB document budget. Restrict the published collection allowlist.",
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
        return { done: false, offset: pending.offset, total: pending.total };
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
        return { done: false, offset: pending.offset, total: pending.total };
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
  async publicFile(path: string) {
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
