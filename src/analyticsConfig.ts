import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const Snippet = Type.String({ maxLength: 20000 });
export const AnalyticsSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    ga4Id: Type.Optional(Type.String({ maxLength: 40 })),
    gtmId: Type.Optional(Type.String({ maxLength: 40 })),
    consentDefaultDenied: Type.Optional(Type.Boolean()),
    headCode: Type.Optional(Snippet),
    bodyCode: Type.Optional(Snippet),
    allowedHosts: Type.Optional(
      Type.Array(Type.String({ maxLength: 253 }), { maxItems: 50 }),
    ),
  },
  { additionalProperties: false },
);
export type AnalyticsOptions = Static<typeof AnalyticsSchema>;

const GA4 = /^G-[A-Z0-9]{4,20}$/;
const GTM = /^GTM-[A-Z0-9]{4,12}$/;
const HOST = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/;
export class AnalyticsError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.field = field;
    this.name = "AnalyticsError";
  }
}

/** Parse and validate the stored JSON. Blank input means "no tags". */
export function parseAnalytics(raw: string | undefined): AnalyticsOptions {
  let value: unknown;
  try {
    value = JSON.parse(raw?.trim() || "{}");
  } catch {
    throw new AnalyticsError("Analytics", "Stored settings are not valid JSON");
  }
  if (!Value.Check(AnalyticsSchema, value)) {
    const issue = Value.Errors(AnalyticsSchema, value).First();
    throw new AnalyticsError(
      "Analytics" + (issue?.path ?? ""),
      issue?.message ?? "Invalid value",
    );
  }
  const options = value;
  if (options.ga4Id && !GA4.test(options.ga4Id))
    throw new AnalyticsError(
      "Google Analytics 4 ID",
      "Use the measurement ID shown in GA4, for example G-ABC123XYZ",
    );
  if (options.gtmId && !GTM.test(options.gtmId))
    throw new AnalyticsError(
      "Google Tag Manager ID",
      "Use the container ID shown in Tag Manager, for example GTM-AB12CD3",
    );
  for (const host of options.allowedHosts ?? [])
    if (!HOST.test(host))
      throw new AnalyticsError(
        "Allowed domains",
        `${host} is not a domain. Use a name such as plausible.io or *.example.com`,
      );
  return options;
}

/** Origins referenced by a snippet, as CSP host sources (https://host). */
export function snippetHosts(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(
    /(?:https?:)?\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/:"'`?#\s]|$)/gi,
  ))
    found.add("https://" + match[1]!.toLowerCase());
  return [...found].sort();
}

const PROVIDERS: ReadonlyArray<[string, RegExp]> = [
  ["Google Analytics", /google-analytics\.com|gtag\/js|gtag\(/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i],
  ["Plausible", /plausible\.io/i],
  ["Fathom", /usefathom\.com/i],
  ["Umami", /umami/i],
  ["Matomo", /matomo|piwik/i],
  ["Microsoft Clarity", /clarity\.ms/i],
  ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
  ["Hotjar", /hotjar/i],
  ["LinkedIn Insight", /snap\.licdn\.com|_linkedin_partner_id/i],
  ["TikTok Pixel", /analytics\.tiktok\.com|ttq\./i],
  ["Simple Analytics", /simpleanalytics/i],
  ["Cloudflare Web Analytics", /cloudflareinsights\.com/i],
  ["PostHog", /posthog/i],
];

/** Friendly names of the tools a configuration loads, for the admin summary. */
export function detectProviders(options: AnalyticsOptions): string[] {
  const names = new Set<string>();
  if (options.ga4Id) names.add("Google Analytics");
  if (options.gtmId) names.add("Google Tag Manager");
  const code = (options.headCode ?? "") + "\n" + (options.bodyCode ?? "");
  for (const [name, pattern] of PROVIDERS)
    if (pattern.test(code)) names.add(name);
  if (code.trim() && !names.size) names.add("Custom code");
  return [...names];
}

export function analyticsActive(options: AnalyticsOptions): boolean {
  return (
    options.enabled !== false &&
    !!(
      options.ga4Id ||
      options.gtmId ||
      options.headCode?.trim() ||
      options.bodyCode?.trim()
    )
  );
}

