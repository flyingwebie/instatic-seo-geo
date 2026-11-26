import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  PublicationListResultSchema,
  PublishedDocumentSchema,
  StorageListResultSchema,
  type ServerPluginApi,
  type PublishedRoute,
} from "#instatic-sdk";
import {
  parseOptions,
  siteOrigin,
  validate,
  type Finding,
  type SiteOptions,
} from "./config";
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
  type Redirect,
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
import {
  AttemptSchema,
  AutomationSchema,
  MAX_ATTEMPTS,
  SkippedSchema,
  deriveLifecycle,
  describeError,
  type Automation,
  type Lifecycle,
  type Skipped,
} from "./lifecycle";

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
  /** Fingerprint of the settings that decide the exports. Absent in generations stored by earlier versions. */
  exports: Type.Optional(Type.String()),
  skipped: Type.Optional(Type.Array(SkippedSchema)),
});
type Generation = Static<typeof GenerationSchema>;
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
  exports: Type.Optional(Type.String()),
  attempt: Type.Optional(AttemptSchema),
  skipped: Type.Optional(Type.Array(SkippedSchema)),
  /** A social image ran out of time on this server; encode the rest the fast way. */
  fastImages: Type.Optional(Type.Boolean()),
  /** Even the fast way ran out of time in a request; leave images to the scheduled job. */
  slowImages: Type.Optional(Type.Boolean()),
});
type Pending = Static<typeof PendingSchema>;

/** A batch that stopped answering is replaced after this long. */
const LEASE_MS = 90_000;
/** Cached reads are also dropped after this long, in case another process wrote. */
const CACHE_TTL_MS = 30_000;
/** Image rendering stops this long after a batch started, inside the host's 5 s limit. */
const IMAGE_BUDGET_MS = 3000;
/** The scheduled job records that it ran at most this often. */
const HEARTBEAT_MS = 5 * 60_000;
const STEP_KILLED =
  "The step did not finish within the server's time or memory limit.";
/** What the sandbox throws when a step runs past the host's time limit. */
const isTimeout = (message: string | undefined) =>
  !message || message === "interrupted" || message.startsWith(STEP_KILLED);

export type Progress = {
  done: boolean;
  offset: number;
  total: number;
  phase?: string;
  refreshed?: number;
  images?: number;
  imageTotal?: number;
  /** Another batch holds the lock; the numbers describe its saved progress. */
  busy?: boolean;
  /** This step is left to the scheduled job, which has a longer time limit. */
  deferred?: boolean;
};
/** Who asked for a batch. Requests get 5 s per step from the host; the scheduled job far more. */
export type BatchSource = "manual" | "schedule";
type Lease = { since: number };
type Fingerprints = {
  config: ReturnType<PublicationService["configuration"]>;
  /** Every setting that changes published HTML or exports. */
  configuration: string;
  /** Only the settings that change the exports (sitemap, Markdown, llms.txt). */
  exports: string;
};
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

/** The routes a generation covers: every page, and entries of the selected collections. */
function includedRoutes(
  routes: readonly PublishedRoute[],
  options: SiteOptions,
): PublishedRoute[] {
  return routes.filter(
    (route) =>
      route.kind === "page" ||
      (options.collectionTables ?? ["posts"]).includes(route.tableSlug),
  );
}

/** A page or site is too large to process: the owner has to change content, not retry. */
export class ContentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentLimitError";
  }
}

function skippedFinding(item: Skipped): Finding {
  if (item.step === "redirects")
    return {
      code: "generation.redirects-reset",
      severity: "warning",
      path: item.path,
      message: item.message,
      fix: "Add the redirects you still need in Setup → Redirects.",
    };
  return item.step === "images"
    ? {
        code: "generation.image-skipped",
        severity: "warning",
        path: item.path,
        message: `The social image for this page could not be created: ${item.message}`,
        fix: "The page keeps its own sharing image. Shorten the title or simplify the design in Social images, then generate again.",
      }
    : {
        code: "generation.page-skipped",
        severity: "error",
        path: item.path,
        message: `This page was left out of the sitemap and exports: ${item.message}`,
        fix: "Open the page, fix the reported problem and publish it again. The next generation retries it.",
      };
}

