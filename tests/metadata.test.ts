import { describe, expect, test } from "bun:test";
import { enrichPage } from "../src/page";
import { parseOptions } from "../src/config";
import { complete, document, fakeHost, origin } from "./fixtures";

const page = (body: string, path = "/services", options = "{}", extra = {}) =>
  enrichPage(
    `<!doctype html><html lang="en"><head><title>Services</title></head><body><main>${body}</main></body></html>`,
    { path, kind: "page", ...extra },
    origin,
    "Example",
    parseOptions(options),
  );
const codes = (result: ReturnType<typeof page>) =>
  result.page.findings.map((finding) => finding.code);
const sentence =
  "We design and build websites, custom software and automations for small and medium businesses.";

describe("Description used when a page has none of its own", () => {
  test("a short label above the heading is passed over for the first real paragraph", () => {
    const result = page(`<p>Services · Cork</p><h1>What we do</h1><p>${sentence}</p>`);
    expect(result.page.description).toBe(sentence);
    expect(result.html).toContain(`<meta name="description" content="${sentence}">`);
  });
  test("a page with only short text keeps that text and is flagged as too short", () => {
    const result = page("<p>About</p><h1>About us</h1>");
    expect(result.page.description).toBe("About");
    expect(codes(result)).toContain("description.short");
  });
  test("a long paragraph is cut at a sentence when one fits, otherwise at a word with an ellipsis", () => {
    const first = page(`<h1>Work</h1><p>${sentence} ${"More detail follows here. ".repeat(10)}</p>`);
    expect(first.page.description.length).toBeLessThanOrEqual(155);
    expect(first.page.description.endsWith(".")).toBe(true);
    const second = page(`<h1>Work</h1><p>${"automation ".repeat(40)}</p>`);
    expect(second.page.description.length).toBeLessThanOrEqual(156);
    expect(second.page.description.endsWith("…")).toBe(true);
    expect(second.page.description).not.toMatch(/automatio…$/);
  });
  test("an authored description always wins and a very long one is only a tip", () => {
    const long = "A".repeat(170);
    const result = page(
      `<p>${sentence}</p>`,
      "/services",
      JSON.stringify({ pages: { "/services": { description: long } } }),
    );
    expect(result.page.description).toBe(long);
    expect(codes(result)).toContain("description.long");
    expect(codes(result)).not.toContain("description.short");
  });
});

describe("Pages kept out of search results", () => {
  test("page 2 of a listing is noindex,follow by default and says why", () => {
    const result = page(`<h1>Blog</h1><p>${sentence}</p>`, "/insights/page/2");
    expect(result.page.indexable).toBe(false);
    expect(result.page.follow).toBe(true);
    expect(result.html).toContain('<meta name="robots" content="noindex,follow');
    const note = result.page.findings.find((f) => f.code === "indexability.excluded");
    expect(note?.message).toContain("Later pages of a listing");
    // A page that is hidden on purpose is not asked for a better description.
    expect(codes(page("<p>Blog</p>", "/insights/page/2"))).not.toContain("description.short");
  });
  test("page 1 of a listing is the listing itself and stays indexable", () => {
    expect(page(`<p>${sentence}</p>`, "/insights/page/1").page.indexable).toBe(true);
    expect(page(`<p>${sentence}</p>`, "/insights/page/10").page.indexable).toBe(false);
    expect(page(`<p>${sentence}</p>`, "/insights/page/02").page.indexable).toBe(true);
  });
  test("a path that only contains the word page is not treated as pagination", () => {
    expect(page(`<p>${sentence}</p>`, "/landing-page/2-for-1").page.indexable).toBe(true);
    expect(page(`<p>${sentence}</p>`, "/page/about").page.indexable).toBe(true);
  });
  test("a paginated page can be indexed again by setting it explicitly", () => {
    const result = page(
      `<p>${sentence}</p>`,
      "/insights/page/2",
      '{"pages":{"/insights/page/2":{"index":true}}}',
    );
    expect(result.page.indexable).toBe(true);
  });
  test("a thank-you page is hidden by default and can be indexed again explicitly", () => {
    const hidden = page(`<p>${sentence}</p>`, "/thank-you");
    expect(hidden.page.indexable).toBe(false);
    expect(hidden.html).toContain('content="noindex,follow');
    expect(
      hidden.page.findings.find((f) => f.code === "indexability.excluded")?.message,
    ).toContain("after a form is sent");
    expect(page(`<p>${sentence}</p>`, "/contact/thanks").page.indexable).toBe(false);
    // Only the exact slug counts, never a page that merely mentions thanks.
    expect(page(`<p>${sentence}</p>`, "/thanksgiving-offers").page.indexable).toBe(true);
    expect(page(`<p>${sentence}</p>`, "/thank-you/guide").page.indexable).toBe(true);
    const shown = page(
      `<p>${sentence}</p>`,
      "/thank-you",
      '{"pages":{"/thank-you":{"index":true}}}',
    );
    expect(shown.page.indexable).toBe(true);
  });
  test("paginated and hidden pages are left out of the sitemap, llms.txt and Markdown", async () => {
    const host = fakeHost([
      document("/insights", `<main><h1>Blog</h1><p>${sentence}</p></main>`),
      document("/insights/page/2", `<main><h1>Blog</h1><p>${sentence}</p></main>`),
      document("/thank-you", `<main><h1>Thanks</h1><p>${sentence}</p></main>`),
    ]);
    host.values.llmsEnabled = true;
    await complete(host.service);
    const sitemap = String((await host.service.publicFile("/sitemap.xml")).body);
    expect(sitemap).toContain("https://example.com/insights</loc>");
    expect(sitemap).not.toContain("/page/2");
    expect(sitemap).not.toContain("/thank-you");
    const llms = String((await host.service.publicFile("/llms.txt")).body);
    expect(llms).not.toContain("/page/2");
    expect(llms).not.toContain("/thank-you");
    expect((await host.service.publicFile("/markdown/insights/page/2/index.md")).status).toBe(404);
    expect((await host.service.publicFile("/markdown/thank-you/index.md")).status).toBe(404);
    const status = await host.service.status();
    expect(status.indexable).toBe(1);
  });
});

