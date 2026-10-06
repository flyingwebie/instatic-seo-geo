import type { GeneratedPage } from "./page";
import type { Finding, SiteOptions } from "./config";

export type LinkSuggestion = { from: string; to: string; reason: string };
export function auditSite(
  pages: readonly GeneratedPage[],
  origin: string,
  options: SiteOptions,
  now = Date.now(),
): { findings: Finding[]; suggestions: LinkSuggestion[] } {
  const findings = pages.flatMap((page) => page.findings);
  const suggestions: LinkSuggestion[] = [];
  const eligible = pages.filter((page) => page.indexable);
  const add = (
    path: string,
    code: string,
    message: string,
    fix: string,
    severity: Finding["severity"] = "warning",
  ) => findings.push({ path, code, message, fix, severity });
  for (const field of ["title", "description", "canonical"] as const) {
    const seen = new Map<string, string>();
    for (const page of eligible) {
      const value = page[field].trim().toLowerCase();
      if (!value) continue;
      const other = seen.get(value);
      if (other)
        add(
          page.path,
          `${field}.duplicate`,
          `Shares ${field} with ${other}.`,
          `Review the authored ${field} so each page describes its own content.`,
        );
      else seen.set(value, page.path);
    }
  }
  const paths = new Set(pages.map((page) => page.path));
  for (const page of pages)
    if (
      ["/sitemap.xml", "/robots.txt", "/llms.txt"].includes(page.path) ||
      page.path.startsWith("/markdown/") ||
      page.path.startsWith("/sitemaps/")
    )
      add(
        page.path,
        "discovery.route-collision",
        "A published page occupies a plugin discovery/output path.",
        "Rename the published page or choose which output should own this path. Instatic always serves the existing page first.",
        "error",
      );
  for (const redirect of options.redirects ?? []) {
    if (paths.has(redirect.from))
      add(
        redirect.from,
        "redirect.source-published",
        "Redirect source is still a published page.",
        "Unpublish or rename the source page before redirecting it.",
        "error",
      );
    if (
      !eligible.some((page) => page.path === redirect.to) &&
      !(options.redirects ?? []).some((item) => item.from === redirect.to)
    )
      add(
        redirect.from,
        "redirect.target-ineligible",
        "Redirect target is missing or excluded.",
        "Publish an indexable destination; redirects to retracted targets are not executed.",
        "error",
      );
  }
  const inbound = new Set<string>();
  for (const page of eligible) {
    for (const link of page.links) {
      const url = new URL(link);
      if (url.origin !== origin) continue;
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (paths.has(path)) {
        if (page.follow && path !== page.path) inbound.add(path);
      } else if (
        !(options.redirects ?? []).some((redirect) => redirect.from === path) &&
        !/\.[a-z0-9]{1,8}$/i.test(path)
      )
        add(
          page.path,
          "link.unresolved",
          `Internal link has no published route: ${path}`,
          "Publish the target, add a redirect, or update the link.",
        );
    }
    if (
      page.schemas.some((schema) =>
        ["Article", "NewsArticle", "BlogPosting"].includes(
          String(schema["@type"]),
        ),
      )
    ) {
      if (!page.links.some((link) => new URL(link).origin !== origin))
        add(
          page.path,
          "sources.none",
          "Article has no outbound source links.",
          "Cite primary evidence where the article makes claims; this is an editorial heuristic.",
          "info",
        );
      if (
        page.dateModified &&
        now - Date.parse(page.dateModified) > 365 * 86400000
      )
        add(
          page.path,
          "freshness.review",
          "Article has not materially changed for more than a year.",
          "Review time-sensitive facts and update only when the content changes.",
          "info",
        );
      if (!page.datePublished)
        add(
          page.path,
          "date.missing",
          "Article has no publication date.",
          "Provide its actual first publication date.",
        );
    }
    const schemaPage = page.schemas.find(
      (schema) => schema["@type"] === "WebPage",
    );
    if (
      schemaPage &&
      (schemaPage.url !== page.canonical || schemaPage.name !== page.title)
    )
      add(
        page.path,
        "consistency.schema",
        "Authored WebPage schema disagrees with canonical metadata.",
        "Correct the authored JSON-LD to match the published title and canonical URL.",
        "error",
      );
  }
  const words = (value: string) =>
    new Set(value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  for (const page of eligible.filter(
    (page) => page.path !== "/" && !inbound.has(page.path),
  )) {
    add(
      page.path,
      "link.orphan",
      "Page has no incoming followed content links in this export.",
      "Add a useful contextual link from a related published page. Navigation links outside main content are not included in this heuristic.",
    );
    const targetWords = words(page.title + " " + page.description);
    const related = eligible
      .filter((other) => other.path !== page.path)
      .map((other) => ({
        page: other,
        score: [...words(other.title + " " + other.description)].filter(
          (word) => targetWords.has(word),
        ).length,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const item of related.filter((item) => item.score > 0))
      suggestions.push({
        from: item.page.path,
        to: page.path,
        reason:
          "Shared terms in titles and descriptions; review the context before adding a link.",
      });
  }
  for (const group of options.translations ?? [])
    for (const alternate of group) {
      const page = eligible.find((page) => page.path === alternate.path);
      if (!page)
        add(
          alternate.path,
          "hreflang.ineligible",
          "Translation is missing or not self-canonical and indexable.",
          "Every translation must be published, self-canonical, and indexable.",
          "error",
        );
      else if (
        alternate.language !== "x-default" &&
        page.language.toLowerCase() !== alternate.language.toLowerCase()
      )
        add(
          page.path,
          "hreflang.language",
          `Declared hreflang ${alternate.language} differs from page language ${page.language}.`,
          "Set the correct page language and translation mapping.",
          "error",
        );
      if (group.length < 2)
        add(
          alternate.path,
          "hreflang.singleton",
          "Translation group contains only one page.",
          "Add the reciprocal translated route or remove the group.",
          "info",
        );
    }
  return { findings, suggestions };
}
