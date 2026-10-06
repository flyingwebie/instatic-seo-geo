import { Type, type Static } from "@sinclair/typebox";
import type { PageOptions, SiteOptions } from "./config";
import {
  attribute,
  compactText,
  contentElements,
  elements,
  isElement,
  type HtmlElement,
  type HtmlNode,
} from "./html";

export const AioReportSchema = Type.Object({
  checks: Type.Array(
    Type.Object({
      id: Type.String(),
      label: Type.String(),
      status: Type.Union([
        Type.Literal("pass"),
        Type.Literal("review"),
        Type.Literal("blocked"),
      ]),
      detail: Type.String(),
      action: Type.String(),
    }),
  ),
  answer: Type.String(),
  sourceCount: Type.Integer(),
});
export type AioReport = Static<typeof AioReportSchema>;

export function readRobots(head: HtmlElement, name = "robots"): string[] {
  return elements(head, "meta")
    .filter((node) => attribute(node, "name")?.toLowerCase() === name)
    .flatMap((node) => {
      const expirations: string[] = [];
      // Expiration dates can contain spaces and an RFC weekday comma.
      const raw = (attribute(node, "content") ?? "").replace(
        /unavailable_after\s*:\s*.*?(?=,\s*[a-z][\w-]*(?:\s*:|\s*(?:,|$))|$)/gi,
        (directive) => {
          expirations.push(
            directive.replace(
              /^unavailable_after\s*:\s*/i,
              "unavailable_after: ",
            ),
          );
          return `expiration${expirations.length - 1}`;
        },
      );
      return raw
        .toLowerCase()
        .replace(/:\s+/g, ":")
        .split(/[,\s]+/)
        .map((token) =>
          /^expiration\d+$/.test(token)
            ? (expirations[Number(token.slice(10))] ?? token)
            : token,
        );
    })
    .filter(Boolean);
}

/** Preserve authored directives except the specific controls explicitly overridden. */
export function robotsDirectives(
  head: HtmlElement,
  page: PageOptions,
  index: boolean,
  follow: boolean,
): string[] {
  const tokens = readRobots(head);
  const extras = tokens.filter(
    (token) =>
      !["index", "noindex", "follow", "nofollow", "all", "none"].includes(
        token,
      ) &&
      !(page.snippetAllowed !== undefined && token === "nosnippet") &&
      !(
        (page.maxSnippet !== undefined || page.snippetAllowed === true) &&
        token.startsWith("max-snippet:")
      ),
  );
  if (page.snippetAllowed === false) extras.push("nosnippet");
  if (page.maxSnippet !== undefined)
    extras.push(`max-snippet:${page.maxSnippet}`);
  return [
    ...new Set([
      index ? "index" : "noindex",
      follow ? "follow" : "nofollow",
      ...extras,
    ]),
  ];
}
function snippetRestricted(node: HtmlNode): boolean {
  for (
    let current: HtmlNode | null = node;
    current;
    current = "parentNode" in current ? current.parentNode : null
  )
    if (
      isElement(current) &&
      attribute(current, "data-nosnippet") !== undefined
    )
      return true;
  return false;
}

/** Local checks on the published page; they do not assert Google indexing or AI selection. */
export function auditAio(input: {
  main: HtmlElement;
  head: HtmlElement;
  origin: string;
  options: SiteOptions;
  page: PageOptions;
  indexable: boolean;
  robots: string[];
  links: string[];
  authorsVisible: boolean;
  datePublished: string;
}): AioReport {
  const { main, head, origin, options, page, indexable, robots, links } = input;
  const googleTokens = readRobots(head, "googlebot");
  const directives = [...robots, ...googleTokens];
  const noSnippet =
    directives.includes("nosnippet") || directives.includes("max-snippet:0");
  const googleNoindex =
    directives.includes("noindex") || directives.includes("none");
  const expired = directives.some(
    (directive) =>
      directive.toLowerCase().startsWith("unavailable_after:") &&
      Date.parse(directive.slice(directive.indexOf(":") + 1)) <= Date.now(),
  );
  const paragraphs = contentElements(main, "p")
    .filter(
      (node) =>
        !snippetRestricted(node) &&
        !contentElements(node).some(
          (child) => attribute(child, "data-nosnippet") !== undefined,
        ),
    )
    .map(compactText);
  const preferred = page.aioAnswer?.replace(/\s+/g, " ").trim();
  const answer = preferred
    ? (paragraphs.find((text) =>
        text.toLowerCase().includes(preferred.toLowerCase()),
      ) ?? "")
    : (paragraphs.find((text) => text.length >= 40 && text.length <= 600) ??
      "");
  const headings = contentElements(main)
    .filter((node) => /^h[1-6]$/.test(node.tagName))
    .map(compactText);
  const sourceCount = links.filter((raw) => {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && url.origin !== origin;
  }).length;
  const checks: AioReport["checks"] = [];
  const add = (
    id: string,
    label: string,
    status: AioReport["checks"][number]["status"],
    detail: string,
    action: string,
  ) => checks.push({ id, label, status, detail, action });
  const technical =
    indexable &&
    !googleNoindex &&
    options.searchAllowed !== false &&
    !noSnippet &&
    !expired;
  add(
    "discovery",
    "Search and snippet access",
    technical ? "pass" : "blocked",
    technical
      ? "Local canonical, indexing, crawler and snippet controls allow discovery. Actual indexing is unverified."
      : "An exclusion, indexing directive, search crawler policy or snippet restriction or expiration prevents a local readiness pass.",
    "Review this page’s indexing and snippet settings and the Crawlers section. Confirm actual indexing in Search Console.",
  );
  add(
    "answer",
    "Readable answer passage",
    answer ? "pass" : "review",
    answer
      ? "A published paragraph contains the selected answer or a concise candidate passage."
      : preferred
        ? "The preferred answer was not found in a snippet-accessible published paragraph."
        : "No paragraph between 40 and 600 characters was found. This is an editorial heuristic.",
    "Publish a clear answer in the CMS, then copy that paragraph into Preferred answer. This field never inserts hidden content.",
  );
  add(
    "question",
    "Clear question or topic",
    page.aioQuestion
      ? headings.some((text) =>
          text.toLowerCase().includes(page.aioQuestion!.toLowerCase().trim()),
        )
        ? "pass"
        : "review"
      : headings.length
        ? "pass"
        : "review",
    page.aioQuestion
      ? "The primary question is checked against visible headings using a simple text match."
      : "Visible headings help readers understand the topic; no exact question format is required.",
    "Use a descriptive heading that reflects the question you actually answer. Publish it in the CMS.",
  );
  add(
    "sources",
    "Supporting sources",
    sourceCount ? "pass" : "review",
    `${sourceCount} external content link(s) found. Links are not evidence of source quality.`,
    "Add trustworthy sources for factual claims where useful; verify the claims and linked evidence yourself.",
  );
  add(
    "attribution",
    "Attribution and dates",
    input.authorsVisible && input.datePublished ? "pass" : "review",
    input.authorsVisible
      ? "A configured author name appears in published content."
      : "No visible configured author was verified; some pages do not need a byline.",
    "For articles, publish a real byline and accurate dates, then select the author profile in Pages.",
  );
  return { checks, answer: answer.slice(0, 600), sourceCount };
}
