import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { parseOptions } from "../src/config";
import { enrichPage, generateDocument } from "../src/page";
import {
  contentZip,
  redirectsFor,
  robotsTxt,
  sitemapFiles,
} from "../src/discovery";
import { auditSite } from "../src/audit";
import { elements, parsePage } from "../src/html";
import { document, origin } from "./fixtures";

describe("Published content representations", () => {
  test("preserves structure, code, links, tables and images while omitting hidden/request content", async () => {
    const code =
      "const a = " +
      String.fromCharCode(96) +
      "x" +
      String.fromCharCode(96) +
      ";\nconsole.log(a);";
    const doc = document(
      "/guides/caf%C3%A9",
      '<nav>Navigation secret</nav><main><h1>Café guide</h1><h2>Sources</h2><p>Read <a href="/about">about us</a> and <strong>evidence</strong>.</p><ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><table><tr><th>Name</th><th>Value</th></tr><tr><td>Café</td><td>1 | 2</td></tr></table><pre><code class="language-js">' +
        code +
        '</code></pre><img src="/photo.jpg" alt="A café"><p hidden>Hidden private</p><instatic-hole>Personalized private</instatic-hole></main>',
    );
    const { page } = await generateDocument(doc, origin, {}, "c", [doc.route]);
    expect(page.markdown).toContain("# Café guide");
    expect(page.markdown).toContain("[about us](<https://example.com/about>)");
    expect(page.markdown).toContain("  - Nested");
    expect(page.markdown).toContain("1 \\| 2");
    expect(page.markdown).toContain(code);
    expect(page.markdown).toContain(
      "![A café](<https://example.com/photo.jpg>)",
    );
    expect(page.markdown).not.toContain("private");
    expect(page.markdown).not.toContain("Navigation secret");
  });
  test("reconciles authored schema, validates visible FAQs and escapes injection", () => {
    const doc = document(
      "/article",
      "<main><h1>Visible title</h1><p>Jane Doe wrote this.</p><h2>Why?</h2><p>Because evidence matters.</p></main>",
      { kind: "entry", tableSlug: "posts" },
    );
    const html = doc.html.replace(
      "</head>",
      '<meta name="description" content="Authored description"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Authored headline"}</script></head>',
    );
    const options = {
      profiles: [{ id: "jane", name: "Jane Doe", type: "Person" as const }],
      pages: {
        "/article": {
          authors: ["jane"],
          faqs: [
            { question: "Why?", answer: "Because evidence matters." },
            { question: "Invented?", answer: "Hidden answer" },
          ],
        },
      },
    };
    const enriched = enrichPage(
      html,
      doc.route,
      origin,
      doc.siteName,
      options,
      [doc.route],
    );
    expect(enriched.page.description).toBe("Authored description");
    expect(
      enriched.page.schemas.filter((node) => node["@type"] === "Article"),
    ).toHaveLength(1);
    expect(
      enriched.page.schemas.find((node) => node["@type"] === "Article")
        ?.headline,
    ).toBe("Authored headline");
    expect(
      enriched.page.schemas.find((node) => node["@type"] === "FAQPage")
        ?.mainEntity,
    ).toHaveLength(1);
    expect(
      enriched.page.findings.some(
        (finding) => finding.code === "faq.not-visible",
      ),
    ).toBe(true);
    expect(enriched.html.match(/id="seo-geo-jsonld"/g)).toHaveLength(1);
    const unsafe = enrichPage(doc.html, doc.route, origin, "Example", {
      pages: { "/article": { title: "</script><script>bad()</script>" } },
    });
    expect(elements(parsePage(unsafe.html).document, "script")).toHaveLength(1);
    expect(unsafe.html).toContain("\\u003cscript\\u003e");
  });
  test("unchanged republication keeps meaningful dates consistent in Markdown, HTML and Article schema", async () => {
    const first = document("/article", undefined, {
      kind: "entry",
      tableSlug: "posts",
    });
    const old = await generateDocument(first, origin, {}, "c", [first.route]);
    const next = {
      ...first,
      route: {
        ...first.route,
        publishedAt: "2026-10-01T00:00:00Z",
        revision: "r2",
      },
    };
    const generated = await generateDocument(
      next,
      origin,
      {},
      "c",
      [next.route],
      old.page,
    );
    expect(generated.page.dateModified).toBe(old.page.dateModified);
    expect(
      generated.page.schemas.find((schema) => schema["@type"] === "Article")
        ?.dateModified,
    ).toBe(old.page.dateModified);
    expect(generated.html).toContain(old.page.dateModified);
    expect(generated.page.datePublished).toBe("2025-12-01T12:00:00.000Z");
  });
  test("noindex, cross-canonical and non-allowlisted entries are excluded", () => {
    const doc = document("/private", undefined, {
      kind: "entry",
      tableSlug: "private-records",
    });
    expect(
      enrichPage(doc.html, doc.route, origin, "Example", {}).page.indexable,
    ).toBe(false);
    expect(
      enrichPage(doc.html, doc.route, origin, "Example", {
        collectionTables: ["private-records"],
        pages: { "/private": { index: false } },
      }).page.indexable,
    ).toBe(false);
    expect(
      enrichPage(doc.html, doc.route, origin, "Example", {
        collectionTables: ["private-records"],
        pages: {
          "/private": { canonical: "https://elsewhere.example/article" },
        },
      }).page.indexable,
    ).toBe(false);
  });
  test("partitions XML by count and UTF-8 size and maps deterministic ZIP files to canonical URLs", async () => {
    const pages = await Promise.all(
      ["/a", "/b", "/caf%C3%A9"].map(
        async (path) =>
          (await generateDocument(document(path), origin, {}, "c", [])).page,
      ),
    );
    const maps = sitemapFiles(pages, origin, {}, { urls: 2, bytes: 2000 });
    expect(maps["/sitemap.xml"]).toContain("<sitemapindex");
    expect(maps["/sitemaps/2.xml"]).toContain(origin + "/caf%C3%A9");
    expect(maps["/sitemap.xml"]).not.toContain("/markdown/");
    const bytes = contentZip(pages, origin, {}, "g1"),
      files = unzipSync(bytes);
    expect(strFromU8(files["markdown/caf%C3%A9/index.md"]!)).toContain(
      'canonical: "https://example.com/caf%C3%A9"',
    );
    expect(strFromU8(files["export-manifest.json"]!)).toContain(
      "markdown/a/index.md",
    );
    expect(contentZip(pages, origin, {}, "g1")).toEqual(bytes);
    expect(() =>
      sitemapFiles(pages, origin, {}, { urls: 10, bytes: 200 }),
    ).toThrow("byte limit");
  });
  test("crawler search, training and user retrieval policies remain independent", () => {
    const robots = robotsTxt(origin, {
      searchAllowed: true,
      excludedPaths: ["/thank-you"],
      trainingAllowed: false,
      userRetrievalAllowed: false,
    });
    expect(robots).toContain(
      "User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nDisallow: /",
    );
    expect(robots).toContain(
      "User-agent: ChatGPT-User\nUser-agent: Claude-User\nDisallow: /",
    );
    expect(robots).toContain("Allow: /");
    expect(robots).not.toContain("Disallow: /uploads/");
    expect(robots).not.toContain("Disallow: /_instatic/\n");
    expect(robots).not.toContain("Disallow: /thank-you");
  });
  test("stable IDs produce safe redirects; cycles and external targets are rejected", async () => {
    const old = (await generateDocument(document("/old"), origin, {}, "c", []))
      .page;
    const next = { ...old, path: "/new", canonical: origin + "/new" };
    expect(redirectsFor({}, [old], [next])).toEqual([
      { from: "/old", to: "/new", status: 301 },
    ]);
    expect(() =>
      redirectsFor(
        {
          redirects: [
            { from: "/a", to: "/b" },
            { from: "/b", to: "/a" },
          ],
        },
        [],
        [next],
      ),
    ).toThrow("cycle");
    expect(() =>
      parseOptions('{"redirects":[{"from":"/old","to":"//evil.example"}]}'),
    ).toThrow("site-relative");
    expect(() =>
      parseOptions(
        '{"translations":[[{"path":"/en","language":"en"},{"path":"/other","language":"en"}]]}',
      ),
    ).toThrow("distinct");
  });
  test("audits duplicates, orphan/unresolved links, hreflang eligibility and media", async () => {
    const a = (
      await generateDocument(
        document(
          "/a",
          '<main><h1>Shared title</h1><p>Shared content.</p><a href="/missing">Missing</a><img src="/x.jpg"></main>',
        ),
        origin,
        {},
        "c",
        [],
      )
    ).page;
    const b = { ...a, path: "/b", canonical: origin + "/b", links: [] };
    const audit = auditSite([a, b], origin, {
      translations: [
        [
          { path: "/a", language: "fr" },
          { path: "/gone", language: "en" },
        ],
      ],
    });
    for (const code of [
      "title.duplicate",
      "link.orphan",
      "link.unresolved",
      "hreflang.ineligible",
      "hreflang.language",
      "image.alt-missing",
    ])
      expect(audit.findings.some((finding) => finding.code === code)).toBe(
        true,
      );
    expect(audit.suggestions.length).toBeGreaterThan(0);
  });
  test("specialized schemas describe visible entities and require an actual embedded video", () => {
    const doc = document(
      "/entities",
      '<main><h1>Product One</h1><p>Price 10.00 USD.</p><h2>Launch Event</h2><p>Main Hall, 123 Main Street</p><h2>Local Shop</h2><p>123 Main Street</p><h2>Demo Video</h2><video src="https://example.com/demo.mp4"></video></main>',
    );
    const options = parseOptions(
      JSON.stringify({
        pages: {
          "/entities": {
            schemas: [
              {
                type: "Product",
                name: "Product One",
                price: "10.00",
                currency: "USD",
              },
              {
                type: "Event",
                name: "Launch Event",
                startDate: "2026-11-01T10:00:00Z",
                locationName: "Main Hall",
                address: "123 Main Street",
              },
              {
                type: "LocalBusiness",
                name: "Local Shop",
                address: "123 Main Street",
              },
              {
                type: "VideoObject",
                name: "Demo Video",
                description: "A demonstration",
                uploadDate: "2026-01-01",
                thumbnailUrl: origin + "/thumb.jpg",
                contentUrl: origin + "/demo.mp4",
                duration: "PT1M",
              },
            ],
          },
        },
      }),
    );
    const result = enrichPage(doc.html, doc.route, origin, "Example", options);
    for (const type of ["Product", "Event", "LocalBusiness", "VideoObject"])
      expect(
        result.page.schemas.some((schema) => schema["@type"] === type),
      ).toBe(true);
    const missingVideo = enrichPage(
      doc.html.replace(
        '<video src="https://example.com/demo.mp4"></video>',
        "",
      ),
      doc.route,
      origin,
      "Example",
      options,
    );
    expect(
      missingVideo.page.schemas.some(
        (schema) => schema["@type"] === "VideoObject",
      ),
    ).toBe(false);
    expect(() =>
      parseOptions(
        '{"pages":{"/":{"schemas":[{"type":"Event","name":"X","startDate":"bad","locationName":"X","address":"Y"}]}}}',
      ),
    ).toThrow("ISO date");
  });
});
