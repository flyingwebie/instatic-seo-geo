import { describe, expect, test } from "bun:test";
import { validate } from "../src/config";
import {
  AUTOMATION_SILENT_MS,
  deriveLifecycle,
  describeError,
  LifecycleSchema,
  MAX_ATTEMPTS,
  phaseOf,
  type Lifecycle,
  type LifecycleInput,
  type LifecyclePhase,
} from "../src/lifecycle";

const NOW = 1_700_000_000_000;

/** Runs deriveLifecycle and checks the result against its own schema, so
 * every case in this file doubles as a schema-validation check. */
function lc(input: LifecycleInput): Lifecycle {
  const result = deriveLifecycle(input);
  validate(LifecycleSchema, result);
  return result;
}

function pendingRecord(
  overrides: Partial<NonNullable<LifecycleInput["pending"]>> = {},
): NonNullable<LifecycleInput["pending"]> {
  return {
    matches: true,
    offset: 5,
    htmlOffset: 5,
    imageOffset: 5,
    total: 5,
    ...overrides,
  };
}

function currentRecord(
  overrides: Partial<NonNullable<LifecycleInput["current"]>> = {},
): NonNullable<LifecycleInput["current"]> {
  return { servable: true, fresh: true, ...overrides };
}

describe("state: what a site owner sees for each generation record", () => {
  const cases: Array<{
    name: string;
    input: LifecycleInput;
    expect: { state: Lifecycle["state"]; serving: Lifecycle["serving"] };
  }> = [
    {
      name: "no website address saved yet is unconfigured",
      input: { configured: false, now: NOW },
      expect: { state: "unconfigured", serving: "nothing" },
    },
    {
      name: "configured but nothing was ever generated and nothing is pending is never-generated",
      input: { configured: true, now: NOW },
      expect: { state: "never-generated", serving: "nothing" },
    },
    {
      name: "a pending generation started for the current settings is generating",
      input: { configured: true, pending: pendingRecord(), now: NOW },
      expect: { state: "generating", serving: "nothing" },
    },
    {
      name: "a pending generation left over from different settings is ignored, and the plugin falls back to outdated rather than claiming to be generating",
      input: { configured: true, pending: pendingRecord({ matches: false }), now: NOW },
      expect: { state: "outdated", serving: "nothing" },
    },
    {
      name: "a committed generation that still matches the published content and every setting is ready",
      input: { configured: true, current: currentRecord({ servable: true, fresh: true }), now: NOW },
      expect: { state: "ready", serving: "exports" },
    },
    {
      name: "a committed generation whose settings changed since it ran is outdated, even though it can still be served",
      input: { configured: true, current: currentRecord({ servable: true, fresh: false }), now: NOW },
      expect: { state: "outdated", serving: "exports" },
    },
    {
      name: "a committed generation that can no longer be served under the current settings is outdated with nothing served",
      input: { configured: true, current: currentRecord({ servable: false, fresh: false }), now: NOW },
      expect: { state: "outdated", serving: "nothing" },
    },
    {
      name: "a fresh pending generation takes priority over an already-ready one, so the site is reported as generating, not ready",
      input: {
        configured: true,
        current: currentRecord({ servable: true, fresh: true }),
        pending: pendingRecord(),
        now: NOW,
      },
      expect: { state: "generating", serving: "exports" },
    },
  ];

  for (const { name, input, expect: expected } of cases)
    test(name, () => {
      const result = lc(input);
      expect(result.state).toBe(expected.state);
      expect(result.serving).toBe(expected.serving);
    });

  test("a stale pending generation leaves no phase or progress behind, since it never counts as generating", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ matches: false }),
      now: NOW,
    });
    expect(result.phase).toBeUndefined();
    expect(result.progress).toBeUndefined();
  });
});

describe("serving: whether /sitemap.xml, /llms.txt and /markdown/* answer right now", () => {
  const cases: Array<{ name: string; input: LifecycleInput; serving: Lifecycle["serving"] }> = [
    {
      name: "an unconfigured site serves nothing, even if an old generation could technically still be served",
      input: { configured: false, current: currentRecord({ servable: true }), now: NOW },
      serving: "nothing",
    },
    {
      name: "a configured site with no committed generation serves nothing",
      input: { configured: true, now: NOW },
      serving: "nothing",
    },
    {
      name: "a configured site whose committed generation is servable under the current settings serves exports",
      input: { configured: true, current: currentRecord({ servable: true }), now: NOW },
      serving: "exports",
    },
    {
      name: "a configured site whose committed generation can no longer be served serves nothing",
      input: { configured: true, current: currentRecord({ servable: false }), now: NOW },
      serving: "nothing",
    },
  ];

  for (const { name, input, serving } of cases)
    test(name, () => {
      expect(lc(input).serving).toBe(serving);
    });
});

