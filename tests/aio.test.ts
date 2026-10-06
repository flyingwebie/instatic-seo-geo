import { expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { enrichPage, GeneratedPageSchema } from "../src/page";
import { parseOptions, validate } from "../src/config";
import { meta, parsePage } from "../src/html";
import { PublicationService } from "../src/service";
import { document, fakeHost, origin } from "./fixtures";
import {
  addPage,
  initialConfiguration,
  optionalText,
  removeProfile,
  serializeOptions,
  updatePage,
} from "../admin/configuration/model";

const answer =
  "Most website projects take four to six weeks, depending on the agreed scope and content readiness.";
function enriched(robots = "", options = {}) {
  const doc = document(
    "/guide",
    `<main><h1>How long does a website project take?</h1><p>${answer}</p><p>Jane Smith wrote this.</p><a href="https://developers.google.com/search/docs/appearance/ai-features">Google documentation</a></main>`,
    { kind: "entry", tableSlug: "posts" },
  );
  return enrichPage(
    doc.html.replace("</head>", robots + "</head>"),
    doc.route,
    origin,
    "Example",
    options,
    [doc.route],
  );
}
test("AIO verifies a visible selected answer, topic, sources and author without claiming rankings", () => {
  const result = enriched("", {
    profiles: [{ id: "jane", name: "Jane Smith", type: "Person" }],
    pages: {
      "/guide": {
        authors: ["jane"],
        aioQuestion: "How long does a website project take?",
        aioAnswer: answer,
      },
    },
  });
  expect(
    result.page.aio?.checks.every((check) => check.status === "pass"),
  ).toBe(true);
  expect(result.page.aio?.answer).toBe(answer);
  expect(result.page.aio?.sourceCount).toBe(1);
  expect(result.html).not.toContain("aioQuestion");
  expect(
    result.page.schemas.some((node) => String(node["@type"]).includes("AI")),
  ).toBe(false);
});
test("an unpublished answer stays an editorial finding and is never inserted into HTML", () => {
  const result = enriched("", {
    pages: {
      "/guide": {
        aioAnswer: "Secret invented answer",
        aioQuestion: "Unpublished question",
      },
    },
  });
  expect(
    result.page.aio?.checks.find((check) => check.id === "answer")?.status,
  ).toBe("review");
  expect(
    result.page.aio?.checks.find((check) => check.id === "question")?.status,
  ).toBe("review");
  expect(result.html).not.toContain("Secret invented answer");
});
test("hidden, dynamic and data-nosnippet passages are not AIO answer candidates", () => {
  const doc = document(
    "/",
    `<main><h1>Guide</h1><p hidden>${answer}</p><instatic-hole><p>${answer}</p></instatic-hole><div data-nosnippet><p>${answer}</p></div><p><span data-nosnippet>${answer}</span></p></main>`,
  );
  const result = enrichPage(doc.html, doc.route, origin, "Example", {});
  expect(result.page.aio?.answer).toBe("");
  expect(
    result.page.aio?.checks.find((check) => check.id === "answer")?.status,
  ).toBe("review");
});
test("authored snippet, preview and archive directives survive generation and block local AIO readiness", () => {
  const result = enriched(
    '<meta name="robots" content="index, follow, nosnippet, max-image-preview:large, noarchive, max-snippet: 0">',
  );
  const robots = meta(parsePage(result.html).head, "robots");
  expect(robots).toContain("nosnippet");
  expect(robots).toContain("max-snippet:0");
  expect(robots).toContain("max-image-preview:large");
  expect(robots).toContain("noarchive");
  expect(result.page.indexable).toBe(true);
  expect(
    result.page.aio?.checks.find((check) => check.id === "discovery")?.status,
  ).toBe("blocked");
});
test("explicit snippet allow clears generic restrictions but honours Googlebot-specific restrictions", () => {
  const result = enriched(
    '<meta name="robots" content="nosnippet,max-snippet:0"><meta name="googlebot" content="nosnippet">',
    { pages: { "/guide": { snippetAllowed: true, maxSnippet: -1 } } },
  );
  expect(meta(parsePage(result.html).head, "robots")).toBe(
    "index,follow,max-snippet:-1",
  );
  expect(meta(parsePage(result.html).head, "googlebot")).toBe("nosnippet");
  expect(
    result.page.aio?.checks.find((check) => check.id === "discovery")?.status,
  ).toBe("blocked");
});
test("search access, noindex and explicit snippet controls affect local AIO checks", () => {
  for (const options of [
    { searchAllowed: false },
    { pages: { "/guide": { index: false } } },
    { pages: { "/guide": { snippetAllowed: false } } },
    { pages: { "/guide": { maxSnippet: 0 } } },
  ])
    expect(
      enriched("", options).page.aio?.checks.find(
        (check) => check.id === "discovery",
      )?.status,
    ).toBe("blocked");
  expect(
    enriched("", { trainingAllowed: false }).page.aio?.checks.find(
      (check) => check.id === "discovery",
    )?.status,
  ).toBe("pass");
});
test("AIO can be disabled without changing existing metadata or schema generation", () => {
  const result = enriched("", { aioEnabled: false });
  expect(result.page.aio).toBeUndefined();
  expect(result.page.schemas.some((node) => node["@type"] === "WebPage")).toBe(
    true,
  );
});
test("guided settings preserve all existing sections while changing one page field", () => {
  const original = parseOptions(
    JSON.stringify({
      collectionTables: ["posts", "guides"],
      publisher: "publisher",
      profiles: [
        {
          id: "publisher",
          name: "Example",
          type: "Organization",
          sameAs: ["https://example.com/social"],
        },
      ],
      pages: {
        "/guide": {
          title: "Original",
          index: false,
          follow: false,
          articleType: "BlogPosting",
          authors: ["publisher"],
          faqs: [{ question: "Why?", answer: "Because." }],
          schemas: [
            { type: "LocalBusiness", name: "Example", address: "Dublin" },
          ],
          breadcrumbs: [{ name: "Home", path: "/" }],
          datePublished: "2026-01-01",
          language: "en",
        },
      },
      redirects: [{ from: "/old", to: "/guide", status: 308 }],
      translations: [
        [
          { path: "/guide", language: "en" },
          { path: "/fr/guide", language: "fr" },
        ],
      ],
      excludedPaths: ["/private"],
      searchAllowed: true,
      trainingAllowed: false,
      userRetrievalAllowed: true,
    }),
  );
  const updated = parseOptions(
    serializeOptions(
      updatePage(original, "/guide", {
        title: "New title",
        aioAnswer: answer,
        snippetAllowed: true,
      }),
    ),
  );
  expect(updated.pages?.["/guide"]?.title).toBe("New title");
  expect(updated.pages?.["/guide"]?.faqs).toEqual(
    original.pages?.["/guide"]?.faqs,
  );
  expect(updated.redirects).toEqual(original.redirects);
  expect(updated.translations).toEqual(original.translations);
  expect(updated.profiles).toEqual(original.profiles);
  expect(updated.trainingAllowed).toBe(false);
});
test("turning off optional overrides omits fields and returns to published defaults", () => {
  const value = updatePage(
    {
      pages: {
        "/": {
          title: "Override",
          faqs: [{ question: "Q", answer: "A" }],
          index: false,
        },
      },
    },
    "/",
    { title: undefined, faqs: undefined },
  );
  expect(JSON.parse(serializeOptions(value)).pages["/"]).toEqual({
    index: false,
  });
  expect(optionalText("An answer ")).toBe("An answer ");
  expect(optionalText("  ")).toBeUndefined();
});
test("profile removal clears references without removing unrelated page settings", () => {
  const result = removeProfile(
    {
      publisher: "jane",
      profiles: [{ id: "jane", name: "Jane", type: "Person" }],
      pages: { "/": { authors: ["jane", "other"], title: "Keep" } },
    },
    "jane",
  );
  expect(result.publisher).toBeUndefined();
  expect(result.pages?.["/"]).toEqual({ authors: ["other"], title: "Keep" });
});
test("invalid stored JSON is surfaced without silently replacing it", () => {
  expect(initialConfiguration('{"unknown":true}').error).toContain("options");
  expect(initialConfiguration("{").error).toBeTruthy();
  expect(initialConfiguration("{}")).toEqual({ value: {}, error: "" });
  expect(() => addPage({}, "https://example.com/page")).toThrow();
  expect(addPage({}, "/guides/").path).toBe("/guides");
});
test("snippet limits reject fractions, NaN and values below minus one", () => {
  for (const limit of [-2, 1.5, "unlimited", null])
    expect(() =>
      parseOptions(JSON.stringify({ pages: { "/": { maxSnippet: limit } } })),
    ).toThrow();
  expect(
    parseOptions('{"pages":{"/":{"maxSnippet":-1}}}').pages?.["/"]?.maxSnippet,
  ).toBe(-1);
});
test("existing stored generated pages remain readable and stale format checkpoints regenerate", async () => {
  const host = fakeHost();
  const service = new PublicationService(host.api);
  while (!(await service.rebuild()).done) {
    /* resumable fixture generation */
  }
  const generated = host.records.find(
    (record) => record.resourceId === "documents",
  )!;
  const oldPage = JSON.parse(String(generated.data.content));
  delete oldPage.aio;
  validate(GeneratedPageSchema, oldPage);
  const current = host.records.find((record) => record.data.key === "current")!;
  const checkpoint = JSON.parse(String(current.data.value));
  checkpoint.configuration = "old-generation-format";
  current.data.value = JSON.stringify(checkpoint);
  expect((await service.status()).generated).toBe(0);
  while (!(await service.rebuild()).done) {
    /* refresh with current semantics */
  }
  expect((await service.status()).pages[0]?.aio?.checks.length).toBeGreaterThan(
    0,
  );
});
test("generation progress distinguishes document work from public HTML refresh", async () => {
  const host = fakeHost(
    Array.from({ length: 8 }, (_, i) => document(`/page-${i}`)),
  );
  const service = new PublicationService(host.api);
  const steps = [];
  let result;
  do {
    result = await service.rebuild();
    steps.push(result);
  } while (!result.done);
  expect(
    steps.some(
      (step) => step.phase === "documents" && step.offset < step.total,
    ),
  ).toBe(true);
  expect(
    steps.some((step) => step.phase === "html" && step.refreshed === 3),
  ).toBe(true);
  expect(
    steps.some((step) => step.phase === "html" && step.refreshed === 6),
  ).toBe(true);
  validate(
    Type.Array(GeneratedPageSchema),
    await Promise.all(
      host.records
        .filter((record) => record.resourceId === "documents")
        .map((record) => JSON.parse(String(record.data.content))),
    ),
  );
});
test("multiple authored robots elements keep the most restrictive controls", () => {
  const result = enriched(
    '<meta name="robots" content="index,follow"><meta name="ROBOTS" content="noindex,nosnippet">',
  );
  expect(result.page.indexable).toBe(false);
  expect(meta(parsePage(result.html).head, "robots")).toBe(
    "noindex,follow,nosnippet",
  );
  expect(
    result.page.aio?.checks.find((check) => check.id === "discovery")?.status,
  ).toBe("blocked");
});
test("blank required guided entries and duplicate profiles have actionable validation", () => {
  for (const options of [
    { profiles: [{ id: "x", name: "", type: "Person" }] },
    { pages: { "/": { faqs: [{ question: "Q", answer: "" }] } } },
    {
      pages: {
        "/": {
          schemas: [
            {
              type: "Event",
              name: "Event",
              address: "Dublin",
              locationName: "",
              startDate: "2026-11-01",
            },
          ],
        },
      },
    },
  ])
    expect(() => parseOptions(JSON.stringify(options))).toThrow(
      "required field",
    );
  expect(() =>
    parseOptions(
      JSON.stringify({
        profiles: [
          { id: "x", name: "Jane", type: "Person" },
          { id: "x", name: "Joe", type: "Person" },
        ],
      }),
    ),
  ).toThrow("unique");
});
test("expiration directives keep their complete date value during enrichment", () => {
  for (const date of [
    "25 Jun 2020 15:00:00 PST",
    "Wed, 03 Dec 2025 13:00:00 GMT",
    "2020-09-21",
  ]) {
    const result = enriched(
      `<meta name="robots" content="index, unavailable_after: ${date}, max-image-preview:large">`,
    );
    expect(meta(parsePage(result.html).head, "robots")).toContain(
      `unavailable_after: ${date}`,
    );
    expect(meta(parsePage(result.html).head, "robots")).toContain(
      "max-image-preview:large",
    );
    expect(
      result.page.aio?.checks.find((check) => check.id === "discovery")?.status,
    ).toBe("blocked");
  }
});
test("specialised schema validation names the failing field instead of a generic union error", () => {
  expect(() =>
    parseOptions(
      '{"pages":{"/":{"schemas":[{"type":"VideoObject","name":"Video","description":"Description","thumbnailUrl":"bad-url","uploadDate":"2026-10-06"}]}}}',
    ),
  ).toThrow("thumbnailUrl");
});
