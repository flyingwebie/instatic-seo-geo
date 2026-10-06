import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const Text = Type.String({ maxLength: 10000 });
const HttpUrl = Type.String({ pattern: "^https?://", maxLength: 2048 });
const ProfileSchema = Type.Object(
  {
    id: Type.String({ pattern: "^[a-zA-Z0-9_-]+$" }),
    name: Text,
    type: Type.Union([Type.Literal("Person"), Type.Literal("Organization")]),
    url: Type.Optional(HttpUrl),
    image: Type.Optional(HttpUrl),
    sameAs: Type.Optional(Type.Array(HttpUrl)),
  },
  { additionalProperties: false },
);
export const SpecializedSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("Product"),
      name: Text,
      description: Type.Optional(Text),
      image: Type.Optional(HttpUrl),
      sku: Type.Optional(Text),
      price: Type.Optional(Type.String({ pattern: "^\\d+(\\.\\d+)?$" })),
      currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
      availability: Type.Optional(
        Type.Union([
          Type.Literal("InStock"),
          Type.Literal("OutOfStock"),
          Type.Literal("PreOrder"),
        ]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("Event"),
      name: Text,
      startDate: Text,
      endDate: Type.Optional(Text),
      locationName: Text,
      address: Text,
      image: Type.Optional(HttpUrl),
      description: Type.Optional(Text),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("LocalBusiness"),
      name: Text,
      address: Text,
      telephone: Type.Optional(Text),
      image: Type.Optional(HttpUrl),
      priceRange: Type.Optional(Text),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("VideoObject"),
      name: Text,
      description: Text,
      thumbnailUrl: HttpUrl,
      uploadDate: Text,
      contentUrl: Type.Optional(HttpUrl),
      embedUrl: Type.Optional(HttpUrl),
      duration: Type.Optional(
        Type.String({
          pattern: "^PT(?=\\d)(\\d+H)?(\\d+M)?(\\d+(\\.\\d+)?S)?$",
        }),
      ),
    },
    { additionalProperties: false },
  ),
]);
export const PageOptionsSchema = Type.Object(
  {
    title: Type.Optional(Text),
    description: Type.Optional(Text),
    canonical: Type.Optional(HttpUrl),
    index: Type.Optional(Type.Boolean()),
    follow: Type.Optional(Type.Boolean()),
    image: Type.Optional(HttpUrl),
    language: Type.Optional(Type.String()),
    articleType: Type.Optional(
      Type.Union([
        Type.Literal("Article"),
        Type.Literal("NewsArticle"),
        Type.Literal("BlogPosting"),
        Type.Literal("none"),
      ]),
    ),
    authors: Type.Optional(Type.Array(Type.String())),
    datePublished: Type.Optional(Type.String()),
    dateModified: Type.Optional(Type.String()),
    faqs: Type.Optional(
      Type.Array(
        Type.Object(
          { question: Text, answer: Text },
          { additionalProperties: false },
        ),
      ),
    ),
    breadcrumbs: Type.Optional(
      Type.Array(
        Type.Object(
          { name: Text, path: Type.String() },
          { additionalProperties: false },
        ),
      ),
    ),
    schemas: Type.Optional(Type.Array(SpecializedSchema)),
  },
  { additionalProperties: false },
);
export type PageOptions = Static<typeof PageOptionsSchema>;
export const SiteOptionsSchema = Type.Object(
  {
    pages: Type.Optional(Type.Record(Type.String(), PageOptionsSchema)),
    profiles: Type.Optional(Type.Array(ProfileSchema)),
    publisher: Type.Optional(Type.String()),
    translations: Type.Optional(
      Type.Array(
        Type.Array(
          Type.Object(
            {
              path: Type.String(),
              language: Type.String({
                pattern: "^(x-default|[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*)$",
              }),
            },
            { additionalProperties: false },
          ),
        ),
      ),
    ),
    redirects: Type.Optional(
      Type.Array(
        Type.Object(
          {
            from: Type.String(),
            to: Type.String(),
            status: Type.Optional(
              Type.Union([Type.Literal(301), Type.Literal(308)]),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    excludedPaths: Type.Optional(Type.Array(Type.String())),
    collectionTables: Type.Optional(Type.Array(Type.String())),
    searchAllowed: Type.Optional(Type.Boolean()),
    trainingAllowed: Type.Optional(Type.Boolean()),
    userRetrievalAllowed: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type SiteOptions = Static<typeof SiteOptionsSchema>;

export class ConfigurationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.path = path;
    this.name = "ConfigurationError";
  }
}

export function validate<T extends TSchema>(
  schema: T,
  input: unknown,
  path = "data",
): Static<T> {
  if (!Value.Check(schema, input)) {
    const issue = [...Value.Errors(schema, input)][0];
    throw new ConfigurationError(
      path + (issue?.path ?? ""),
      issue?.message ?? "Invalid value",
    );
  }
  return input;
}

export function parseOptions(raw: string): SiteOptions {
  let value: unknown;
  try {
    value = JSON.parse(raw || "{}");
  } catch (error) {
    throw new ConfigurationError(
      "options",
      error instanceof Error ? error.message : "Invalid JSON",
    );
  }
  const options = validate(SiteOptionsSchema, value, "options");
  const httpUrl = (raw: string) => {
    try {
      const url = new URL(raw);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Invalid URL");
    } catch {
      throw new ConfigurationError(
        "options",
        "Use complete HTTP(S) URLs without credentials",
      );
    }
  };
  for (const profile of options.profiles ?? [])
    for (const url of [profile.url, profile.image, ...(profile.sameAs ?? [])])
      if (url) httpUrl(url);
  if (options.pages) {
    const pages: NonNullable<SiteOptions["pages"]> = {};
    for (const [path, page] of Object.entries(options.pages)) {
      const normalized = normalizePath(path);
      if (pages[normalized])
        throw new ConfigurationError("pages", "Duplicate normalized route");
      pages[normalized] = page;
    }
    options.pages = pages;
  }
  options.excludedPaths = options.excludedPaths?.map(normalizePath);
  options.translations = options.translations?.map((group) =>
    group.map((entry) => ({ ...entry, path: normalizePath(entry.path) })),
  );
  options.redirects = options.redirects?.map((entry) => ({
    ...entry,
    from: normalizePath(entry.from),
    to: normalizePath(entry.to),
  }));
  for (const page of Object.values(options.pages ?? {})) {
    for (const url of [page.canonical, page.image]) if (url) httpUrl(url);
    for (const crumb of page.breadcrumbs ?? [])
      crumb.path = normalizePath(crumb.path);
    for (const date of [page.datePublished, page.dateModified])
      if (date && Number.isNaN(Date.parse(date)))
        throw new ConfigurationError("dates", "Use a real ISO date");
    for (const schema of page.schemas ?? []) {
      for (const [key, value] of Object.entries(schema))
        if (
          ["image", "thumbnailUrl", "contentUrl", "embedUrl"].includes(key) &&
          typeof value === "string"
        )
          httpUrl(value);
      const dates =
        schema.type === "Event"
          ? [schema.startDate, schema.endDate]
          : schema.type === "VideoObject"
            ? [schema.uploadDate]
            : [];
      for (const date of dates)
        if (date && Number.isNaN(Date.parse(date)))
          throw new ConfigurationError(
            "schema dates",
            "Use the actual ISO date",
          );
      if (
        schema.type === "Event" &&
        schema.endDate &&
        Date.parse(schema.endDate) < Date.parse(schema.startDate)
      )
        throw new ConfigurationError(
          "event",
          "End date must not precede start date",
        );
    }
  }
  const seen = new Set<string>();
  for (const group of options.translations ?? []) {
    const languages = new Set<string>();
    for (const entry of group) {
      if (seen.has(entry.path) || languages.has(entry.language.toLowerCase()))
        throw new ConfigurationError(
          "translations",
          "Each path belongs to one group and each group has distinct languages",
        );
      seen.add(entry.path);
      languages.add(entry.language.toLowerCase());
    }
  }
  return options;
}

export function normalizePath(raw: string): string {
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[?#\\]/.test(raw) ||
    [...raw].some((char) => char.charCodeAt(0) <= 32)
  )
    throw new ConfigurationError(
      "path",
      "Use a site-relative path without query or fragment",
    );
  const url = new URL(raw, "https://path.invalid");
  if (url.pathname !== raw && raw !== url.pathname.replace(/\/$/, "")) {
    // Unicode is encoded by URL; dot segments and traversal are rejected separately.
    if (
      raw
        .split("/")
        .some((segment) => [".", ".."].includes(decodeURIComponent(segment)))
    )
      throw new ConfigurationError("path", "Traversal is not allowed");
  }
  return url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "/";
}

export function siteOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new ConfigurationError(
      "siteUrl",
      "Use an HTTP(S) origin such as https://example.com",
    );
  return url.origin;
}

export const FindingSchema = Type.Object({
  code: Type.String(),
  severity: Type.Union([
    Type.Literal("error"),
    Type.Literal("warning"),
    Type.Literal("info"),
  ]),
  path: Type.String(),
  message: Type.String(),
  fix: Type.String(),
});
export type Finding = Static<typeof FindingSchema>;
