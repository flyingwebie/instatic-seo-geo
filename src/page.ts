import { Type, type Static } from "@sinclair/typebox";
import type { PublishedDocument, PublishedRoute } from "#instatic-sdk";
import {
  validate,
  FindingSchema,
  type SiteOptions,
  type PageOptions,
  type Finding,
} from "./config";
import {
  append,
  attribute,
  compactText,
  contentElements,
  elements,
  escapeHtml,
  markdown,
  meta,
  parsePage,
  remove,
  safeUrl,
  serializePage,
} from "./html";

const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());
type JsonObject = Static<typeof JsonObjectSchema>;
export const GeneratedPageSchema = Type.Object({
  path: Type.String(),
  id: Type.String(),
  revision: Type.String(),
  configuration: Type.String(),
  title: Type.String(),
  description: Type.String(),
  canonical: Type.String(),
  language: Type.String(),
  indexable: Type.Boolean(),
  follow: Type.Boolean(),
  markdown: Type.String(),
  contentHash: Type.String(),
  datePublished: Type.String(),
  dateModified: Type.String(),
  links: Type.Array(Type.String()),
  images: Type.Array(Type.Object({ src: Type.String(), alt: Type.String() })),
  schemas: Type.Array(JsonObjectSchema),
  findings: Type.Array(FindingSchema),
});
export type GeneratedPage = Static<typeof GeneratedPageSchema>;
export type PageContext = {
  path: string;
  title?: string;
  kind?: "page" | "entry";
  tableSlug?: string;
  publishedAt?: string;
  firstPublishedAt?: string;
  language?: string;
};

function optionsFor(options: SiteOptions, path: string): PageOptions {
  return options.pages?.[path] ?? {};
}
function schemaTypes(node: JsonObject): string[] {
  const value = node["@type"];
  return typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
}
function safeDate(value: string | undefined): string | undefined {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;
}
function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
const articleTypes = ["Article", "NewsArticle", "BlogPosting"];