export class PublicationService {
  readonly api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  };
  private lease?: Lease;
  private indexNowTail: Promise<void> = Promise.resolve();
  /** When the IndexNow operation now running took its turn (ms); 0 when none is. */
  private indexNowSince = 0;
  private cachedInventory?: { revision: string; routes: PublishedRoute[] };
  private logoCache = new Map<string, Bitmap | null>();
  /**
   * Stored state the publish.html filter reads for every page. A full publish
   * calls the filter once per page and entry, and each uncached read scans the
   * plugin's records and parses every generated document, so the cost grew
   * with pages x pages. Every storage write goes through `collection()`, which
   * empties this map, so a cached read never outlives the data it came from.
   */
  private readCache = new Map<string, { at: number; value: Promise<unknown> }>();
  constructor(api: {
    cms: Pick<ServerPluginApi["cms"], "settings" | "storage" | "publication">;
  }) {
    this.api = api;
  }

  invalidate(): void {
    this.cachedInventory = undefined;
    this.readCache.clear();
  }
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.readCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
    const promise = load();
    this.readCache.set(key, { at: Date.now(), value: promise });
    promise.catch(() => {
      if (this.readCache.get(key)?.value === promise) this.readCache.delete(key);
    });
    return promise;
  }
  /** Storage collection whose writes drop the read cache, before and after. */
  private collection(resource: string) {
    const collection = this.api.cms.storage.collection(resource);
    const write = async <T>(run: () => Promise<T>): Promise<T> => {
      this.readCache.clear();
      try {
        return await run();
      } finally {
        this.readCache.clear();
      }
    };
    return {
      list: (...args: Parameters<typeof collection.list>) =>
        collection.list(...args),
      create: (...args: Parameters<typeof collection.create>) =>
        write(() => collection.create(...args)),
      update: (...args: Parameters<typeof collection.update>) =>
        write(() => collection.update(...args)),
      delete: (...args: Parameters<typeof collection.delete>) =>
        write(() => collection.delete(...args)),
    };
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
      ...this.exportSettings(),
    };
  }
  /** The settings that decide what the sitemap, Markdown and llms.txt contain. */
  private exportSettings() {
    return {
      // Changing generation semantics invalidates exports, including after a plugin upgrade.
      format: 2,
      origin: siteOrigin(this.api.cms.settings.get("siteUrl") ?? ""),
      options: parseOptions(this.api.cms.settings.get("options") ?? "{}"),
      llms: this.api.cms.settings.get<boolean>("llmsEnabled") === true,
    };
  }
  /**
   * Two fingerprints, because settings fall in two groups. Analytics tags and
   * the social image design only change published HTML, so a generation made
   * before such a change still has valid exports and keeps serving them while
   * the pages are refreshed. Everything else changes the exports themselves.
   * With no tags and no design both fingerprints are equal, which is what
   * generations stored before the split recorded.
   */
  async fingerprints(): Promise<Fingerprints> {
    const config = this.configuration();
    return {
      config,
      configuration: await fingerprint(config),
      exports: await fingerprint(this.exportSettings()),
    };
  }
  /** Whether a generation's exports may be served under the settings saved now. */
  private servable(generation: Generation, live: Fingerprints): boolean {
    return generation.exports
      ? generation.exports === live.exports
      : generation.configuration === live.configuration ||
          generation.configuration === live.exports;
  }
  private async records(resource: string, filter: Record<string, string> = {}) {
    const collection = this.collection(resource);
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
    const collection = this.collection("state");
    const previous = (await this.records("state", { key }))[0];
    const data = { key, value: JSON.stringify(value) };
    if (previous) await collection.update(previous.id, data);
    else await collection.create(data);
  }
  private async clear(key: string): Promise<void> {
    for (const record of await this.records("state", { key }))
      await this.collection("state").delete(record.id);
  }
  /** A generation's documents. Cached: every public request and published page reads them. */
  private pages(generation: string): Promise<GeneratedPage[]> {
    return this.cached("pages:" + generation, async () =>
      (await this.records("documents", { generation })).map((record) => {
        if (typeof record.data.content !== "string")
          throw new Error("Corrupt generated document");
        return validate(
          GeneratedPageSchema,
          JSON.parse(record.data.content),
          "document",
        );
      }),
    );
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
    const live = await this.fingerprints();
    const { config, configuration } = live;
    const inventory = await this.inventory();
    const generation = await this.state("current", GenerationSchema);
    const servable = !!generation && this.servable(generation, live);
    const pages =
      generation && servable
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
    return {
      ...config,
      configuration,
      exports: live.exports,
      inventory,
      generation,
      pages,
      /** The generation's exports are valid for the settings saved now. */
      servable,
      /** The generation matches the published content and every setting. */
      fresh:
        !!generation &&
        generation.configuration === configuration &&
        generation.revision === inventory.revision,
    };
  }
  /** The lifecycle state, from the stored records. Never throws for bad settings. */
  private async lifecycle(
    state: Awaited<ReturnType<PublicationService["current"]>>,
    pending: Pending | undefined,
  ): Promise<Lifecycle> {
    return deriveLifecycle({
      configured: true,
      ...(state.generation
        ? {
            current: {
              servable: state.servable,
              fresh: state.fresh,
              skipped: state.generation.skipped,
            },
          }
        : {}),
      ...(pending
        ? {
            pending: {
              matches:
                pending.revision === state.inventory.revision &&
                pending.configuration === state.configuration,
              offset: pending.offset,
              htmlOffset: pending.htmlOffset,
              imageOffset: pending.imageOffset ?? 0,
              total: pending.total,
              attempt: pending.attempt,
              skipped: pending.skipped,
            },
          }
        : {}),
      automation: await this.state("automation", AutomationSchema),
      now: Date.now(),
    });
  }
  async status() {
    if (!this.api.cms.settings.get("siteUrl"))
      return {
        configured: false,
        stage: "configuration",
        total: 0,
        included: 0,
        generated: 0,
        indexable: 0,
        pending: false,
        completedAt: "",
        findings: [],
        suggestions: [],
        siteName: "",
        pages: [],
        lifecycle: deriveLifecycle({
          configured: false,
          automation: await this.state("automation", AutomationSchema),
          now: Date.now(),
        }),
      };
    const state = await this.current();
    const pending = await this.state("pending", PendingSchema);
    const lifecycle = await this.lifecycle(state, pending);
    const audit = auditSite(state.pages, state.origin, state.options);
    // Pages a run had to leave out are findings, so they show up in Checks.
    audit.findings.unshift(...lifecycle.skipped.map(skippedFinding));
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
      included: includedRoutes(state.inventory.routes, state.options).length,
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
      lifecycle,
    };
  }

  // ---------------------------------------------------------------------
  // Generation. One call runs one small batch; callers repeat until done.
  //
  //   documents -> images -> html -> commit
  //
  // Each step is counted before it runs (`pending.attempt`), so a step that
  // throws, times out or kills the sandbox is noticed on the next call. A page
  // or image that fails MAX_ATTEMPTS times is skipped and reported; refreshing
  // public HTML and the commit are never skipped. See docs/state-machines.md.
  // ---------------------------------------------------------------------

  /**
   * The batch lock. A plain flag stays set forever when the sandbox abandons
   * a batch mid-await, so the lock is a lease: a batch that has not finished
   * after LEASE_MS is treated as dead and replaced.
   */
  private acquire(): Lease | undefined {
    const now = Date.now();
    if (this.lease && now - this.lease.since < LEASE_MS) return undefined;
    return (this.lease = { since: now });
  }
  private release(lease: Lease): void {
    if (this.lease === lease) this.lease = undefined;
  }
  /** Stops a batch that outlived its lease from writing over its replacement. */
  private held(lease: Lease): void {
    if (this.lease !== lease)
      throw new Error("This generation batch was replaced by a newer one.");
  }
  /** Saved progress of the batch that holds the lock, for a caller that must wait. */
  private async busy(): Promise<Progress> {
    const pending = await this.state("pending", PendingSchema);
    return {
      done: false,
      busy: true,
      offset: pending?.offset ?? 0,
      total: pending?.total ?? 0,
      phase: pending?.attempt?.step.split(":")[0] ?? "documents",
      refreshed: pending?.htmlOffset ?? 0,
      images: pending?.imageOffset ?? 0,
    };
  }
  /** Count a step before running it. Returns how many times it has now been started. */
  private async attempt(pending: Pending, step: string): Promise<number> {
    pending.attempt =
      pending.attempt?.step === step
        ? { ...pending.attempt, count: pending.attempt.count + 1 }
        : { step, count: 1 };
    await this.save("pending", pending);
    return pending.attempt.count;
  }
  /** Leave one page or image out of this run and say why. */
  private skip(pending: Pending, step: string, path: string): void {
    pending.skipped = [
      ...(pending.skipped ?? []),
      {
        step,
        path,
        message: isTimeout(pending.attempt?.error)
          ? STEP_KILLED
          : pending.attempt!.error!,
      },
    ].slice(-200);
  }
  /** A step finished: the next one starts with a clean count. */
  private advance(pending: Pending, step: string): void {
    pending.attempt = { step, count: 0 };
  }
  /** Keep the reason a batch failed where the admin page and agents can read it. */
  private async recordFailure(error: unknown): Promise<void> {
    try {
      const pending = await this.state("pending", PendingSchema);
      if (!pending?.attempt) return;
      pending.attempt = {
        ...pending.attempt,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        at: new Date().toISOString(),
      };
      await this.save("pending", pending);
    } catch (failure) {
      console.error("[plugin:instatic.seo-geo] Could not record the failure: " + describeError(failure));
    }
  }
  /**
   * Note that the scheduled job is alive. The admin page warns when it has
   * been silent, because the host pauses a schedule after repeated failures
   * and nothing else would show that updates stopped.
   */
  async heartbeat(source: "schedule" | "manual"): Promise<void> {
    const now = Date.now();
    const record: Automation | undefined = await this.cached("automation", () =>
      this.state("automation", AutomationSchema),
    );
    if (!record)
      await this.save("automation", {
        since: now,
        ...(source === "schedule" ? { scheduledAt: now } : {}),
      });
    else if (source === "schedule" && now - (record.scheduledAt ?? 0) > HEARTBEAT_MS)
      await this.save("automation", { ...record, scheduledAt: now });
  }

  /** One resumable, serialized batch. The current pointer is committed last. */
  async rebuild(force = false, source: BatchSource = "manual"): Promise<Progress> {
    const lease = this.acquire();
    if (!lease) return this.busy();
    try {
      await this.heartbeat("manual");
      return await this.batch(force, lease, source);
    } catch (error) {
      console.error(
        "[plugin:instatic.seo-geo] Generation batch failed: " + describeError(error),
      );
      // "interrupted" is all the sandbox says when a step runs out of time.
      const failure =
        error instanceof Error && error.message === "interrupted"
          ? new Error(STEP_KILLED + " It is retried automatically.")
          : error;
      // A batch that was replaced must not write over its successor's progress.
      if (this.lease === lease) await this.recordFailure(failure);
      throw failure;
    } finally {
      this.release(lease);
    }
  }

  /** The scheduled job ran recently enough to be relied on for slow work. */
  private async scheduleAlive(): Promise<boolean> {
    const record = await this.state("automation", AutomationSchema);
    return Date.now() - (record?.scheduledAt ?? 0) < HEARTBEAT_MS + 2 * 60_000;
  }

  private async batch(
    force: boolean,
    lease: Lease,
    source: BatchSource,
  ): Promise<Progress> {
    const entered = Date.now();
    const { config, configuration, exports } = await this.fingerprints();
    const inventory = await this.inventory();
    const allowedRoutes = includedRoutes(inventory.routes, config.options);
    const current = await this.state("current", GenerationSchema);
    const stored = await this.state("pending", PendingSchema);
    if (
      !stored &&
      !force &&
      current?.revision === inventory.revision &&
      current.configuration === configuration
    )
      return {
        done: true,
        offset: allowedRoutes.length,
        total: allowedRoutes.length,
      };
    let pending: Pending;
    if (
      !stored ||
      stored.revision !== inventory.revision ||
      stored.configuration !== configuration
    ) {
      pending = {
        id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
        revision: inventory.revision,
        configuration,
        exports,
        origin: config.origin,
        offset: 0,
        total: allowedRoutes.length,
        siteName: "",
        htmlOffset: 0,
        bytes: 0,
        imageOffset: 0,
      };
      await this.save("pending", pending);
    } else pending = stored;
    let loaded: GeneratedPage[] | undefined;
    const previous = async () =>
      (loaded ??= current ? await this.pages(current.id) : []);
    const progress = (phase: string, extra: Partial<Progress> = {}): Progress => ({
      done: false,
      offset: pending.offset,
      total: pending.total,
      phase,
      refreshed: pending.htmlOffset,
      ...extra,
    });

    // 1. Documents: read each published page into its export record.
    let generated = false;
    if (pending.offset < allowedRoutes.length) {
      generated = true;
      const first = allowedRoutes[pending.offset]!;
      if ((await this.attempt(pending, "documents:" + pending.offset)) > MAX_ATTEMPTS) {
        this.skip(pending, "documents", first.path);
        pending.offset++;
        this.advance(pending, "documents:" + pending.offset);
        await this.save("pending", pending);
      } else {
        const earlier = await previous();
        for (const route of allowedRoutes.slice(pending.offset, pending.offset + 3)) {
          this.held(lease);
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
            throw new ContentLimitError(
              `Published HTML exceeds the 1 MiB per-page processing limit: ${route.path}`,
            );
          const { page } = await generateDocument(
            document,
            config.origin,
            config.options,
            configuration,
            inventory.routes,
            earlier.find((page) => page.id === route.id),
          );
          const content = JSON.stringify(page);
          const collection = this.collection("documents");
          const existing = (
            await this.records("documents", {
              generation: pending.id,
              path: route.path,
            })
          )[0];
          pending.bytes +=
            new TextEncoder().encode(content).length -
            (existing
              ? new TextEncoder().encode(String(existing.data.content ?? "")).length
              : 0);
          if (pending.bytes > 24 * 1024 * 1024)
            throw new ContentLimitError(
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
          this.advance(pending, "documents:" + pending.offset);
          this.held(lease);
          await this.save("pending", pending);
        }
      }
      if (pending.offset < allowedRoutes.length) return progress("documents");
    }

    // 2. Social images: rendered before the HTML refresh, so refreshed pages
    // can point at images that already exist. A page whose image cannot be
    // made keeps its own image.
    const template = this.ogTemplate();
    if (resolveTemplate(template).enabled) {
      const jobs = await ogJobs(
        template,
        await this.pages(pending.id),
        pending.siteName,
        this.sections(inventory.routes),
      );
      let index = pending.imageOffset ?? 0;
      // Rendering takes about a second in the sandbox, so it starts in a
      // fresh request after the documents batch.
      if (index < jobs.length && !generated && source === "manual" && pending.slowImages) {
        // This server cannot make an image within a request's time limit.
        // The scheduled job can; without it the pages keep their own images.
        if (await this.scheduleAlive())
          return progress("images", {
            images: index,
            imageTotal: jobs.length,
            deferred: true,
          });
        pending.skipped = [
          ...(pending.skipped ?? []),
          {
            step: "images",
            path: jobs[index]!.path,
            message: `Social images take longer than this server allows per request, and background updates are not running. ${jobs.length - index} pages keep their own image.`,
          },
        ].slice(-200);
        pending.imageOffset = index = jobs.length;
        this.advance(pending, "html:" + pending.htmlOffset);
        await this.save("pending", pending);
      }
      if (index < jobs.length && !generated) {
        // A second try means the first one died, most likely on the host's
        // time limit: the rest of this run uses the faster encoding.
        if (pending.attempt?.step === "images:" + index && pending.attempt.count >= 1)
          pending.fastImages = true;
        if ((await this.attempt(pending, "images:" + index)) > MAX_ATTEMPTS) {
          const timedOut = isTimeout(pending.attempt?.error);
          if (timedOut && source === "manual") {
            // Do not spend three timeouts on every remaining image.
            pending.slowImages = true;
            this.advance(pending, "images:" + index);
            await this.save("pending", pending);
            return progress("images", { images: index, imageTotal: jobs.length });
          }
          this.skip(pending, "images", jobs[index]!.path);
          pending.imageOffset = ++index;
          this.advance(pending, "images:" + index);
          await this.save("pending", pending);
        } else {
          const images = await this.ogIndex();
          const logo = await this.logoBitmap(template);
          const first = index;
          let last = 0;
          try {
            while (index < jobs.length) {
              // Predict the next render from the last one so a request never
              // runs past the sandbox's per-call budget.
              if (index > first && Date.now() - entered + last > IMAGE_BUDGET_MS) break;
              this.held(lease);
              const job = jobs[index]!;
              if (!images[job.key]) {
                const renderStart = Date.now();
                const png = renderOgPng(template, job.data, logo, pending.fastImages);
                last = Date.now() - renderStart;
                const record = await this.collection("images").create({
                  key: job.key,
                  content: toBase64(png),
                });
                images[job.key] = record.id;
                await this.save("og-index", images);
              }
              index++;
            }
          } finally {
            // Keep what was rendered even when a later image in the batch fails.
            if (index !== first) {
              pending.imageOffset = index;
              this.advance(pending, "images:" + index);
              await this.save("pending", pending);
            }
          }
        }
      }
      if (index < jobs.length) {
        if (generated) {
          // Images start in the next call; say so now for anyone reading the status.
          this.advance(pending, "images:" + index);
          await this.save("pending", pending);
        }
        return progress("images", { images: index, imageTotal: jobs.length });
      }
    }

    // 3. HTML: re-render only existing published versions, in small batches,
    // before exposing the new export pointer. Drafts never enter this pipeline.
    if (pending.htmlOffset < allowedRoutes.length) {
      // A batch that failed is retried one page at a time.
      const size =
        (await this.attempt(pending, "html:" + pending.htmlOffset)) > 1 ? 1 : 3;
      const refresh = allowedRoutes
        .slice(pending.htmlOffset, pending.htmlOffset + size)
        .map((route) => route.path);
      this.held(lease);
      await this.api.cms.publication.refresh({
        paths: refresh,
        origin: config.origin,
        revision: pending.revision,
      });
      this.held(lease);
      pending.htmlOffset += refresh.length;
      this.advance(
        pending,
        pending.htmlOffset < allowedRoutes.length ? "html:" + pending.htmlOffset : "commit",
      );
      await this.save("pending", pending);
      if (pending.htmlOffset < allowedRoutes.length) return progress("html");
    }

    // 4. Commit: validate, then move the current pointer to the new generation.
    await this.attempt(pending, "commit");
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
      throw new Error("Publication or configuration changed; restart generation.");
    const pages = await this.pages(pending.id);
    const earlier = await previous();
    let redirects: Redirect[];
    try {
      redirects = redirectsFor(config.options, earlier, pages, current?.redirects);
    } catch (error) {
      // Saved redirects are checked when they are saved, so a cycle here comes
      // from redirects remembered for renamed pages. Drop those and keep going
      // rather than block every future generation; a real conflict still throws.
      redirects = redirectsFor(config.options, earlier, pages, []);
      pending.skipped = [
        ...(pending.skipped ?? []),
        {
          step: "redirects",
          path: "/",
          message:
            "Automatic redirects for renamed pages were reset: " +
            (error instanceof Error ? error.message : String(error)),
        },
      ];
    }
    // Validate discovery files before committing, retaining the old pointer
    // if any XML size or redirect validation fails.
    sitemapFiles(pages, config.origin, config.options);
    const committed = pending;
    this.held(lease);
    await this.serializeIndexNow(async () => {
      await this.api.cms.publication.list({
        limit: 1,
        revision: committed.revision,
      });
      if ((await fingerprint(this.configuration())) !== configuration)
        throw new Error("Configuration changed before generation commit; retry.");
      const queued = await this.indexNowQueue();
      await this.save("indexnow-queue", {
        urls: [
          ...new Set([
            ...queued.urls,
            ...pages
              .filter(
                (page) =>
                  page.indexable &&
                  !earlier.some(
                    (old) =>
                      old.path === page.path &&
                      old.contentHash === page.contentHash,
                  ),
              )
              .map((page) => page.canonical),
            ...earlier
              .filter(
                (old) =>
                  old.indexable &&
                  !pages.some((page) => page.indexable && page.path === old.path),
              )
              .map((page) => page.canonical),
          ]),
        ],
        attempts: queued.attempts,
        nextAttempt: queued.nextAttempt,
      });
      const next: Generation = {
        id: committed.id,
        revision: committed.revision,
        configuration,
        exports,
        origin: config.origin,
        routes: pages.map((page) => page.path),
        completedAt: new Date().toISOString(),
        siteName: committed.siteName,
        redirects,
        ...(committed.skipped?.length ? { skipped: committed.skipped } : {}),
      };
      this.held(lease);
      await this.save("current", next);
      await this.clear("pending");
    });
    return { done: true, offset: pages.length, total: pages.length };
  }
  async cleanup(): Promise<void> {
    const current = await this.state("current", GenerationSchema),
      pending = await this.state("pending", PendingSchema);
    const records = await this.collection("documents").list({
      filter: current ? { generation: { ne: current.id } } : {},
      limit: 100,
    });
    for (const record of validate(StorageListResultSchema, records).records)
      if (
        record.data.generation !== current?.id &&
        record.data.generation !== pending?.id
      )
        await this.collection("documents").delete(record.id);
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
      await this.collection("images").delete(id);
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
    const live = await this.fingerprints();
    const { config, configuration } = live;
    const { generation, pending, generated, eligible } = await this.cached(
      "enrich:" + configuration,
      async () => {
        const generation = await this.state("current", GenerationSchema);
        const pending = await this.state("pending", PendingSchema);
        // A generation whose documents are complete is used while its HTML
        // refresh runs; otherwise the committed one.
        const staged =
          !!pending &&
          pending.offset === pending.total &&
          pending.configuration === configuration;
        const generated = staged
          ? await this.pages(pending.id)
          : generation
            ? await this.pages(generation.id)
            : [];
        return {
          generation,
          pending,
          generated,
          /** These documents are (about to be) served as exports. */
          eligible: staged || (!!generation && this.servable(generation, live)),
        };
      },
    );
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
      eligible &&
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
    if (!(await this.cached("og-index", () => this.ogIndex()))[key]) return; // Not rendered yet; keep the page's tags.
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
    // robots.txt depends only on settings, so it never waits for a generation.
    const config = this.configuration();
    if (path === "/robots.txt")
      return {
        __response: true,
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
        body: robotsTxt(config.origin, config.options),
      };
    const managed =
      path === "/sitemap.xml" ||
      (path === "/llms.txt" && config.llms) ||
      /^\/sitemaps\/\d+\.xml$/.test(path) ||
      path.startsWith("/markdown/");
    // Saved redirect sources are stored without a trailing slash, but the old
    // site's URLs (and the copies search engines hold) usually end in one.
    const source =
      path.length > 1 && path.endsWith("/") && !path.endsWith("//")
        ? path.slice(0, -1)
        : path;
    if (!managed) {
      // Every unknown URL on the site reaches this route, so a miss is
      // answered from the small generation record without loading documents.
      // Read fresh: a new redirect must work at once on every server instance.
      const generation = await this.state("current", GenerationSchema);
      if (
        !generation?.redirects.some((redirect) => redirect.from === source) &&
        !config.options.redirects?.some((redirect) => redirect.from === source)
      )
        return notFound;
    }
    const state = await this.current();
    if (!state.generation || !state.servable)
      return {
        __response: true,
        status: 503,
        headers: {
          ...headers,
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "60",
          // Lets a person or agent tell the two causes apart from outside.
          "X-Seo-Geo-Reason": state.generation ? "settings-changed" : "not-generated",
        },
        body: "SEO generation is pending. Run Generate in the plugin admin page.",
      };
    const redirect = redirectsFor(
      state.options,
      [],
      state.pages,
      state.generation.redirects,
    ).find((redirect) => redirect.from === source);
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
    if (!state.generation || !state.servable)
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
    // An operation the sandbox abandoned never releases its turn. Once the
    // one that is running has held it for the lease time, newcomers stop
    // waiting for it; one that is merely queued does not count as running.
    const abandoned =
      this.indexNowSince > 0 && Date.now() - this.indexNowSince > LEASE_MS;
    const previous = abandoned ? Promise.resolve() : this.indexNowTail;
    if (abandoned) this.indexNowSince = 0;
    let release: () => void = () => {};
    this.indexNowTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const started = (this.indexNowSince = Date.now());
    try {
      return await operation();
    } finally {
      if (this.indexNowSince === started) this.indexNowSince = 0;
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
