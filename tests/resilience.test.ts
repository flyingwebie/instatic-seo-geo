import { describe, expect, spyOn, test } from "bun:test";
import type { ServerPluginApi } from "#instatic-sdk";
import type { BatchSource, PublicationService } from "../src/service";
import { submitIndexNow } from "../src/integrations";
import plugin from "../server/index";
import { complete, document, fakeHost, origin } from "./fixtures";

/**
 * Proves the failure and recovery behaviour described in
 * docs/state-machines.md: a batch that keeps failing is retried, a
 * skippable step gives up after MAX_ATTEMPTS and reports why, an abandoned
 * batch cannot corrupt its successor, and the server entrypoint keeps
 * serving stale-but-valid exports instead of 503ing the whole site over one
 * broken setting. Each test drives PublicationService through its public
 * methods only, reaching into stored records solely to inspect or corrupt
 * them the way an old plugin version, a crashed step or a direct database
 * edit would.
 */

/** Runs `run` with console.error silenced, since every reject loop below logs one. */
async function silenced<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

/** Like `complete`, but drives rebuild() with a fixed batch source throughout. */
async function completeWith(service: PublicationService, source: BatchSource) {
  let result = await service.rebuild(false, source);
  for (let i = 0; !result.done && i < 100; i++) result = await service.rebuild(false, source);
  if (!result.done) throw new Error("Generation did not complete");
  return result;
}

/**
 * Makes `collection(resource).create()` throw until `.stop()` is called,
 * the same way tests/publish-cache.test.ts wraps `storage.collection` to
 * count calls, but injecting a failure instead of counting.
 */
function failCollectionCreate(
  host: ReturnType<typeof fakeHost>,
  resource: string,
  makeError: () => Error,
) {
  const original = host.api.cms.storage.collection;
  let failing = true;
  host.api.cms.storage.collection = (id) => {
    const inner = original(id);
    if (id !== resource) return inner;
    return {
      ...inner,
      create: async (data) => {
        if (failing) throw makeError();
        return inner.create(data);
      },
    };
  };
  return {
    stop: () => {
      failing = false;
    },
  };
}

/** The stored "pending" generation record, read the way an old version or a direct DB edit would. */
function pendingRecordValue(
  host: ReturnType<typeof fakeHost>,
): { fastImages?: boolean; slowImages?: boolean } | undefined {
  const record = host.records.find((r) => r.resourceId === "state" && r.data.key === "pending");
  return record
    ? (JSON.parse(String(record.data.value)) as { fastImages?: boolean; slowImages?: boolean })
    : undefined;
}

/** Rewrites the stored "current" generation to drop its "exports" fingerprint, as an older version wrote it. */
function stripExportsField(host: ReturnType<typeof fakeHost>): void {
  const record = host.records.find((r) => r.resourceId === "state" && r.data.key === "current");
  if (!record) throw new Error("No committed generation to rewrite");
  const parsed = JSON.parse(String(record.data.value)) as Record<string, unknown>;
  delete parsed.exports;
  record.data = { ...record.data, value: JSON.stringify(parsed) };
}

/** publicFile's possible shapes, narrowed for header assertions the way tests/og.test.ts does. */
type FileResponse = { status: number; headers: Record<string, string>; body: string };

describe("documents: a page that always fails to render is skipped, not left blocking everything", () => {
  test("it rejects for the first 3 attempts, then is skipped and reported while the rest of the site is served", () =>
    silenced(async () => {
      const host = fakeHost([document("/bad"), document("/good")]);
      host.failRender("/bad");
      for (let i = 0; i < 3; i++)
        await expect(host.service.rebuild()).rejects.toThrow("Injected render failure");
      const result = await complete(host.service);
      expect(result.done).toBe(true);

      const status = await host.service.status();
      expect(status.lifecycle.state).toBe("ready");
      expect(status.lifecycle.attention?.code).toBe("pages-skipped");
      expect(status.findings.some((f) => f.code === "generation.page-skipped")).toBe(true);

      const sitemap = (await host.service.publicFile("/sitemap.xml")) as FileResponse;
      expect(sitemap.body).not.toContain("/bad");
      expect(sitemap.body).toContain("/good");
      expect((await host.service.publicFile("/markdown/good/index.md")).status).toBe(200);
      expect((await host.service.publicFile("/markdown/bad/index.md")).status).toBe(404);
    }));
});

