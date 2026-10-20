import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const Color = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });

export const LAYOUTS = [
  "classic",
  "centered",
  "split",
  "magazine",
  "card",
  "frame",
  "spotlight",
  "sidebar",
  "band",
  "quote",
] as const;
export const PATTERNS = [
  "none",
  "dots",
  "grid",
  "circles",
  "glow",
  "mesh",
  "stripes",
  "waves",
  "rings",
  "corner",
] as const;
/** Stored logo bitmaps are at most this size (2× the largest drawn size). */
export const LOGO_MAX_WIDTH = 640;
export const LOGO_MAX_HEIGHT = 280;
const Short = Type.String({ maxLength: 120 });

export const OgTemplateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    /** "missing": only pages without their own image. "always": every page except per-page overrides. */
    mode: Type.Optional(Type.Union([Type.Literal("missing"), Type.Literal("always")])),
    /** Id of the preset this design started from, for highlighting in the gallery. */
    preset: Type.Optional(Type.String({ maxLength: 40 })),
    layout: Type.Optional(Type.Union(LAYOUTS.map((id) => Type.Literal(id)))),
    background: Type.Optional(Color),
    background2: Type.Optional(Color),
    gradient: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("vertical"),
        Type.Literal("horizontal"),
        Type.Literal("diagonal"),
        Type.Literal("radial"),
      ]),
    ),
    pattern: Type.Optional(Type.Union(PATTERNS.map((id) => Type.Literal(id)))),
    /** Fill for cards, panels and sidebars. */
    surfaceColor: Type.Optional(Color),
    titleCase: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("upper")])),
    /** Logo prepared in the admin and stored by content hash. */
    logo: Type.Optional(
      Type.Object(
        {
          hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          name: Type.String({ maxLength: 200 }),
          width: Type.Integer({ minimum: 1, maximum: LOGO_MAX_WIDTH }),
          height: Type.Integer({ minimum: 1, maximum: LOGO_MAX_HEIGHT }),
        },
        { additionalProperties: false },
      ),
    ),
    showLogo: Type.Optional(Type.Boolean()),
    logoTint: Type.Optional(
      Type.Union([Type.Literal("original"), Type.Literal("light"), Type.Literal("dark")]),
    ),
    titleColor: Type.Optional(Color),
    textColor: Type.Optional(Color),
    accentColor: Type.Optional(Color),
    titleWeight: Type.Optional(
      Type.Union([Type.Literal("regular"), Type.Literal("semibold"), Type.Literal("bold")]),
    ),
    titleSize: Type.Optional(Type.Integer({ minimum: 40, maximum: 96 })),
    brandMark: Type.Optional(Type.String({ maxLength: 3 })),
    siteName: Type.Optional(Short),
    footerText: Type.Optional(Short),
    stripTitleSuffix: Type.Optional(Type.Boolean()),
    showSiteName: Type.Optional(Type.Boolean()),
    showDescription: Type.Optional(Type.Boolean()),
    showUrl: Type.Optional(Type.Boolean()),
    showSection: Type.Optional(Type.Boolean()),
    showDate: Type.Optional(Type.Boolean()),
    accentBar: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type OgTemplate = Static<typeof OgTemplateSchema>;
export type ResolvedTemplate = Required<Omit<OgTemplate, "logo" | "preset">> &
  Pick<OgTemplate, "logo" | "preset">;

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Bump when rendering output changes so cached images are re-created. */
export const OG_RENDERER_VERSION = 2;

export const DEFAULT_TEMPLATE: ResolvedTemplate = {
  enabled: false,
  mode: "missing",
  layout: "classic",
  background: "#0f172a",
  background2: "#1e3a8a",
  gradient: "diagonal",
  pattern: "dots",
  titleColor: "#ffffff",
  textColor: "#cbd5e1",
  accentColor: "#38bdf8",
  titleWeight: "bold",
  titleSize: 72,
  brandMark: "",
  siteName: "",
  footerText: "",
  stripTitleSuffix: true,
  showSiteName: true,
  showDescription: true,
  showUrl: true,
  showSection: true,
  showDate: false,
  accentBar: true,
  surfaceColor: "#ffffff",
  titleCase: "normal",
  showLogo: true,
  logoTint: "original",
};

