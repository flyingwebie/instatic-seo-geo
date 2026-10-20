import { expect, test } from "bun:test";
import { complete, document, fakeHost } from "./fixtures";
import { renderOg } from "../src/og/render";
import { encodePng } from "../src/og/png";
import { fromBase64, toBase64, usesGenerated } from "../src/og/images";
import { ogData, parseOgTemplate, resolveTemplate, TEMPLATE_PRESETS } from "../src/og/template";
import { wrap } from "../src/og/text";
import { prepareLogo } from "../src/og/logo";

const data = {
  title: "Web design in Dublin that turns visitors into customers",
  description: "Fast, accessible websites for small businesses.",
  siteName: "Example",
  url: "example.com/services",
  section: "Services",
  date: "5 Oct 2026",
};

test("every preset renders a valid 1200×630 PNG", () => {
  for (const preset of TEMPLATE_PRESETS) {
    const png = encodePng(renderOg(resolveTemplate(preset.design), data));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect(png.length).toBeLessThan(250 * 1024);
  }
});

test("text renders: title pixels differ from the plain background", () => {
  const blank = renderOg(resolveTemplate({ gradient: "none", pattern: "none", showSiteName: false, showUrl: false, showSection: false }), { ...data, title: "", description: "" });
  const titled = renderOg(resolveTemplate({ gradient: "none", pattern: "none", showSiteName: false, showUrl: false, showSection: false }), data);
  let changed = 0;
  for (let i = 0; i < blank.data.length; i += 4) if (blank.data[i] !== titled.data[i]) changed++;
  expect(changed).toBeGreaterThan(5000);
});

test("long titles wrap within the line limit and end with an ellipsis", () => {
  const { lines, truncated } = wrap("word ".repeat(80), { weight: "bold", size: 72 }, 900, 3);
  expect(lines).toHaveLength(3);
  expect(truncated).toBe(true);
  expect(lines[2]!.at(-1)).toBe(0x2026);
});

test("titles drop a trailing site-name suffix and URLs lose the scheme", () => {
  const result = ogData(
    resolveTemplate({}),
    { title: "Services | Example", description: "", canonical: "https://www.example.com/services", datePublished: "2026-10-05T10:00:00Z", path: "/services", tableSlug: "case-studies" },
    "Example",
  );
  expect(result.title).toBe("Services");
  expect(result.url).toBe("example.com/services");
  expect(result.section).toBe("Case studies");
  expect(result.date).toBe("5 Oct 2026");
});

test("base64 round-trips binary data", () => {
  const bytes = new Uint8Array(1000).map((_, i) => (i * 37) % 256);
  for (const length of [0, 1, 2, 3, 999, 1000])
    expect([...fromBase64(toBase64(bytes.slice(0, length)))]).toEqual([...bytes.slice(0, length)]);
});

test("per-page images win; mode decides about images found in the page", () => {
  const missing = resolveTemplate({ enabled: true, mode: "missing" });
  const always = resolveTemplate({ enabled: true, mode: "always" });
  expect(usesGenerated(missing, { socialImage: "authored" })).toBe(false);
  expect(usesGenerated(always, { socialImage: "authored" })).toBe(false);
  expect(usesGenerated(missing, { socialImage: "meta" })).toBe(false);
  expect(usesGenerated(always, { socialImage: "meta" })).toBe(true);
  expect(usesGenerated(missing, { socialImage: "none" })).toBe(true);
  expect(usesGenerated(resolveTemplate({}), { socialImage: "none" })).toBe(false);
});

test("invalid colours are rejected with a helpful message", () => {
  expect(() => parseOgTemplate('{"background":"red"}')).toThrow("#1e3a8a");
});

test("generation renders, serves, references and cleans up social images", async () => {
  const host = fakeHost([document("/"), document("/about")]);
  host.values.ogTemplate = JSON.stringify({ enabled: true, brandMark: "EX" });
  await complete(host.service);
  const index = await host.service.ogIndex();
  expect(Object.keys(index)).toHaveLength(2);

  const status = await host.service.status();
  const url = status.pages.find((page) => page.path === "/about")?.ogImage;
  expect(url).toMatch(/^https:\/\/example\.com\/og\/[a-f0-9]{24}\.png$/);
  const file = (await host.service.publicFile(new URL(url!).pathname)) as {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
  };
  expect(file.status).toBe(200);
  expect(file.headers["Content-Type"]).toBe("image/png");
  expect(file.body[1]).toBe(80); // "P" of the PNG signature

  const html = await host.service.enrich(document("/about").html, {
    urlPath: "/about",
    pageId: "/about",
  });
  expect(html).toContain(`<meta property="og:image" content="${url}">`);
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html.match(/property="og:image"/g)).toHaveLength(1);

  // Changing the design replaces every image and removes the old ones.
  host.values.ogTemplate = JSON.stringify({ enabled: true, layout: "centered" });
  await complete(host.service);
  await host.service.cleanup();
  const next = await host.service.ogIndex();
  expect(Object.keys(next)).toHaveLength(2);
  expect(Object.keys(next).some((key) => key in index)).toBe(false);
  expect(host.records.filter((record) => record.resourceId === "images")).toHaveLength(2);
  expect((await host.service.publicFile(new URL(url!).pathname) as { status: number }).status).toBe(404);

  // Switching off removes stored images on the next cleanup.
  host.values.ogTemplate = "{}";
  await complete(host.service);
  await host.service.cleanup();
  expect(host.records.filter((record) => record.resourceId === "images")).toHaveLength(0);
});