describe("social images: a page's or image's failure never blocks the generation", () => {
  test("an image that always fails is skipped after 3 attempts; the page keeps its own tags", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      host.values.ogTemplate = JSON.stringify({ enabled: true, mode: "always" });
      failCollectionCreate(host, "images", () => new Error("Injected image failure"));

      const first = await host.service.rebuild();
      expect(first.done).toBe(false);
      for (let i = 0; i < 3; i++)
        await expect(host.service.rebuild()).rejects.toThrow("Injected image failure");
      const result = await complete(host.service);
      expect(result.done).toBe(true);

      const status = await host.service.status();
      expect(status.findings.some((f) => f.code === "generation.image-skipped")).toBe(true);

      const html = await host.service.enrich(document("/a").html, {
        urlPath: "/a",
        pageId: "/a",
      });
      expect(html).not.toContain("/og/");
    }));

  test("a timing-out image switches to fast encoding, then is left out after three timeouts with no schedule alive", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      host.values.ogTemplate = JSON.stringify({ enabled: true, mode: "always" });
      failCollectionCreate(host, "images", () => new Error("interrupted"));

      const first = await host.service.rebuild();
      expect(first.done).toBe(false);
      // The thrown message is the readable sentence, never the bare "interrupted".
      await expect(host.service.rebuild()).rejects.toThrow("time or memory limit");
      await expect(host.service.rebuild()).rejects.toThrow("time or memory limit");
      // By the second attempt on the same image, the run has switched to fast encoding.
      expect(pendingRecordValue(host)?.fastImages).toBe(true);
      await expect(host.service.rebuild()).rejects.toThrow("time or memory limit");

      const afterThirdFailure = await host.service.rebuild();
      expect(afterThirdFailure.done).toBe(false);
      expect(afterThirdFailure.busy).toBeUndefined();

      const result = await complete(host.service);
      expect(result.done).toBe(true);
      const status = await host.service.status();
      expect(status.findings.filter((f) => f.code === "generation.image-skipped")).toHaveLength(1);
    }));

  test("once the scheduled job is alive, a timed-out image is deferred instead of skipped, then renders once it clears", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      host.values.ogTemplate = JSON.stringify({ enabled: true, mode: "always" });
      const images = failCollectionCreate(host, "images", () => new Error("interrupted"));

      await host.service.rebuild();
      for (let i = 0; i < 3; i++)
        await expect(host.service.rebuild()).rejects.toThrow("time or memory limit");
      const afterThirdFailure = await host.service.rebuild();
      expect(afterThirdFailure.done).toBe(false);

      await host.service.heartbeat("schedule");
      const deferred = await host.service.rebuild();
      expect(deferred.done).toBe(false);
      expect(deferred.deferred).toBe(true);
      expect(deferred.phase).toBe("images");
      expect(
        (await host.service.status()).findings.some((f) => f.code === "generation.image-skipped"),
      ).toBe(false);

      images.stop();
      const result = await completeWith(host.service, "schedule");
      expect(result.done).toBe(true);
      expect(
        (await host.service.status()).findings.some((f) => f.code === "generation.image-skipped"),
      ).toBe(false);

      const html = await host.service.enrich(document("/a").html, {
        urlPath: "/a",
        pageId: "/a",
      });
      expect(html).toContain("/og/");
    }));
});

describe("HTML refresh: retried one page at a time, never skipped", () => {
  test("failures keep retrying and nothing commits, until they stop and the batch catches up", () =>
    silenced(async () => {
      const host = fakeHost(Array.from({ length: 5 }, (_, i) => document("/" + i)));
      host.failRefresh(true);

      const first = await host.service.rebuild();
      expect(first.done).toBe(false);
      for (let i = 0; i < 3; i++)
        await expect(host.service.rebuild()).rejects.toThrow("Injected refresh failure");

      const status = await host.service.status();
      expect(status.lifecycle.attention?.code).toBe("generation-failing");
      expect(status.lifecycle.lastError?.message).toContain("Injected refresh failure");
      expect(status.completedAt).toBe("");
      expect(host.refreshes).toHaveLength(0);

      host.failRefresh(false);
      await complete(host.service);
      // Recovery is retried one page at a time, not with the normal batch of 3.
      expect(host.refreshes[0]).toHaveLength(1);
      expect((await host.service.status()).lifecycle.state).toBe("ready");
    }));
});