/** Design fields a preset sets; content fields (texts, toggles, logo) are kept. */
export type PresetDesign = Pick<
  OgTemplate,
  | "layout"
  | "background"
  | "background2"
  | "gradient"
  | "pattern"
  | "titleColor"
  | "textColor"
  | "accentColor"
  | "surfaceColor"
  | "titleWeight"
  | "titleSize"
  | "titleCase"
  | "accentBar"
  | "logoTint"
>;
export type Preset = { id: string; name: string; tags: string; design: PresetDesign };

const preset = (id: string, name: string, tags: string, design: PresetDesign): Preset => ({
  id,
  name,
  tags,
  design: {
    gradient: "none",
    pattern: "none",
    titleWeight: "bold",
    titleSize: 72,
    titleCase: "normal",
    accentBar: true,
    surfaceColor: "#ffffff",
    logoTint: "original",
    ...design,
  },
});

/** Twenty ready-made designs. Each one is a full look; texts and the logo stay yours. */
export const TEMPLATE_PRESETS: Preset[] = [
  preset("midnight", "Midnight", "dark · classic", { layout: "classic", background: "#0f172a", background2: "#1e3a8a", gradient: "diagonal", pattern: "dots", titleColor: "#ffffff", textColor: "#cbd5e1", accentColor: "#38bdf8", logoTint: "light" }),
  preset("aurora", "Aurora", "dark · glow", { layout: "centered", background: "#070b1a", background2: "#070b1a", pattern: "mesh", titleColor: "#ffffff", textColor: "#c7d2fe", accentColor: "#2dd4bf", logoTint: "light" }),
  preset("sunset", "Sunset", "vivid · bold", { layout: "magazine", background: "#f97316", background2: "#be185d", gradient: "diagonal", pattern: "waves", titleColor: "#ffffff", textColor: "#ffe4e6", accentColor: "#fde047", logoTint: "light" }),
  preset("paper", "Paper", "light · editorial", { layout: "classic", background: "#faf7f2", background2: "#f1ece4", gradient: "vertical", titleColor: "#1c1917", textColor: "#57534e", accentColor: "#ea580c" }),
  preset("glass-card", "Glass card", "light · card", { layout: "card", background: "#6366f1", background2: "#ec4899", gradient: "diagonal", pattern: "circles", surfaceColor: "#ffffff", titleColor: "#111827", textColor: "#4b5563", accentColor: "#6366f1" }),
  preset("night-card", "Night card", "dark · card", { layout: "card", background: "#09090b", background2: "#09090b", pattern: "grid", surfaceColor: "#18181b", titleColor: "#fafafa", textColor: "#a1a1aa", accentColor: "#a3e635", logoTint: "light" }),
  preset("neon", "Neon", "dark · highlight", { layout: "band", background: "#020617", background2: "#020617", pattern: "glow", titleColor: "#020617", textColor: "#94a3b8", accentColor: "#22d3ee", titleSize: 64, logoTint: "light" }),
  preset("highlighter", "Highlighter", "light · highlight", { layout: "band", background: "#ffffff", background2: "#ffffff", pattern: "dots", titleColor: "#111111", textColor: "#525252", accentColor: "#fde047", titleSize: 64 }),
  preset("split", "Split", "light · panel", { layout: "split", background: "#ffffff", background2: "#ffffff", titleColor: "#0f172a", textColor: "#475569", accentColor: "#059669", logoTint: "light" }),
  preset("corporate", "Corporate", "light · sidebar", { layout: "sidebar", background: "#ffffff", background2: "#f8fafc", gradient: "vertical", surfaceColor: "#1d4ed8", titleColor: "#0f172a", textColor: "#475569", accentColor: "#1d4ed8", titleSize: 64, logoTint: "light" }),
  preset("frame", "Gallery frame", "light · frame", { layout: "frame", background: "#f5f0e6", background2: "#f5f0e6", titleColor: "#1f2937", textColor: "#6b7280", accentColor: "#b45309", titleWeight: "semibold" }),
  preset("quote", "Quote", "warm · quote", { layout: "quote", background: "#fff7ed", background2: "#ffedd5", gradient: "vertical", titleColor: "#431407", textColor: "#9a3412", accentColor: "#ea580c", titleWeight: "semibold", titleSize: 60 }),
  preset("ocean", "Ocean", "dark · rings", { layout: "classic", background: "#0c4a6e", background2: "#082f49", gradient: "radial", pattern: "rings", titleColor: "#f0f9ff", textColor: "#bae6fd", accentColor: "#38bdf8", accentBar: false, logoTint: "light" }),
  preset("spotlight", "Spotlight", "dark · centered", { layout: "spotlight", background: "#1e1b4b", background2: "#020617", gradient: "radial", pattern: "glow", titleColor: "#ffffff", textColor: "#c7d2fe", accentColor: "#818cf8", logoTint: "light" }),
  preset("mint", "Mint", "light · shapes", { layout: "centered", background: "#ecfdf5", background2: "#d1fae5", gradient: "vertical", pattern: "corner", titleColor: "#064e3b", textColor: "#047857", accentColor: "#10b981" }),
  preset("brutal", "Brutal", "loud · uppercase", { layout: "classic", background: "#facc15", background2: "#facc15", pattern: "stripes", titleColor: "#000000", textColor: "#1c1917", accentColor: "#000000", titleCase: "upper", titleSize: 64, logoTint: "dark" }),
  preset("mono", "Mono", "minimal · uppercase", { layout: "magazine", background: "#0a0a0a", background2: "#171717", gradient: "vertical", pattern: "grid", titleColor: "#fafafa", textColor: "#a3a3a3", accentColor: "#fafafa", titleWeight: "semibold", titleCase: "upper", titleSize: 60, logoTint: "light" }),
  preset("forest", "Forest", "dark · magazine", { layout: "magazine", background: "#022c22", background2: "#065f46", gradient: "diagonal", pattern: "grid", titleColor: "#ecfdf5", textColor: "#a7f3d0", accentColor: "#facc15", logoTint: "light" }),
  preset("coral", "Coral card", "vivid · card", { layout: "card", background: "#fb7185", background2: "#f43f5e", gradient: "vertical", pattern: "dots", surfaceColor: "#fff1f2", titleColor: "#4c0519", textColor: "#9f1239", accentColor: "#e11d48" }),
  preset("blueprint", "Blueprint", "technical · frame", { layout: "frame", background: "#1e40af", background2: "#1e3a8a", gradient: "vertical", pattern: "grid", titleColor: "#ffffff", textColor: "#bfdbfe", accentColor: "#93c5fd", titleWeight: "semibold", logoTint: "light" }),
];