export function enrichPage(
  html: string,
  context: PageContext,
  origin: string,
  siteName: string,
  options: SiteOptions,
  knownRoutes: readonly PublishedRoute[] = [],
): {
  html: string;
  page: Omit<
    GeneratedPage,
    "id" | "revision" | "configuration" | "contentHash"
  >;
} {
  const parsed = parsePage(html);
  const authored = optionsFor(options, context.path);
  const ownUrl = new URL(context.path, origin).href;
  const findings: Finding[] = [];
  const finding = (
    code: string,
    severity: Finding["severity"],
    message: string,
    fix: string,
  ) => findings.push({ code, severity, path: context.path, message, fix });
  const visible = compactText(parsed.main);
  const hasFact = (value: string) =>
    !!value &&
    visible
      .toLowerCase()
      .includes(value.replace(/\s+/g, " ").trim().toLowerCase());
  const existingTitle = compactText(
    elements(parsed.head, "title")[0] ?? parsed.head,
  );
  const title =
    authored.title ??
    (existingTitle ||
      context.title ||
      compactText(contentElements(parsed.main, "h1")[0] ?? parsed.main).slice(
        0,
        80,
      ));
  const description =
    authored.description ??
    meta(parsed.head, "description") ??
    compactText(contentElements(parsed.main, "p")[0] ?? parsed.main).slice(
      0,
      160,
    );
  const originalCanonical = elements(parsed.head, "link").find((node) =>
    attribute(node, "rel")?.split(/\s+/).includes("canonical"),
  );
  const canonical =
    safeUrl(
      authored.canonical ??
        (originalCanonical && attribute(originalCanonical, "href")) ??
        ownUrl,
      ownUrl,
    ) ?? ownUrl;
  const robots = (meta(parsed.head, "robots") ?? "")
    .toLowerCase()
    .split(/[,\s]+/);
  const index =
    authored.index ??
    !robots.some((token) => token === "noindex" || token === "none");
  const follow =
    authored.follow ??
    !robots.some((token) => token === "nofollow" || token === "none");
  const excluded = (options.excludedPaths ?? []).some(
    (prefix) =>
      context.path === prefix ||
      context.path.startsWith(prefix.replace(/\/$/, "") + "/"),
  );
  const indexable =
    index &&
    canonical === ownUrl &&
    !excluded &&
    (context.kind !== "entry" ||
      (options.collectionTables ?? ["posts"]).includes(
        context.tableSlug ?? "",
      ));
  const language =
    authored.language ??
    attribute(elements(parsed.document, "html")[0]!, "lang") ??
    context.language ??
    "en";
  const links = [
    ...new Set(
      contentElements(parsed.main, "a")
        .map((node) => safeUrl(attribute(node, "href") ?? "", ownUrl))
        .filter((url): url is string => url !== null),
    ),
  ];
  const images = contentElements(parsed.main, "img")
    .map((node) => ({
      src: safeUrl(attribute(node, "src") ?? "", ownUrl) ?? "",
      alt: attribute(node, "alt") ?? "",
    }))
    .filter((image) => image.src);
  const image =
    authored.image ?? meta(parsed.head, "og:image") ?? images[0]?.src;
  const datePublished =
    safeDate(
      authored.datePublished ??
        meta(parsed.head, "article:published_time") ??
        context.firstPublishedAt ??
        context.publishedAt,
    ) ?? "";
  const dateModified =
    safeDate(
      authored.dateModified ??
        meta(parsed.head, "article:modified_time") ??
        context.publishedAt,
    ) ?? datePublished;
  const existing: JsonObject[] = [];
  for (const script of elements(parsed.head, "script").filter(
    (node) => attribute(node, "type") === "application/ld+json",
  )) {
    if (attribute(script, "id") === "seo-geo-jsonld") {
      remove(script);
      continue;
    }
    try {
      const raw = script.childNodes
        .map((node) =>
          node.nodeName === "#text" && "value" in node ? node.value : "",
        )
        .join("");
      const value = validate(
        Type.Union([JsonObjectSchema, Type.Array(JsonObjectSchema)]),
        JSON.parse(raw),
        "existing JSON-LD",
      );
      const nodes = Array.isArray(value)
        ? value
        : Array.isArray(value["@graph"])
          ? validate(Type.Array(JsonObjectSchema), value["@graph"])
          : [value];
      existing.push(...nodes);
      remove(script);
    } catch (error) {
      finding(
        "schema.invalid-json",
        "error",
        error instanceof Error ? error.message : "Invalid existing JSON-LD",
        "Correct the authored JSON-LD; the original block is preserved.",
      );
    }
  }
  const existingId = (type: string, fallback: string) => {
    const id = existing.find((node) => schemaTypes(node).includes(type))?.[
      "@id"
    ];
    return typeof id === "string" ? id : fallback;
  };
  const websiteId = existingId("WebSite", origin + "/#website");
  const pageId = existingId("WebPage", canonical + "#webpage");
  const breadcrumbId = existingId("BreadcrumbList", canonical + "#breadcrumbs");
  const profiles = options.profiles ?? [];
  const publisher = profiles.find(
    (profile) => profile.id === options.publisher,
  );
  if (options.publisher && !publisher)
    finding(
      "publisher.missing-profile",
      "error",
      "Configured publisher profile does not exist.",
      "Configure the real publishing person or organization.",
    );
  const profileNode = (profile: (typeof profiles)[number]): JsonObject => ({
    "@type": profile.type,
    "@id": origin + "/#profile-" + profile.id,
    name: profile.name,
    ...(profile.url ? { url: profile.url } : {}),
    ...(profile.sameAs?.length ? { sameAs: profile.sameAs } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  });
  const authors = (authored.authors ?? [])
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter(
      (profile): profile is (typeof profiles)[number] => profile !== undefined,
    );
  for (const id of authored.authors ?? [])
    if (!profiles.some((profile) => profile.id === id))
      finding(
        "author.missing-profile",
        "error",
        `Unknown author profile: ${id}`,
        "Add a real author profile in the site options.",
      );
  const visibleAuthors = authors.filter((author) => hasFact(author.name));
  for (const author of authors.filter((author) => !hasFact(author.name)))
    finding(
      "author.not-visible",
      "warning",
      `${author.name} is configured but absent from visible article content.`,
      "Add the real byline to the published article; author schema is omitted until it is visible.",
    );
  const graph: JsonObject[] = [];
  const consumed = new Set<JsonObject>();
  const add = (node: JsonObject) => {
    const types = schemaTypes(node);
    const id = node["@id"];
    const match = existing.find(
      (entry) =>
        (id && entry["@id"] === id) ||
        types.some(
          (type) =>
            [
              "WebPage",
              "WebSite",
              "BreadcrumbList",
              "FAQPage",
              ...articleTypes,
            ].includes(type) &&
            schemaTypes(entry).some(
              (item) =>
                item === type ||
                (articleTypes.includes(item) && articleTypes.includes(type)),
            ),
        ),
    );
    if (match) {
      if (!consumed.has(match)) {
        graph.push({ ...node, ...match });
        consumed.add(match);
      }
    } else graph.push(node);
  };
  add({
    "@type": "WebSite",
    "@id": websiteId,
    url: origin + "/",
    name: siteName,
    inLanguage: language,
    ...(publisher
      ? { publisher: { "@id": origin + "/#profile-" + publisher.id } }
      : {}),
  });
  const crumbs = authored.breadcrumbs ?? [
    { name: "Home", path: "/" },
    ...context.path
      .split("/")
      .filter(Boolean)
      .slice(0, -1)
      .map((_, i, segments) => ({
        path: "/" + segments.slice(0, i + 1).join("/"),
        name:
          knownRoutes.find(
            (route) => route.path === "/" + segments.slice(0, i + 1).join("/"),
          )?.title ?? "",
      }))
      .filter((crumb) => crumb.name),
    ...(context.path !== "/"
      ? [{ name: context.title || title, path: context.path }]
      : []),
  ];
  add({
    "@type": "BreadcrumbList",
    "@id": breadcrumbId,
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: new URL(crumb.path, origin).href,
    })),
  });
  add({
    "@type": "WebPage",
    "@id": pageId,
    url: canonical,
    name: title,
    description,
    inLanguage: language,
    isPartOf: { "@id": websiteId },
    breadcrumb: { "@id": breadcrumbId },
    ...(image
      ? {
          primaryImageOfPage: {
            "@type": "ImageObject",
            url: safeUrl(image, ownUrl),
          },
        }
      : {}),
  });
  for (const profile of [...visibleAuthors, ...(publisher ? [publisher] : [])])
    add(profileNode(profile));
  const articleType =
    authored.articleType ?? (context.kind === "entry" ? "Article" : "none");
  if (articleType !== "none") {
    add({
      "@type": articleType,
      "@id": canonical + "#article",
      mainEntityOfPage: { "@id": pageId },
      headline: title,
      description,
      inLanguage: language,
      ...(datePublished ? { datePublished } : {}),
      ...(dateModified ? { dateModified } : {}),
      ...(image ? { image: [safeUrl(image, ownUrl)] } : {}),
      ...(visibleAuthors.length
        ? {
            author: visibleAuthors.map((author) => ({
              "@id": origin + "/#profile-" + author.id,
            })),
          }
        : {}),
      ...(publisher
        ? { publisher: { "@id": origin + "/#profile-" + publisher.id } }
        : {}),
    });
    if (
      !visibleAuthors.length &&
      !existing.some((node) =>
        articleTypes.some((type) => schemaTypes(node).includes(type)),
      )
    )
      finding(
        "author.missing",
        "warning",
        "Article has no visible author profile.",
        "Add a real byline and link it to a configured author profile.",
      );
  }
  const faqs = (authored.faqs ?? []).filter((faq) => {
    if (hasFact(faq.question) && hasFact(faq.answer)) return true;
    finding(
      "faq.not-visible",
      "error",
      `FAQ is absent from visible content: ${faq.question}`,
      "Publish the exact question and answer on this page before adding FAQ schema.",
    );
    return false;
  });
  if (faqs.length)
    add({
      "@type": "FAQPage",
      "@id": canonical + "#faq",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  for (const schema of authored.schemas ?? []) {
    if (!hasFact(schema.name)) {
      finding(
        "schema.not-visible",
        "error",
        `${schema.type} name is absent from the page.`,
        "Publish the real entity details before enabling its schema.",
      );
      continue;
    }
    let node: JsonObject = {
      "@type": schema.type,
      "@id": canonical + "#" + schema.type.toLowerCase(),
      name: schema.name,
      url: canonical,
    };
    if (schema.type === "Product") {
      node = {
        ...node,
        ...(schema.description ? { description: schema.description } : {}),
        ...(schema.image ? { image: schema.image } : {}),
        ...(schema.sku ? { sku: schema.sku } : {}),
      };
      if (schema.price && schema.currency && hasFact(schema.price))
        node.offers = {
          "@type": "Offer",
          url: canonical,
          price: schema.price,
          priceCurrency: schema.currency,
          ...(schema.availability
            ? { availability: "https://schema.org/" + schema.availability }
            : {}),
        };
      else if (schema.price)
        finding(
          "product.price-not-visible",
          "error",
          "Product price is missing from visible content or has no currency.",
          "Publish the real price and configure its ISO currency.",
        );
    } else if (schema.type === "Event") {
      if (
        !safeDate(schema.startDate) ||
        !hasFact(schema.locationName) ||
        !hasFact(schema.address)
      ) {
        finding(
          "event.invalid-details",
          "error",
          "Event needs a valid start date and visible location/address.",
          "Correct the event date and publish its location.",
        );
        continue;
      }
      node = {
        ...node,
        startDate: schema.startDate,
        ...(schema.endDate ? { endDate: schema.endDate } : {}),
        location: {
          "@type": "Place",
          name: schema.locationName,
          address: schema.address,
        },
        ...(schema.description ? { description: schema.description } : {}),
        ...(schema.image ? { image: schema.image } : {}),
      };
    } else if (schema.type === "LocalBusiness") {
      if (!hasFact(schema.address)) {
        finding(
          "business.address-not-visible",
          "error",
          "Business address is absent from the page.",
          "Publish the real business address.",
        );
        continue;
      }
      node = {
        ...node,
        address: schema.address,
        ...(schema.telephone ? { telephone: schema.telephone } : {}),
        ...(schema.image ? { image: schema.image } : {}),
        ...(schema.priceRange ? { priceRange: schema.priceRange } : {}),
      };
    } else {
      const media = contentElements(parsed.main)
        .filter((node) => ["video", "source", "iframe"].includes(node.tagName))
        .map((node) => safeUrl(attribute(node, "src") ?? "", ownUrl));
      if (
        !safeDate(schema.uploadDate) ||
        ![schema.contentUrl, schema.embedUrl].some(
          (url) => url && media.includes(url),
        )
      ) {
        finding(
          "video.invalid-details",
          "error",
          "Video needs its actual upload date and a content/embed URL present in the page.",
          "Publish the real video and configure its matching URL and upload date.",
        );
        continue;
      }
      node = {
        ...node,
        description: schema.description,
        thumbnailUrl: schema.thumbnailUrl,
        uploadDate: schema.uploadDate,
        ...(schema.contentUrl ? { contentUrl: schema.contentUrl } : {}),
        ...(schema.embedUrl ? { embedUrl: schema.embedUrl } : {}),
        ...(schema.duration ? { duration: schema.duration } : {}),
      };
    }
    add(node);
  }
  for (const node of existing)
    if (
      !consumed.has(node) &&
      !graph.some((entry) => entry["@id"] && entry["@id"] === node["@id"])
    )
      graph.push(node);
  const alternates =
    (options.translations ?? []).find((group) =>
      group.some((entry) => entry.path === context.path),
    ) ?? [];
  for (const alternate of alternates)
    if (
      knownRoutes.length &&
      !knownRoutes.some((route) => route.path === alternate.path)
    )
      finding(
        "hreflang.missing-route",
        "error",
        `Translation route is not published: ${alternate.path}`,
        "Publish the translated page or remove the mapping.",
      );
  for (const node of elements(parsed.head)) {
    if (
      node.tagName === "title" ||
      (node.tagName === "meta" &&
        [
          "description",
          "robots",
          "twitter:card",
          "twitter:title",
          "twitter:description",
          "twitter:image",
        ].includes(attribute(node, "name") ?? "")) ||
      (node.tagName === "meta" &&
        (attribute(node, "property") ?? "").startsWith("og:")) ||
      (node.tagName === "link" &&
        ["canonical", "alternate"].includes(attribute(node, "rel") ?? "") &&
        (attribute(node, "rel") === "canonical" || attribute(node, "hreflang")))
    )
      remove(node);
  }
  let tags = `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${index ? "index" : "noindex"},${follow ? "follow" : "nofollow"}"><link rel="canonical" href="${escapeHtml(canonical)}">`;
  for (const [name, value] of [
    ["og:title", title],
    ["og:description", description],
    ["og:url", canonical],
    ["og:type", articleType === "none" ? "website" : "article"],
    ["og:site_name", siteName],
    ["og:locale", language.replace("-", "_")],
  ])
    tags += `<meta property="${name}" content="${escapeHtml(value)}">`;
  tags += `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">`;
  if (image && safeUrl(image, ownUrl))
    tags += `<meta property="og:image" content="${escapeHtml(safeUrl(image, ownUrl)!)}"><meta name="twitter:image" content="${escapeHtml(safeUrl(image, ownUrl)!)}">`;
  for (const alternate of alternates.filter(
    (entry) =>
      !knownRoutes.length ||
      knownRoutes.some((route) => route.path === entry.path),
  ))
    tags += `<link rel="alternate" hreflang="${escapeHtml(alternate.language)}" href="${escapeHtml(new URL(alternate.path, origin).href)}">`;
  tags += `<script id="seo-geo-jsonld" type="application/ld+json">${jsonForHtml({ "@context": "https://schema.org", "@graph": graph })}</script>`;
  append(parsed.head, tags);
  const htmlElement = elements(parsed.document, "html")[0]!;
  const lang = htmlElement.attrs.find((attr) => attr.name === "lang");
  if (lang) lang.value = language;
  else htmlElement.attrs.push({ name: "lang", value: language });
  const headings = contentElements(parsed.main).filter((node) =>
    /^h[1-6]$/.test(node.tagName),
  );
  if (headings.filter((node) => node.tagName === "h1").length !== 1)
    finding(
      "headings.h1",
      "warning",
      "Page should have one meaningful H1.",
      "Add or consolidate the visible page heading.",
    );
  for (let i = 1; i < headings.length; i++)
    if (
      Number(headings[i]!.tagName[1]) >
      Number(headings[i - 1]!.tagName[1]) + 1
    )
      finding(
        "headings.skipped-level",
        "warning",
        "Heading hierarchy skips a level.",
        "Use consecutive heading levels to express the document structure.",
      );
  if (!title.trim())
    finding(
      "title.missing",
      "error",
      "Page title is empty.",
      "Author a descriptive title in Instatic or page options.",
    );
  if (title.length > 70)
    finding(
      "title.long",
      "info",
      "Title is longer than 70 characters.",
      "Review whether the title can be more concise; this is a heuristic, not a ranking limit.",
    );
  if (!description.trim())
    finding(
      "description.missing",
      "warning",
      "Page description is empty.",
      "Author an accurate page description.",
    );
  if (!indexable)
    finding(
      "indexability.excluded",
      "info",
      "Page is excluded from canonical public exports.",
      "Review robots controls, canonical URL, and excluded paths if exclusion is unintended.",
    );
  if (elements(parsed.main, "instatic-hole").length)
    finding(
      "content.dynamic-hole",
      "warning",
      "Some content depends on the visitor request and is absent from static HTML/Markdown.",
      "Publish important article content as deterministic HTML; private or personalized fragments are never exported.",
    );
  for (const node of contentElements(parsed.main, "img")) {
    if (attribute(node, "alt") === undefined)
      finding(
        "image.alt-missing",
        "warning",
        "Image is missing an alt attribute.",
        "Add meaningful alternative text or an explicit empty alt for decorative images.",
      );
    if (!attribute(node, "width") || !attribute(node, "height"))
      finding(
        "image.dimensions",
        "warning",
        "Image has no explicit dimensions.",
        "Set intrinsic dimensions to reduce layout shifts.",
      );
    if (!attribute(node, "srcset"))
      finding(
        "image.responsive",
        "info",
        "Image has no responsive source set.",
        "Use Instatic media variants and an appropriate sizes attribute.",
      );
  }
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > 250000)
    finding(
      "performance.html-size",
      "warning",
      `HTML is ${bytes} bytes.`,
      "Review excessive markup and deferred content; measure real page performance separately.",
    );
  if (
    elements(parsed.document, "script").filter((node) => attribute(node, "src"))
      .length > 10
  )
    finding(
      "performance.scripts",
      "warning",
      "Page loads more than 10 external scripts.",
      "Audit unnecessary scripts and measure their impact.",
    );
  return {
    html: serializePage(parsed.document),
    page: {
      path: context.path,
      title,
      description,
      canonical,
      language,
      indexable,
      follow,
      markdown: markdown(parsed.main, ownUrl),
      datePublished,
      dateModified,
      links,
      images,
      schemas: graph,
      findings,
    },
  };
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function generateDocument(
  document: PublishedDocument,
  origin: string,
  options: SiteOptions,
  configuration: string,
  knownRoutes: readonly PublishedRoute[],
  previous?: GeneratedPage,
): Promise<{ page: GeneratedPage; html: string }> {
  let { page } = enrichPage(
    document.html,
    { ...document.route, language: document.language },
    origin,
    document.siteName,
    options,
    knownRoutes,
  );
  const contentHash = await fingerprint({
    markdown: page.markdown,
    title: page.title,
    description: page.description,
    canonical: page.canonical,
    language: page.language,
    indexable: page.indexable,
    follow: page.follow,
    links: page.links,
    images: page.images,
    schemas: page.schemas.map(
      ({ datePublished: _published, dateModified: _modified, ...schema }) =>
        schema,
    ),
    options: options.pages?.[page.path],
    profiles: options.profiles,
    publisher: options.publisher,
    translations: options.translations,
  });
  if (previous?.contentHash === contentHash)
    page.dateModified = previous.dateModified;
  if (previous && !options.pages?.[page.path]?.datePublished)
    page.datePublished = previous.datePublished;
  const adjusted = enrichPage(
    document.html,
    { ...document.route, language: document.language },
    origin,
    document.siteName,
    {
      ...options,
      pages: {
        ...options.pages,
        [page.path]: {
          ...options.pages?.[page.path],
          ...(page.datePublished ? { datePublished: page.datePublished } : {}),
          ...(page.dateModified ? { dateModified: page.dateModified } : {}),
        },
      },
    },
    knownRoutes,
  );
  page = adjusted.page;
  const html = adjusted.html;
  const metadata = `---\ntitle: ${JSON.stringify(page.title)}\ncanonical: ${JSON.stringify(page.canonical)}\nlanguage: ${JSON.stringify(page.language)}\n${page.dateModified ? `lastModified: ${JSON.stringify(page.dateModified)}\n` : ""}---\n\n`;
  page.markdown = metadata + page.markdown;
  return {
    page: {
      ...page,
      id: document.route.id,
      revision: document.route.revision,
      configuration,
      contentHash,
    },
    html,
  };
}