describe("the generation lease", () => {
  test("a concurrent rebuild resolves to busy with the saved progress instead of throwing", () =>
    silenced(async () => {
      const host = fakeHost([document("/a"), document("/b")]);
      const originalRender = host.api.cms.publication.render;
      let renderStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        renderStarted = resolve;
      });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      host.api.cms.publication.render = async (options) => {
        if (options.path === "/a") {
          renderStarted();
          await gate;
        }
        return originalRender(options);
      };

      const first = host.service.rebuild();
      await started; // the batch has already saved its initial pending record
      const busy = await host.service.rebuild();
      expect(busy).toMatchObject({ done: false, busy: true, offset: 0, total: 2 });

      release();
      const firstResult = await first;
      expect(firstResult.busy).toBeUndefined();

      const afterRelease = await host.service.rebuild();
      expect(afterRelease.busy).toBeUndefined();
    }));

  test("an abandoned batch is replaced once its lease expires, and throws instead of committing when it resumes", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      const originalRender = host.api.cms.publication.render;
      let blocked = 0;
      let renderStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        renderStarted = resolve;
      });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      host.api.cms.publication.render = async (options) => {
        if (options.path === "/a" && blocked++ === 0) {
          renderStarted();
          await gate;
        }
        return originalRender(options);
      };

      const first = host.service.rebuild();
      await started;
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 91_000;
        const second = await host.service.rebuild();
        expect(second.busy).toBeUndefined();
      } finally {
        Date.now = realNow;
      }

      release();
      await expect(first).rejects.toThrow("replaced by a newer one");

      // The successor's committed generation is not corrupted by the resume.
      await complete(host.service);
      expect((await host.service.status()).generated).toBe(1);
    }));
});

describe("exports keep serving across settings that only change published HTML", () => {
  test("settings changes keep the last exports served until the next generation commits; only a site never generated answers 503", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      await complete(host.service);

      host.values.analytics = JSON.stringify({ ga4Id: "G-ABC123XYZ9" });
      let status = await host.service.status();
      expect(status.lifecycle.state).toBe("outdated");
      expect(status.lifecycle.serving).toBe("exports");
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);
      expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(200);
      expect((await host.service.download()).status).toBe(200);

      host.values.analytics = "{}";
      host.values.ogTemplate = JSON.stringify({ enabled: true, brandMark: "EX" });
      status = await host.service.status();
      expect(status.lifecycle.serving).toBe("exports");
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);

      host.values.ogTemplate = "{}";
      host.values.options = '{"pages":{"/a":{"index":false}}}';
      // The sitemap never goes blank: the last generation answers until the
      // new one commits, then the page drops out.
      const stale = (await host.service.publicFile("/sitemap.xml")) as FileResponse;
      expect(stale.status).toBe(200);
      expect(String(stale.body)).toContain("/a");
      await complete(host.service);
      const fresh = (await host.service.publicFile("/sitemap.xml")) as FileResponse;
      expect(fresh.status).toBe(200);
      expect(String(fresh.body)).not.toContain("example.com/a");

      const freshHost = fakeHost([document("/b")]);
      const noGeneration = (await freshHost.service.publicFile("/sitemap.xml")) as FileResponse;
      expect(noGeneration.status).toBe(503);
      expect(noGeneration.headers["X-Seo-Geo-Reason"]).toBe("not-generated");
    }));
});

describe("legacy generations stored without an exports fingerprint", () => {
  test("still serve exports once the record is rewritten the way an older version wrote it, if nothing changed", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      await complete(host.service);
      stripExportsField(host);
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);
      expect((await host.service.download()).status).toBe(200);
    }));

  test("still serve exports when analytics was already configured at generation time and stays unchanged", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      host.values.analytics = JSON.stringify({ ga4Id: "G-ABC123XYZ9" });
      await complete(host.service);
      stripExportsField(host);
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);
    }));

  test("keep serving after a setting changes, until the site is regenerated", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      await complete(host.service);
      stripExportsField(host);
      host.values.options = '{"pages":{"/a":{"index":false}}}';
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);
      await complete(host.service);
      expect((await host.service.publicFile("/sitemap.xml")).status).toBe(200);
    }));
});

describe("publicFile avoids loading documents when it does not need them", () => {
  test("robots.txt and an unknown URL never list the documents collection, and robots.txt works before any generation", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      const counts: Record<string, number> = {};
      const original = host.api.cms.storage.collection;
      host.api.cms.storage.collection = (resource) => {
        const inner = original(resource);
        return {
          ...inner,
          list: (...args) => {
            counts[resource] = (counts[resource] ?? 0) + 1;
            return inner.list(...args);
          },
        };
      };

      expect((await host.service.publicFile("/robots.txt")).status).toBe(200);
      expect((await host.service.publicFile("/wp-login.php")).status).toBe(404);
      expect(counts.documents).toBeUndefined();
    }));
});