export function resolveTemplate(template: OgTemplate): ResolvedTemplate {
  return { ...DEFAULT_TEMPLATE, ...template };
}

export function parseOgTemplate(raw: string | undefined): OgTemplate {
  let value: unknown;
  try {
    value = JSON.parse(raw?.trim() || "{}");
  } catch {
    throw new Error("Social image template: stored settings are not valid JSON");
  }
  if (!Value.Check(OgTemplateSchema, value)) {
    const issue = Value.Errors(OgTemplateSchema, value).First();
    throw new Error(
      `Social image template${issue?.path ?? ""}: ${
        issue?.schema.pattern ? "use a colour such as #1e3a8a" : (issue?.message ?? "invalid value")
      }`,
    );
  }
  return value;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What one image shows. Everything is plain text; the renderer lays it out. */
export type OgData = {
  title: string;
  description: string;
  siteName: string;
  url: string;
  section: string;
  date: string;
};

/** Turn a generated page into the text an image shows, applying template options. */
export function ogData(
  template: ResolvedTemplate,
  page: {
    title: string;
    description: string;
    canonical: string;
    datePublished: string;
    path: string;
    tableSlug?: string;
  },
  siteName: string,
): OgData {
  const site = template.siteName.trim() || siteName;
  let title = page.title.trim() || page.path;
  if (template.stripTitleSuffix && site) {
    const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = title.replace(new RegExp(`\\s*[|·•\\-–—:]\\s*${escaped}\\s*$`, "i"), "");
    if (stripped) title = stripped;
  }
  let url = page.canonical;
  try {
    const parsed = new URL(page.canonical);
    url = parsed.host.replace(/^www\./, "") + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    // Keep the raw canonical when it is not a URL.
  }
  const slug = page.tableSlug && page.tableSlug !== "pages" ? page.tableSlug : "";
  const section = slug
    ? slug.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : "";
  let date = "";
  if (page.datePublished && !Number.isNaN(Date.parse(page.datePublished)))
  {
    // The sandbox has no reliable Intl, so format by hand: "5 Oct 2026".
    const d = new Date(page.datePublished);
    date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  return { title, description: page.description.trim(), siteName: site, url, section, date };
}
