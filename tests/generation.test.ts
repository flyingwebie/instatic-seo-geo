import { describe, expect, test } from "bun:test";
import { complete, document, fakeHost } from "./fixtures";
import { PublicationService } from "../src/service";

describe("Generation lifecycle and current eligibility", () => {
  test("stages privately, commits after HTML refresh, and survives activation/upgrade", async () => {
    const host = fakeHost(
      Array.from({ length: 8 }, (_, i) => document("/" + i)),
    );
    expect((await host.service.rebuild()).done).toBe(false);
    expect((await host.service.publicFile("/sitemap.xml")).status).toBe(503);
    await complete(host.service);
    expect(host.refreshes.flat()).toHaveLength(8);
    const restarted = new PublicationService(host.api);
    expect((await restarted.status()).generated).toBe(8);
    expect((await restarted.download()).headers["Content-Type"]).toBe(
      "application/zip",
    );
    expect((await restarted.publicFile("/random-missing")).status).toBe(404);
  });
  test("failed generations retain valid documents but immediately retract removed routes", async () => {
    const host = fakeHost([document("/kept"), document("/removed")]);
    await complete(host.service);
    host.setDocuments([document("/kept"), document("/broken")]);
    host.failRender("/broken");
    await expect(complete(host.service)).rejects.toThrow(
      "Injected render failure",
    );
    expect(
      (await host.service.publicFile("/markdown/kept/index.md")).status,
    ).toBe(200);
    expect(
      (await host.service.publicFile("/markdown/removed/index.md")).status,
    ).toBe(404);
    expect((await host.service.publicFile("/sitemap.xml")).body).not.toContain(
      "/removed",
    );
    host.failRender("");
    await complete(host.service);
    expect((await host.service.status()).generated).toBe(2);
  });
  test("renames retract old Markdown and create redirects only to currently eligible pages", async () => {
    const host = fakeHost([document("/old", undefined, { id: "stable" })]);
    await complete(host.service);
    host.setDocuments([
      document("/new", undefined, { id: "stable", revision: "r2" }),
    ]);
    await complete(host.service);
    expect((await host.service.publicFile("/old")).status).toBe(301);
    expect((await host.service.publicFile("/old")).headers).toHaveProperty(
      "Location",
      "https://example.com/new",
    );
    expect(
      (await host.service.publicFile("/markdown/old/index.md")).status,
    ).toBe(404);
    host.setDocuments([]);
    expect((await host.service.publicFile("/old")).status).toBe(404);
  });
  test("configured redirects also answer the trailing-slash form of the old path", async () => {
    const host = fakeHost([document("/about")]);
    host.values.options = JSON.stringify({
      redirects: [{ from: "/about-us/", to: "/about", status: 301 }],
    });
    await complete(host.service);
    for (const path of ["/about-us", "/about-us/"]) {
      const response = await host.service.publicFile(path);
      expect(response.status).toBe(301);
      expect(response.headers).toHaveProperty(
        "Location",
        "https://example.com/about",
      );
    }
    expect((await host.service.publicFile("/about-us//")).status).toBe(404);
  });
  test("redirects keep working when their target is republished, until it is removed", async () => {
    const host = fakeHost([document("/about", undefined, { id: "about" })]);
    host.values.options = JSON.stringify({
      redirects: [{ from: "/about-us", to: "/about", status: 301 }],
    });
    await complete(host.service);
    host.setDocuments([
      document("/about", "<main>Edited</main>", { id: "about", revision: "r2" }),
    ]);
    const response = await host.service.publicFile("/about-us/");
    expect(response.status).toBe(301);
    expect(response.headers).toHaveProperty("Location", "https://example.com/about");
    // The page's previous Markdown keeps answering until the next generation.
    expect((await host.service.publicFile("/markdown/about/index.md")).status).toBe(200);
    host.setDocuments([]);
    expect((await host.service.publicFile("/about-us")).status).toBe(404);
  });
  test("Checks do not report redirects as broken while their target is republished", async () => {
    const host = fakeHost([document("/about", undefined, { id: "about" })]);
    host.values.options = JSON.stringify({
      redirects: [{ from: "/about-us", to: "/about", status: 301 }],
    });
    await complete(host.service);
    host.setDocuments([
      document("/about", "<main>Edited</main>", { id: "about", revision: "r2" }),
    ]);
    const codes = (await host.service.status()).findings.map((f) => f.code);
    expect(codes).not.toContain("redirect.target-ineligible");
    host.setDocuments([]);
    const after = (await host.service.status()).findings.map((f) => f.code);
    expect(after).toContain("redirect.target-ineligible");
  });
  test("a publish regenerates only the pages that changed; a settings change regenerates all", async () => {
    const docs = Array.from({ length: 6 }, (_, i) =>
      document("/" + i, undefined, { id: "p" + i }),
    );
    const host = fakeHost(docs);
    await complete(host.service);
    const rendered: string[] = [];
    const render = host.api.cms.publication.render;
    host.api.cms.publication.render = (options) => {
      rendered.push(options.path);
      return render(options);
    };
    host.refreshes.length = 0;
    const edited = document("/2", "<main>Edited</main>", { id: "p2", revision: "r2" });
    host.setDocuments(docs.map((doc, i) => (i === 2 ? edited : doc)));
    await complete(host.service);
    expect(rendered).toEqual(["/2"]);
    expect(host.refreshes.flat()).toEqual(["/2"]);
    expect((await host.service.status()).generated).toBe(6);
    expect(String((await host.service.publicFile("/markdown/2/index.md")).body)).toContain("Edited");

    rendered.length = 0;
    host.refreshes.length = 0;
    host.values.options = '{"pages":{"/0":{"title":"Zero"}}}';
    await complete(host.service);
    expect(rendered).toHaveLength(6);
    expect(host.refreshes.flat()).toHaveLength(6);
  });
  test("exports never go blank: settings changes and edits keep the last version until the next commit", async () => {
    const host = fakeHost([document("/a")]);
    await complete(host.service);
    host.values.options = '{"pages":{"/a":{"index":false}}}';
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(200);
    await complete(host.service);
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(404);
    host.values.options = "{}";
    await complete(host.service);
    host.setDocuments([
      document("/a", "<main>Changed</main>", { revision: "r2" }),
    ]);
    // Edited but not yet regenerated: the previous export still answers.
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(200);
    expect(String((await host.service.publicFile("/sitemap.xml")).body)).toContain("/a");
    // Removed: it drops out at once, without waiting for a generation.
    host.setDocuments([]);
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(404);
    expect(String((await host.service.publicFile("/sitemap.xml")).body)).not.toContain("/a<");
  });
  test("publication races restart staging; refresh failures never commit", async () => {
    const host = fakeHost(
      Array.from({ length: 5 }, (_, i) => document("/" + i)),
    );
    await host.service.rebuild();
    host.setDocuments([document("/replacement")]);
    host.failRefresh(true);
    await expect(complete(host.service)).rejects.toThrow("refresh failure");
    expect((await host.service.publicFile("/sitemap.xml")).status).toBe(503);
    host.failRefresh(false);
    await complete(host.service);
    expect((await host.service.status()).generated).toBe(1);
    expect((await host.service.publicFile("/sitemap.xml")).body).toContain(
      "/replacement",
    );
  });
  test("collection allowlists prevent rendering/exporting omitted tables; valid hreflang is reciprocal", async () => {
    const host = fakeHost([
      document("/en"),
      {
        ...document("/fr"),
        html: document("/fr").html.replace('lang="en"', 'lang="fr"'),
      },
      document("/private/x", undefined, {
        kind: "entry",
        tableSlug: "private-records",
      }),
    ]);
    host.values.options =
      '{"translations":[[{"path":"/en","language":"en"},{"path":"/fr","language":"fr"}]]}';
    await complete(host.service);
    expect((await host.service.status()).generated).toBe(2);
    expect(
      (await host.service.publicFile("/markdown/private/x/index.md")).status,
    ).toBe(404);
    const html = await host.service.enrich(document("/en").html, {
      urlPath: "/en",
      pageId: "/en",
      publishedAt: document().route.publishedAt,
      firstPublishedAt: document().route.firstPublishedAt,
    });
    expect(html).toContain(
      'type="text/markdown" href="https://example.com/markdown/en/index.md"',
    );
    expect(html).toContain('hreflang="en" href="https://example.com/en"');
    expect(html).toContain('hreflang="fr" href="https://example.com/fr"');
    host.values.options =
      '{"pages":{"/fr":{"index":false}},"translations":[[{"path":"/en","language":"en"},{"path":"/fr","language":"fr"}]]}';
    await complete(host.service);
    expect((await host.service.publicFile("/sitemap.xml")).body).not.toContain(
      "hreflang=",
    );
    expect(
      await host.service.enrich(document("/en").html, {
        urlPath: "/en",
        pageId: "/en",
      }),
    ).not.toContain("hreflang=");
  });
});