describe("automation heartbeat and silence", () => {
  test("silent is false right after a manual rebuild, true 16 minutes later with no scheduled run, and false again after one", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      await complete(host.service);
      expect((await host.service.status()).lifecycle.automation.silent).toBe(false);

      // Made stale so the automation-silent attention (which never shows once
      // the site is "ready") has something to surface.
      host.values.options = '{"pages":{"/a":{"index":false}}}';
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 16 * 60_000;
        const status = await host.service.status();
        expect(status.lifecycle.automation.silent).toBe(true);
        expect(status.lifecycle.attention?.code).toBe("automation-silent");
        expect(status.lifecycle.nextAction.code).toBe("resume-schedule");

        await host.service.heartbeat("schedule");
        const after = await host.service.status();
        expect(after.lifecycle.automation.silent).toBe(false);
      } finally {
        Date.now = realNow;
      }
    }));
});

describe("the server entrypoint: publish.html filter and the schedule handler", () => {
  type FilterContext = {
    pluginId: string;
    siteId: string;
    pageId: string;
    contentId: string;
    slug: string;
    urlPath: string;
    publishVersion: number;
  };
  type FilterHandler = (html: string, context: FilterContext) => string | Promise<string>;
  type ScheduleHandler = () => void | Promise<void>;

  test("page metadata and analytics fail independently, and the scheduled handler never rejects", () =>
    silenced(async () => {
      const host = fakeHost([document("/a")]);
      host.values.analytics = JSON.stringify({ ga4Id: "G-ABC123XYZ9" });

      let filterHandler: FilterHandler | undefined;
      let scheduleHandler: ScheduleHandler | undefined;
      const api = {
        cms: {
          routes: {
            get: (_path: string, _capability: string, _handler: unknown) => {},
            post: (_path: string, _capability: string, _handler: unknown) => {},
            site: { get: (_path: string, _handler: unknown) => {} },
          },
          hooks: {
            on: (_event: string, _listener: unknown) => {},
            filter: (name: string, handler: FilterHandler) => {
              if (name === "publish.html") filterHandler = handler;
            },
          },
          schedule: {
            register: (def: { handler: ScheduleHandler }) => {
              scheduleHandler = def.handler;
            },
          },
          settings: host.api.cms.settings,
          storage: host.api.cms.storage,
          publication: host.api.cms.publication,
        },
        plugin: { id: "instatic.seo-geo", version: "0.0.0-test" },
      };
      plugin.activate?.(api as unknown as ServerPluginApi);
      if (!filterHandler || !scheduleHandler)
        throw new Error("The plugin did not register the expected filter or schedule handler.");

      const context: FilterContext = {
        pluginId: "instatic.seo-geo",
        siteId: "site",
        pageId: "/a",
        contentId: "/a",
        slug: "a",
        urlPath: "/a",
        publishVersion: 1,
      };

      const withAnalytics = await filterHandler(document("/a").html, context);
      expect(withAnalytics).toContain('<link rel="canonical"');
      expect(withAnalytics).toContain("gtag(");

      const originalList = host.api.cms.publication.list;
      host.api.cms.publication.list = async () => {
        throw new Error("publication.list unavailable");
      };
      const whenEnrichFails = await filterHandler(document("/a").html, context);
      expect(whenEnrichFails).not.toContain('<link rel="canonical"');
      expect(whenEnrichFails).toContain("gtag(");
      host.api.cms.publication.list = originalList;

      host.values.analytics = "not json";
      const badAnalytics = await filterHandler(document("/a").html, context);
      expect(badAnalytics).toContain('<link rel="canonical"');
      expect(badAnalytics).not.toContain("gtag(");

      host.failRender("/a");
      await expect(scheduleHandler()).resolves.toBeUndefined();
      const status = await host.service.status();
      expect(status.lifecycle.automation.lastRunAt).not.toBe("");
    }));
});

describe("IndexNow tolerates one malformed queued URL", () => {
  test("a queue with a malformed entry still submits the valid one", () =>
    silenced(async () => {
      const host = fakeHost([document("/old")]);
      host.values.indexNowEnabled = true;
      host.values.indexNowKey = "test-key-12345678";
      await host.service.saveIndexNowQueue({
        urls: ["not a url", origin + "/valid"],
        attempts: 0,
        nextAttempt: 0,
      });

      let submitted: { urlList?: string[] } = {};
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            submitted = JSON.parse(String(init?.body)) as { urlList?: string[] };
            return new Response("", { status: 202 });
          },
          { preconnect: () => {} },
        ),
      );
      try {
        const result = await submitIndexNow(host.api, host.service, true);
        expect(result.submitted).toBe(1);
        expect(submitted.urlList).toEqual([origin + "/valid"]);
      } finally {
        fetchSpy.mockRestore();
      }
    }));
});