describe("phaseOf: which step a generation in progress is in", () => {
  const cases: Array<{
    name: string;
    pending: NonNullable<LifecycleInput["pending"]>;
    phase: LifecyclePhase;
  }> = [
    {
      name: "still reading pages is the documents phase, no matter what the last attempt was",
      pending: pendingRecord({ offset: 2, total: 5, attempt: { step: "images:0", count: 1 } }),
      phase: "documents",
    },
    {
      name: "documents are done and the last started step was an image is the images phase",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 0, attempt: { step: "images:2", count: 1 } }),
      phase: "images",
    },
    {
      name: "the last started step was refreshing a page is the html phase, even if the html offset says it already finished",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 5, attempt: { step: "html:3", count: 1 } }),
      phase: "html",
    },
    {
      name: "the last started step was the commit is the commit phase",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 5, attempt: { step: "commit", count: 0 } }),
      phase: "commit",
    },
    {
      name: "documents are done, a documents attempt is still the last one recorded, and html is caught up falls back to the html/commit split by offset (html pending)",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 2, attempt: { step: "documents:5", count: 1 } }),
      phase: "html",
    },
    {
      name: "documents are done, no attempt is recorded at all, and html still has pages to refresh falls back to html",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 2, attempt: undefined }),
      phase: "html",
    },
    {
      name: "documents are done, no attempt is recorded, and html is caught up falls back to commit",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 5, attempt: undefined }),
      phase: "commit",
    },
    {
      name: "documents are done and the last attempt names a step this plugin version does not recognise falls back to the html/commit split",
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 5, attempt: { step: "unknown-step", count: 1 } }),
      phase: "commit",
    },
  ];

  for (const { name, pending, phase } of cases)
    test(name, () => {
      expect(phaseOf(pending)).toBe(phase);
    });

  test("a matching pending generation reports the same phase through deriveLifecycle", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ offset: 5, total: 5, htmlOffset: 0, attempt: { step: "images:2", count: 1 } }),
      now: NOW,
    });
    expect(result.phase).toBe("images");
  });
});

describe("progress: the numbers shown for a generation in progress", () => {
  test("documents, images, html offsets and the total are passed straight through from the pending record", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ offset: 3, imageOffset: 1, htmlOffset: 0, total: 10 }),
      now: NOW,
    });
    expect(result.progress).toEqual({ documents: 3, images: 1, html: 0, total: 10 });
  });

  test("a site that is not generating has no progress to show", () => {
    const result = lc({ configured: true, current: currentRecord({ fresh: true }), now: NOW });
    expect(result.progress).toBeUndefined();
  });
});

describe("lastError: the last failure of the step in progress", () => {
  test("a failing step still being attempted is reported, with the attempt count and timestamp carried over", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({
        offset: 5,
        total: 5,
        attempt: { step: "images:0", count: 2, error: "Rendering timed out", at: "2024-01-01T00:00:00.000Z" },
      }),
      now: NOW,
    });
    expect(result.lastError).toEqual({
      step: "images:0",
      message: "Rendering timed out",
      attempts: 2,
      at: "2024-01-01T00:00:00.000Z",
    });
  });

  test("a failing step reported without a timestamp falls back to an empty one, not undefined", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ offset: 5, total: 5, attempt: { step: "commit", count: 1, error: "boom" } }),
      now: NOW,
    });
    expect(result.lastError?.at).toBe("");
  });

  test("a step that is being attempted but has not failed yet has no lastError", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ offset: 5, total: 5, attempt: { step: "commit", count: 1 } }),
      now: NOW,
    });
    expect(result.lastError).toBeUndefined();
  });

  test("a pending generation with no attempt recorded yet has no lastError", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({ offset: 5, total: 5, attempt: undefined }),
      now: NOW,
    });
    expect(result.lastError).toBeUndefined();
  });

  test("a non-matching, stale pending record's error never surfaces, since it is not the generation in progress", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({
        matches: false,
        offset: 5,
        total: 5,
        attempt: { step: "commit", count: 3, error: "boom" },
      }),
      now: NOW,
    });
    expect(result.lastError).toBeUndefined();
    expect(result.state).toBe("outdated");
  });
});

