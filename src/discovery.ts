import { zipSync, strToU8 } from "fflate";
import { normalizePath, type SiteOptions } from "./config";
import type { GeneratedPage } from "./page";

const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
const urlset =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
export function markdownPath(path: string): string {
  return "/markdown" + (path === "/" ? "" : path) + "/index.md";
}
export function eligibleTranslations(
  pages: readonly GeneratedPage[],
  options: SiteOptions,
) {
  return (
    options.translations?.filter(
      (group) =>
        group.length >= 2 &&
        group.every((entry) =>
          pages.some(
            (page) =>
              page.indexable &&
              page.path === entry.path &&
              (entry.language === "x-default" ||
                page.language.toLowerCase() === entry.language.toLowerCase()),
          ),
        ),
    ) ?? []
  );
}

export function sitemapFiles(
  pages: readonly GeneratedPage[],
  origin: string,
  options: SiteOptions,
  limits = { urls: 50000, bytes: 50 * 1024 * 1024 },
): Record<string, string> {
  const eligible = pages
    .filter((page) => page.indexable)
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const paths = new Set(eligible.map((page) => page.path));
  const chunks: string[] = [];
  let entries: string[] = [],
    bytes = strToU8(header + urlset + "</urlset>").length;
  for (const page of eligible) {
    const translations =
      eligibleTranslations(eligible, options).find((group) =>
        group.some((entry) => entry.path === page.path),
      ) ?? [];
    let entry = `<url><loc>${xml(page.canonical)}</loc>${page.dateModified ? `<lastmod>${xml(page.dateModified)}</lastmod>` : ""}`;
    for (const alternate of translations.filter((entry) =>
      paths.has(entry.path),
    ))
      entry += `<xhtml:link rel="alternate" hreflang="${xml(alternate.language)}" href="${xml(new URL(alternate.path, origin).href)}"/>`;
    entry += "</url>\n";
    const size = strToU8(entry).length;
    if (size + strToU8(header + urlset + "</urlset>").length > limits.bytes)
      throw new Error("A sitemap entry exceeds the sitemap byte limit.");
    if (
      entries.length &&
      (entries.length >= limits.urls || bytes + size > limits.bytes)
    ) {
      chunks.push(header + urlset + entries.join("") + "</urlset>\n");
      entries = [];
      bytes = strToU8(header + urlset + "</urlset>").length;
    }
    entries.push(entry);
    bytes += size;
  }
  if (entries.length || !chunks.length)
    chunks.push(header + urlset + entries.join("") + "</urlset>\n");
  if (chunks.length === 1) return { "/sitemap.xml": chunks[0]! };
  const files: Record<string, string> = {};
  chunks.forEach((chunk, i) => {
    files[`/sitemaps/${i + 1}.xml`] = chunk;
  });
  // The sitemap index has the same count/size limits as a urlset.
  if (chunks.length > 50000)
    throw new Error("Site exceeds the supported single sitemap index size.");
  files["/sitemap.xml"] =
    header +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    Object.keys(files)
      .map((path) => `<sitemap><loc>${xml(origin + path)}</loc></sitemap>`)
      .join("\n") +
    "\n</sitemapindex>\n";
  return files;
}

export function robotsTxt(origin: string, options: SiteOptions): string {
  const privatePaths = ["/admin/", "/_instatic/mcp", "/_instatic/hole/"];
  const group = (agents: string[], allow: boolean) =>
    agents.map((agent) => `User-agent: ${agent}`).join("\n") +
    "\n" +
    (allow
      ? privatePaths.map((path) => `Disallow: ${path}`).join("\n") +
        "\nAllow: /"
      : "Disallow: /") +
    "\n\n";
  return (
    "# SEO & GEO — unofficial alpha. Robots preferences are voluntary; they are not access control.\n" +
    group(["*"], options.searchAllowed !== false) +
    group(
      ["OAI-SearchBot", "Claude-SearchBot", "Googlebot", "Bingbot"],
      options.searchAllowed !== false,
    ) +
    group(
      ["GPTBot", "ClaudeBot", "Google-Extended"],
      options.trainingAllowed === true,
    ) +
    group(
      ["ChatGPT-User", "Claude-User"],
      options.userRetrievalAllowed !== false,
    ) +
    `Sitemap: ${origin}/sitemap.xml\n`
  );
}

