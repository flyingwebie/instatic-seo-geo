import { expect, test } from "bun:test";
import { injectAnalytics, validateAnalytics } from "../src/analytics";
import { detectProviders, parseAnalytics } from "../src/analyticsConfig";

const page = (csp = "default-src 'self'; script-src 'none'; img-src 'self'") =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><title>T</title></head><body><main>Hi</main></body></html>`;
const policy = (html: string) =>
  /content="([^"]*)"/.exec(html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)![0])![1]!;

async function hash(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

test("GA4 adds the official tag and allows exactly its code through the CSP", async () => {
  const html = await injectAnalytics(page(), validateAnalytics('{"ga4Id":"G-TEST1234"}'));
  expect(html).toContain("https://www.googletagmanager.com/gtag/js?id=G-TEST1234");
  const csp = policy(html);
  expect(csp).not.toContain("'none'");
  expect(csp).toContain("https://www.googletagmanager.com");
  expect(csp).toContain("connect-src 'self' https://*.google-analytics.com");
  const inline = /<script>([^<]*)<\/script>/.exec(html)![1]!;
  expect(csp).toContain(await hash(inline));
  expect(csp).not.toContain("'unsafe-inline'");
  // Idempotent if the filter ever sees its own output.
  expect(await injectAnalytics(html, validateAnalytics('{"ga4Id":"G-TEST1234"}'))).toBe(html);
});

test("pasted snippets land in head and body and their hosts are allowed", async () => {
  const options = validateAnalytics(
    JSON.stringify({
      headCode: '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>',
      bodyCode: "<script>window.x=1</script>",
      allowedHosts: ["stats.example.com"],
    }),
  );
  const html = await injectAnalytics(page(), options);
  expect(html.indexOf("plausible.io/js")).toBeLessThan(html.indexOf("</head>"));
  expect(html.indexOf("window.x=1")).toBeGreaterThan(html.indexOf("<main>"));
  const csp = policy(html);
  expect(csp).toContain("https://plausible.io");
  expect(csp).toContain("https://stats.example.com");
  expect(csp).toContain(await hash("window.x=1"));
  expect(detectProviders(options)).toContain("Plausible");
});

test("pages that already allow inline scripts are not narrowed by hashes", async () => {
  const html = await injectAnalytics(
    page("default-src 'self'; script-src 'self' 'unsafe-inline'"),
    validateAnalytics('{"gtmId":"GTM-ABC1234"}'),
  );
  const csp = policy(html);
  expect(csp).toContain("'unsafe-inline'");
  expect(csp).not.toContain("'sha256-");
  expect(csp).toContain("frame-src 'self' https://www.googletagmanager.com");
  expect(html).toContain("ns.html?id=GTM-ABC1234");
});

test("disabled or empty settings leave the page untouched", async () => {
  expect(await injectAnalytics(page(), validateAnalytics(""))).toBe(page());
  expect(
    await injectAnalytics(page(), validateAnalytics('{"enabled":false,"ga4Id":"G-TEST1234"}')),
  ).toBe(page());
});

test("validation explains bad IDs, stray text and non-tracking markup", () => {
  expect(() => parseAnalytics('{"ga4Id":"UA-123"}')).toThrow("G-ABC123XYZ");
  expect(() => parseAnalytics('{"gtmId":"GTM"}')).toThrow("GTM-AB12CD3");
  expect(() => validateAnalytics('{"headCode":"gtag(1)"}')).toThrow("<script> tags");
  expect(() => validateAnalytics('{"headCode":"<div>x</div>"}')).toThrow("<div>");
  expect(() => parseAnalytics('{"allowedHosts":["https://x.com/a"]}')).toThrow("not a domain");
  expect(() => parseAnalytics("{oops")).toThrow("not valid JSON");
});