describe("Which collections are articles", () => {
  const entry = (tableSlug: string, options: string) =>
    page(`<h1>Entry</h1><p>${sentence}</p>`, `/${tableSlug}/one`, options, {
      kind: "entry",
      tableSlug,
    });
  const isArticle = (result: ReturnType<typeof page>) =>
    result.page.schemas.some((schema) => schema["@type"] === "Article");
  test("every public collection is an article collection until some are named", () => {
    const options = '{"collectionTables":["insights","our-work"]}';
    expect(isArticle(entry("insights", options))).toBe(true);
    expect(isArticle(entry("our-work", options))).toBe(true);
  });
  test("only named collections get Article data and the byline check", () => {
    const options =
      '{"collectionTables":["insights","our-work"],"articleTables":["insights"]}';
    const article = entry("insights", options);
    const project = entry("our-work", options);
    expect(isArticle(article)).toBe(true);
    expect(codes(article)).toContain("author.missing");
    expect(isArticle(project)).toBe(false);
    expect(codes(project)).not.toContain("author.missing");
    expect(project.html).toContain('<meta property="og:type" content="website">');
    // Still a public page: only the article treatment is dropped.
    expect(project.page.indexable).toBe(true);
  });
  test("the AI Overviews review asks only articles for a byline, a date and sources once collections are named", () => {
    const check = (result: ReturnType<typeof page>, id: string) =>
      result.page.aio?.checks.find((item) => item.id === id);
    const named = '{"collectionTables":["insights","our-work"],"articleTables":["insights"]}';
    const service = page(`<h1>Services</h1><p>${sentence}</p>`, "/services", named);
    expect(service.page.aio?.checks).toHaveLength(5);
    expect(check(service, "attribution")?.status).toBe("pass");
    expect(check(service, "attribution")?.detail).toContain("not an article");
    expect(check(service, "sources")?.status).toBe("pass");
    expect(check(entry("our-work", named), "attribution")?.status).toBe("pass");
    // A real article is still asked.
    expect(check(entry("insights", named), "attribution")?.status).toBe("review");
    expect(check(entry("insights", named), "sources")?.status).toBe("review");
    // Nothing changes for a site that has not named its article collections.
    const unnamed = page(`<h1>Services</h1><p>${sentence}</p>`, "/services");
    expect(check(unnamed, "attribution")?.status).toBe("review");
    expect(check(unnamed, "sources")?.status).toBe("review");
  });
  test("one entry can still be made an article by hand", () => {
    const options =
      '{"collectionTables":["our-work"],"articleTables":["insights"],"pages":{"/our-work/one":{"articleType":"BlogPosting"}}}';
    expect(
      entry("our-work", options).page.schemas.some(
        (schema) => schema["@type"] === "BlogPosting",
      ),
    ).toBe(true);
  });
});

test("status counts the routes a generation covers apart from every published route", async () => {
  const host = fakeHost([
    document("/"),
    document("/insights/a", undefined, { kind: "entry", tableSlug: "insights" }),
    document("/testimonials/a", undefined, { kind: "entry", tableSlug: "testimonials" }),
  ]);
  host.values.options = '{"collectionTables":["insights"]}';
  await complete(host.service);
  const status = await host.service.status();
  expect(status.total).toBe(3);
  expect(status.included).toBe(2);
  expect(status.generated).toBe(2);
});
