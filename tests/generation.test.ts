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
  test("configuration and changed-route revisions cannot serve stale exports", async () => {
    const host = fakeHost([document("/a")]);
    await complete(host.service);
    host.values.options = '{"pages":{"/a":{"index":false}}}';
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(
      503,
    );
    await complete(host.service);
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(
      404,
    );
    host.values.options = "{}";
    await complete(host.service);
    host.setDocuments([
      document("/a", "<main>Changed</main>", { revision: "r2" }),
    ]);
    expect((await host.service.publicFile("/markdown/a/index.md")).status).toBe(
      404,
    );
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