export function llmsTxt(
  pages: readonly GeneratedPage[],
  siteName: string,
): string {
  const plain = (text: string) => text.replace(/[[\]\r\n]/g, " ");
  return (
    `# ${plain(siteName)}\n\n> Public content from the canonical website. HTML remains authoritative.\n\n## Pages\n\n` +
    pages
      .filter((page) => page.indexable)
      .map(
        (page) =>
          `- [${plain(page.title)}](${page.canonical}): ${plain(page.description)}\n  Markdown: ${new URL(markdownPath(page.path), page.canonical).href}`,
      )
      .join("\n") +
    "\n"
  );
}

export type Redirect = { from: string; to: string; status: 301 | 308 };
export function redirectsFor(
  options: SiteOptions,
  previous: readonly GeneratedPage[],
  current: readonly GeneratedPage[],
  history: readonly Redirect[] = [],
): Redirect[] {
  const paths = new Set(
    current.filter((page) => page.indexable).map((page) => page.path),
  );
  const map = new Map<string, Redirect>();
  for (const redirect of history) map.set(redirect.from, redirect);
  for (const old of previous) {
    const next = current.find((page) => page.id === old.id && page.indexable);
    if (old.indexable && next && next.path !== old.path)
      map.set(old.path, { from: old.path, to: next.path, status: 301 });
  }
  for (const redirect of options.redirects ?? []) {
    const from = normalizePath(redirect.from);
    map.set(from, {
      from,
      to: normalizePath(redirect.to),
      status: redirect.status ?? 301,
    });
  }
  const results: Redirect[] = [];
  for (const redirect of map.values()) {
    if (paths.has(redirect.from)) continue; // Never replace existing published pages.
    const visited = new Set([redirect.from]);
    let target = redirect.to;
    while (map.has(target) && !paths.has(target)) {
      if (visited.has(target))
        throw new Error(`Redirect cycle at ${redirect.from}`);
      visited.add(target);
      target = map.get(target)!.to;
    }
    if (visited.has(target))
      throw new Error(`Redirect cycle at ${redirect.from}`);
    if (paths.has(target)) results.push({ ...redirect, to: target });
  }
  return results;
}

export function contentZip(
  pages: readonly GeneratedPage[],
  origin: string,
  options: SiteOptions,
  generation: string,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const manifest = pages
    .filter((page) => page.indexable)
    .map((page) => ({
      file: markdownPath(page.path).slice(1),
      canonical: page.canonical,
      contentHash: page.contentHash,
      lastModified: page.dateModified,
    }));
  for (const page of pages.filter((page) => page.indexable))
    files[markdownPath(page.path).slice(1)] = strToU8(page.markdown);
  for (const [path, value] of Object.entries(
    sitemapFiles(pages, origin, options),
  ))
    files[path.slice(1)] = strToU8(value);
  files["export-manifest.json"] = strToU8(
    JSON.stringify(
      { format: 1, generation, origin, pages: manifest },
      null,
      2,
    ) + "\n",
  );
  const size = Object.values(files).reduce(
    (sum, bytes) => sum + bytes.byteLength,
    0,
  );
  if (size > 16 * 1024 * 1024)
    throw new Error(
      "Content ZIP exceeds the alpha 16 MiB uncompressed limit. Download individual Markdown files or exclude large collections.",
    );
  return zipSync(files, { level: 6, mtime: new Date("1980-01-01T00:00:00Z") });
}
