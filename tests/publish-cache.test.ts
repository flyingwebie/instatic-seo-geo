import { describe, expect, test } from "bun:test";
import { complete, document, fakeHost } from "./fixtures";

describe("publish.html read cache", () => {
  test("a full publish reads stored state once, not once per page", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => document("/" + i));
    const host = fakeHost(pages);
    await complete(host.service);
    const collection = host.api.cms.storage.collection;
    let lists = 0;
    host.api.cms.storage.collection = (resource) => {
      const inner = collection(resource);
      return {
        ...inner,
        list: (...args) => {
          lists++;
          return inner.list(...args);
        },
      };
    };
    for (const page of pages)
      await host.service.enrich(page.html, {
        urlPath: page.route.path,
        pageId: page.route.id,
      });
    // current + pending + documents + og-index, shared by all 20 pages.
    expect(lists).toBeLessThanOrEqual(4);
  });

  test("a new generation replaces the cached documents", async () => {
    const host = fakeHost([document("/a")]);
    await complete(host.service);
    const before = await host.service.enrich(document("/a").html, {
      urlPath: "/a",
      pageId: "/a",
    });
    expect(before).toContain('type="text/markdown"');
    host.values.options = '{"pages":{"/a":{"index":false}}}';
    await complete(host.service);
    const after = await host.service.enrich(document("/a").html, {
      urlPath: "/a",
      pageId: "/a",
    });
    expect(after).not.toContain('type="text/markdown"');
  });
});