describe("attention: the one problem worth surfacing, in priority order", () => {
  test("generation-failing wins even when automation is also silent and pages are also skipped", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({
        offset: 5,
        total: 5,
        attempt: { step: "images:0", count: MAX_ATTEMPTS, error: "Image rendering keeps crashing" },
        skipped: [{ step: "documents", path: "/a", message: "gave up" }],
      }),
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      now: NOW,
    });
    expect(result.attention?.code).toBe("generation-failing");
    expect(result.attention?.message).toBe(
      "Generation keeps failing while creating a social image: Image rendering keeps crashing",
    );
    expect(result.nextAction.code).toBe("fix-error");
  });

  test("an attempt count below MAX_ATTEMPTS does not count as generation-failing, and falls through to automation-silent instead", () => {
    const result = lc({
      configured: true,
      current: currentRecord({ fresh: false }),
      pending: pendingRecord({
        offset: 5,
        total: 5,
        attempt: { step: "commit", count: MAX_ATTEMPTS - 1, error: "still trying" },
      }),
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      now: NOW,
    });
    expect(result.attention?.code).toBe("automation-silent");
    // The unresolved error is still reported even though it did not win attention.
    expect(result.lastError?.message).toBe("still trying");
  });

  test("automation-silent keeps its code but still says a page was left out", () => {
    const result = lc({
      configured: true,
      current: currentRecord({
        fresh: false,
        skipped: [{ step: "documents", path: "/a", message: "gave up" }],
      }),
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      now: NOW,
    });
    expect(result.attention?.code).toBe("automation-silent");
    expect(result.attention?.message).toBe(
      "Automatic background updates are not running, so changes are only applied while this page generates them. In the last run 1 page was left out of the sitemap and exports. See Checks for the reasons.",
    );
    expect(result.nextAction).toEqual({
      code: "resume-schedule",
      message:
        "Choose Save & generate now. Then open Plugins → SEO, GEO & AIO → Schedules and resume “publication-sync”; Instatic pauses a schedule after five failed runs.",
    });
  });

  test("automation-silent is never raised once the site is ready, even if automation has gone quiet", () => {
    const result = lc({
      configured: true,
      current: currentRecord({ fresh: true }),
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      now: NOW,
    });
    expect(result.attention).toBeUndefined();
    expect(result.nextAction.code).toBe("none");
  });

  test("pages-skipped is reported when nothing worse is wrong", () => {
    const result = lc({
      configured: true,
      current: currentRecord({
        fresh: true,
        skipped: [{ step: "documents", path: "/a", message: "gave up" }],
      }),
      now: NOW,
    });
    expect(result.attention?.code).toBe("pages-skipped");
    // nextAction is untouched by the pages-skipped branch: ready still says "none".
    expect(result.nextAction.code).toBe("none");
  });
});

describe("pages-skipped message: naming what was actually left out", () => {
  const cases: Array<{ name: string; skipped: Array<{ step: string; path: string; message: string }>; text: string }> = [
    {
      name: "a single skipped page is reported in the singular",
      skipped: [{ step: "documents", path: "/a", message: "gave up" }],
      text: "In the last run 1 page was left out of the sitemap and exports. See Checks for the reasons.",
    },
    {
      name: "several skipped pages are reported in the plural, with the exact count",
      skipped: [
        { step: "documents", path: "/a", message: "gave up" },
        { step: "documents", path: "/b", message: "gave up" },
      ],
      text: "In the last run 2 pages were left out of the sitemap and exports. See Checks for the reasons.",
    },
    {
      name: "skipped social images are reported without naming a page count",
      skipped: [{ step: "images", path: "/a", message: "render failed" }],
      text: "In the last run social images could not be created for some pages, which keep their own image. See Checks for the reasons.",
    },
    {
      name: "a reset redirect loop is reported as redirects, not as a page or image",
      skipped: [{ step: "redirects", path: "/old", message: "cycle" }],
      text: "In the last run automatic redirects were reset. See Checks for the reasons.",
    },
    {
      name: "a mix of skipped pages, images and redirects is reported together, in that order",
      skipped: [
        { step: "documents", path: "/a", message: "gave up" },
        { step: "documents", path: "/b", message: "gave up" },
        { step: "images", path: "/c", message: "render failed" },
        { step: "redirects", path: "/old", message: "cycle" },
      ],
      text:
        "In the last run 2 pages were left out of the sitemap and exports; social images could not be created for some pages, which keep their own image; automatic redirects were reset. See Checks for the reasons.",
    },
  ];

  for (const { name, skipped, text } of cases)
    test(name, () => {
      const result = lc({
        configured: true,
        current: currentRecord({ fresh: true, skipped }),
        now: NOW,
      });
      expect(result.attention?.code).toBe("pages-skipped");
      expect(result.attention?.message).toBe(text);
      expect(result.skipped).toEqual(skipped);
    });
});