test("pages with their own og:image keep it unless the mode is 'always'", async () => {
  const withImage = document("/own");
  withImage.html = withImage.html.replace("<head>", '<head><meta property="og:image" content="https://example.com/own.jpg">');
  const host = fakeHost([withImage, document("/plain")]);
  host.values.ogTemplate = JSON.stringify({ enabled: true });
  await complete(host.service);
  const status = await host.service.status();
  expect(status.pages.find((page) => page.path === "/own")?.ogImage).toBeUndefined();
  expect(status.pages.find((page) => page.path === "/plain")?.ogImage).toBeDefined();
  host.values.ogTemplate = JSON.stringify({ enabled: true, mode: "always" });
  await complete(host.service);
  expect((await host.service.status()).pages.every((page) => page.ogImage)).toBe(true);
});

test("there are 20 distinct presets that all parse as valid designs", () => {
  expect(TEMPLATE_PRESETS).toHaveLength(20);
  expect(new Set(TEMPLATE_PRESETS.map((p) => p.id)).size).toBe(20);
  for (const preset of TEMPLATE_PRESETS)
    expect(() => parseOgTemplate(JSON.stringify({ ...preset.design, preset: preset.id }))).not.toThrow();
});

const fakeLogo = () => {
  const width = 120,
    height = 60;
  const data = new Uint8Array(width * height * 4);
  // Opaque red block with a transparent 10px margin all round.
  for (let y = 10; y < 50; y++) for (let x = 10; x < 110; x++) data.set([220, 30, 30, 255], (y * width + x) * 4);
  return { width, height, data };
};

test("logos are trimmed, round-trip through storage encoding and keep a stable hash", async () => {
  const { encodeLogo, decodeLogo, logoHash } = await import("../src/og/logo");
  const trimmed = prepareLogo(fakeLogo(), false);
  expect([trimmed.width, trimmed.height]).toEqual([100, 40]);
  const upload = { name: "logo.png", width: trimmed.width, height: trimmed.height, data: encodeLogo(trimmed) };
  expect([...decodeLogo(upload).data]).toEqual([...trimmed.data]);
  expect(await logoHash(upload)).toMatch(/^[a-f0-9]{64}$/);
  expect(await logoHash(upload)).toBe(await logoHash({ ...upload }));
  expect(() => decodeLogo({ ...upload, width: 99 })).toThrow("does not match");
  // White backgrounds can be removed for JPG logos.
  const white = fakeLogo();
  for (let i = 0; i < white.data.length; i += 4) if (!white.data[i + 3]) white.data.set([255, 255, 255, 255], i);
  expect(prepareLogo(white, false).width).toBe(120);
  expect(prepareLogo(white, true).width).toBe(100);
});

test("a saved logo appears in generated images and changes their file names", async () => {
  const { encodeLogo } = await import("../src/og/logo");
  const host = fakeHost([document("/")]);
  host.values.ogTemplate = JSON.stringify({ enabled: true, showSiteName: false });
  await complete(host.service);
  const before = Object.keys(await host.service.ogIndex());
  const bitmap = prepareLogo(fakeLogo(), false);
  const saved = await host.service.saveLogo({ name: "logo.png", width: bitmap.width, height: bitmap.height, data: encodeLogo(bitmap) });
  expect((await host.service.logo(saved.hash))?.width).toBe(100);
  host.values.ogTemplate = JSON.stringify({ enabled: true, showSiteName: false, logo: { ...saved, name: "logo.png" } });
  await complete(host.service);
  const after = Object.keys(await host.service.ogIndex());
  expect(after.some((key) => !before.includes(key))).toBe(true);
  const status = await host.service.status();
  const png = (await host.service.publicFile(new URL(status.pages[0]!.ogImage!).pathname)) as { body: Uint8Array };
  expect(png.body.length).toBeGreaterThan(1000);
});

test("the logo is drawn where the letter mark would be", () => {
  const logo = prepareLogo(fakeLogo(), false);
  const template = resolveTemplate({ gradient: "none", pattern: "none", showSiteName: false, logo: { hash: "a".repeat(64), name: "l", width: logo.width, height: logo.height } });
  const image = renderOg(template, data, logo);
  // Red pixels appear in the brand area at the top left.
  let red = 0;
  for (let y = 60; y < 120; y++)
    for (let x = 70; x < 220; x++) {
      const i = (y * 1200 + x) * 4;
      if (image.data[i]! > 180 && image.data[i + 1]! < 80) red++;
    }
  expect(red).toBeGreaterThan(1000);
});