describe("automation.silent: exactly how long a quiet schedule is tolerated", () => {
  const cases: Array<{ name: string; automation: LifecycleInput["automation"]; silent: boolean; lastRunAt: string }> = [
    {
      name: "no automation record at all is never silent, and has no last-run time",
      automation: undefined,
      silent: false,
      lastRunAt: "",
    },
    {
      name: "exactly AUTOMATION_SILENT_MS since the plugin first ran, with no scheduled run ever seen, is not yet silent",
      automation: { since: NOW - AUTOMATION_SILENT_MS },
      silent: false,
      lastRunAt: "",
    },
    {
      name: "one millisecond past AUTOMATION_SILENT_MS since the plugin first ran, with no scheduled run ever seen, is silent",
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      silent: true,
      lastRunAt: "",
    },
    {
      name: "exactly AUTOMATION_SILENT_MS since the last scheduled run is not yet silent",
      automation: { since: 0, scheduledAt: NOW - AUTOMATION_SILENT_MS },
      silent: false,
      lastRunAt: new Date(NOW - AUTOMATION_SILENT_MS).toISOString(),
    },
    {
      name: "one millisecond past AUTOMATION_SILENT_MS since the last scheduled run is silent",
      automation: { since: 0, scheduledAt: NOW - AUTOMATION_SILENT_MS - 1 },
      silent: true,
      lastRunAt: new Date(NOW - AUTOMATION_SILENT_MS - 1).toISOString(),
    },
  ];

  for (const { name, automation, silent, lastRunAt } of cases)
    test(name, () => {
      const result = lc({ configured: true, automation, now: NOW });
      expect(result.automation.silent).toBe(silent);
      expect(result.automation.lastRunAt).toBe(lastRunAt);
    });
});

describe("nextAction: the single recommendation shown for every reachable state", () => {
  test("unconfigured points at Setup, with the configure code", () => {
    const result = lc({ configured: false, now: NOW });
    expect(result.nextAction).toEqual({
      code: "configure",
      message: "Add your public website address in Setup → Website, then save and generate.",
    });
  });

  test("never-generated asks for a first generation, with the generate code", () => {
    const result = lc({ configured: true, now: NOW });
    expect(result.nextAction).toEqual({
      code: "generate",
      message: "Choose Save & generate to create the sitemap, exports and page metadata.",
    });
  });

  test("outdated asks to regenerate and mentions the automatic run, with the same generate code but a different message than never-generated", () => {
    const result = lc({ configured: true, current: currentRecord({ fresh: false }), now: NOW });
    expect(result.nextAction).toEqual({
      code: "generate",
      message: "Published content or settings changed. Choose Save & generate, or wait for the next automatic run.",
    });
  });

  test("generating says to wait, since the batch continues on its own", () => {
    const result = lc({ configured: true, pending: pendingRecord(), now: NOW });
    expect(result.nextAction).toEqual({
      code: "wait",
      message: "Generation is in progress and continues automatically every minute.",
    });
  });

  test("ready says there is nothing to do", () => {
    const result = lc({ configured: true, current: currentRecord({ fresh: true }), now: NOW });
    expect(result.nextAction).toEqual({ code: "none", message: "Everything is up to date." });
  });

  test("a generation stuck at MAX_ATTEMPTS asks to fix the error first, overriding the normal wait message", () => {
    const result = lc({
      configured: true,
      pending: pendingRecord({
        offset: 5,
        total: 5,
        attempt: { step: "commit", count: MAX_ATTEMPTS, error: "Disk is full" },
      }),
      now: NOW,
    });
    expect(result.nextAction).toEqual({
      code: "fix-error",
      message:
        "Fix the reported problem, then choose Save & generate. The last good sitemap and exports stay online meanwhile.",
    });
  });

  test("a silent schedule asks to resume it, overriding the normal generate message", () => {
    const result = lc({
      configured: true,
      current: currentRecord({ fresh: false }),
      automation: { since: NOW - AUTOMATION_SILENT_MS - 1 },
      now: NOW,
    });
    expect(result.nextAction.code).toBe("resume-schedule");
  });
});

describe("describeError: what ends up in the sandbox console", () => {
  test("an Error whose stack does not already contain the message gets the message prepended", () => {
    const error = new Error("boom");
    error.stack = "at somewhere\n    at somewhere-else";
    expect(describeError(error)).toBe("Error: boom\nat somewhere\n    at somewhere-else");
  });

  test("an Error whose stack already contains the message is printed as-is, without duplicating it", () => {
    const error = new Error("boom");
    const stack = error.stack;
    expect(stack).toContain("boom");
    expect(describeError(error)).toBe(stack as string);
  });

  test("a value that is not an Error is just stringified", () => {
    expect(describeError("plain failure")).toBe("plain failure");
    expect(describeError(42)).toBe("42");
  });
});
