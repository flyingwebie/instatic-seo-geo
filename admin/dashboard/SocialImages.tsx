import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { usePluginRoutes } from "@instatic/host-hooks";
import {
  Alert,
  Button,
  Input,
  Select,
  Stack,
  Switch,
  Text,
} from "@instatic/host-ui";
import { decodeLogo } from "../../src/og/logo";
import type { Bitmap } from "../../src/og/raster";
import { LogoPicker } from "./LogoPicker";
import type { StatusSchema } from "../../src/adminSchemas";
import { renderOg } from "../../src/og/render";
import { encodePng } from "../../src/og/png";
import {
  OG_HEIGHT,
  OG_WIDTH,
  TEMPLATE_PRESETS,
  ogData,
  resolveTemplate,
  type OgData,
  type OgTemplate,
  type ResolvedTemplate,
} from "../../src/og/template";
import { Badge, Grid, Section } from "./ui";

type Status = Static<typeof StatusSchema>;

const StoredLogoSchema = Type.Object({
  logo: Type.Union([
    Type.Object({ name: Type.String(), width: Type.Integer(), height: Type.Integer(), data: Type.String() }),
    Type.Null(),
  ]),
});

const LAYOUT_LABELS: Record<NonNullable<OgTemplate["layout"]>, string> = {
  classic: "Classic",
  centered: "Centered",
  split: "Split panel",
  magazine: "Magazine (title at bottom)",
  card: "Floating card",
  frame: "Frame",
  spotlight: "Spotlight (big logo)",
  sidebar: "Sidebar (logo panel)",
  band: "Highlighter",
  quote: "Quote",
};
const PATTERN_LABELS: Record<NonNullable<OgTemplate["pattern"]>, string> = {
  none: "None",
  dots: "Dots",
  grid: "Grid",
  circles: "Circles",
  glow: "Glow",
  mesh: "Mesh gradient",
  stripes: "Stripes",
  waves: "Waves",
  rings: "Rings",
  corner: "Corner shapes",
};

const THUMB_W = 240,
  THUMB_H = 126;

/** One template in the gallery, drawn with the real renderer at thumbnail size. */
function Thumbnail(props: {
  template: ResolvedTemplate;
  data: OgData;
  logo: Bitmap | undefined;
  delay: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(props.template) + JSON.stringify(props.data) + (props.logo ? props.logo.width : 0);
  useEffect(() => {
    // Stagger renders so the gallery fills in without blocking typing.
    const timer = setTimeout(() => {
      const target = ref.current?.getContext("2d");
      if (!target) return;
      const image = renderOg(props.template, props.data, props.logo);
      const full = document.createElement("canvas");
      full.width = OG_WIDTH;
      full.height = OG_HEIGHT;
      full.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.data.buffer as ArrayBuffer), OG_WIDTH, OG_HEIGHT), 0, 0);
      target.imageSmoothingQuality = "high";
      target.drawImage(full, 0, 0, THUMB_W, THUMB_H);
    }, props.delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} width={THUMB_W} height={THUMB_H} style={{ width: "100%", height: "auto", display: "block" }} />;
}

const SAMPLE = {
  path: "/sample",
  title: "How to choose the right website partner for your business",
  description:
    "A practical checklist covering budget, timelines, accessibility and the questions to ask before you sign.",
  canonical: "https://www.example.com/blog/choosing-a-website-partner",
  datePublished: new Date().toISOString(),
  section: "blog",
};

function ColorField(props: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const [shown, setShown] = useState(props.value);
  // Follow outside changes (presets) without an effect.
  if (props.value !== shown) {
    setShown(props.value);
    setDraft(props.value);
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: "var(--text-s)", color: "var(--text-muted)", fontWeight: 600 }}>
        {props.label}
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 8, alignItems: "center" }}>
        <input
          type="color"
          aria-label={props.label}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          style={{
            width: 40,
            height: 32,
            padding: 0,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            cursor: "pointer",
          }}
        />
        <Input
          value={draft}
          disabled={props.disabled}
          invalid={!/^#[0-9a-fA-F]{6}$/.test(draft)}
          onChange={(next) => {
            setDraft(next);
            if (/^#[0-9a-fA-F]{6}$/.test(next)) props.onChange(next.toLowerCase());
          }}
        />
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={10}>
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {title}
      </span>
      {children}
    </Stack>
  );
}

export function SocialImages(props: {
  value: OgTemplate;
  onChange: (next: OgTemplate) => void;
  status: Status | undefined;
  error: string;
  disabled: boolean;
  dirty: boolean;
  actions: ReactNode;
}) {
  const t = resolveTemplate(props.value);
  const set = (patch: Partial<OgTemplate>) => props.onChange({ ...props.value, ...patch });
  const routes = usePluginRoutes();
  const [logo, setLogo] = useState<{ hash: string; bitmap: Bitmap } | null>(null);
  const logoHash = props.value.logo?.hash;
  useEffect(() => {
    // Load the saved logo's pixels for previews.
    if (!logoHash || logo?.hash === logoHash) return;
    let active = true;
    routes
      .json(`/og-logo?hash=${logoHash}`, StoredLogoSchema)
      .then((result) => {
        if (active && result.logo) setLogo({ hash: logoHash, bitmap: decodeLogo(result.logo) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoHash]);
  const logoBitmap = logo && logo.hash === logoHash ? logo.bitmap : undefined;
  const pages = props.status?.pages ?? [];
  const [previewPath, setPreviewPath] = useState("");
  const page = pages.find((p) => p.path === previewPath) ?? pages[0];
  const siteName = t.siteName || props.status?.siteName || "Your website";
  const data = useMemo(
    () =>
      ogData(
        t,
        page
          ? {
              path: page.path,
              title: page.title,
              description: page.description ?? "",
              canonical: page.canonical,
              datePublished: page.datePublished ?? "",
              tableSlug: page.section,
            }
          : { ...SAMPLE, tableSlug: SAMPLE.section },
        siteName,
      ),
    // Re-derive whenever any design value or the chosen page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(t), page?.path, siteName],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLCanvasElement>(null);
  const [renderMs, setRenderMs] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = canvasRef.current?.getContext("2d");
      if (!target) return;
      const started = performance.now();
      const image = renderOg(t, data, logoBitmap);
      target.putImageData(
        new ImageData(new Uint8ClampedArray(image.data.buffer as ArrayBuffer), OG_WIDTH, OG_HEIGHT),
        0,
        0,
      );
      setRenderMs(Math.round(performance.now() - started));
      // Mirror into the "when shared" card at its smaller size.
      const card = cardRef.current;
      card?.getContext("2d")?.drawImage(canvasRef.current!, 0, 0, card.width, card.height);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(t), data, logoBitmap]);

  const usingGenerated = pages.filter((p) => p.ogImage).length;
  const ownImage = pages.filter((p) => p.socialImage === "authored" || p.socialImage === "meta").length;
  const download = () => {
    const png = encodePng(renderOg(t, data, logoBitmap));
    const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `social-image${page ? page.path.replace(/\//g, "-") : "-sample"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  let host = "example.com";
  try {
    host = new URL(page?.canonical ?? SAMPLE.canonical).host.replace(/^www\./, "");
  } catch {
    // Keep the placeholder host.
  }

  return (
    <Stack gap={16}>
      <Section
        title="Social images"
        description="Design one template and every page gets its own 1200×630 sharing image with its title, generated as a static PNG. They show when someone shares a link on LinkedIn, Facebook, X, Slack, WhatsApp and more."
      >
        <Stack direction="row" gap={8} wrap align="center">
          {t.enabled ? <Badge tone="good">On</Badge> : <Badge tone="neutral">Off</Badge>}
          {props.dirty && <Badge tone="warning">Unsaved changes</Badge>}
          {props.status?.generated ? (
            <Text variant="muted">
              {usingGenerated} of {pages.length} pages use a generated image · {ownImage} have their own
            </Text>
          ) : null}
        </Stack>
        <Grid min={300}>
          <Switch
            label="Generate social images"
            description="Images are created during Save & generate and updated when page titles change."
            checked={t.enabled}
            disabled={props.disabled}
            onChange={(enabled) => set({ enabled })}
          />
          <Select
            label="Use the generated image on"
            value={t.mode}
            disabled={props.disabled}
            onChange={(mode) => set({ mode: mode as OgTemplate["mode"] })}
            options={[
              { value: "missing", label: "Pages without their own social image" },
              { value: "always", label: "Every page (except images set in Setup → Pages)" },
            ]}
          />
        </Grid>
      </Section>

      <Section
        title="Choose a template"
        description="20 designs, previewed with your page and logo. Pick one, then fine-tune it below. Your texts, logo and switches are kept when you switch."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {TEMPLATE_PRESETS.map((preset, i) => {
            const selected = props.value.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={props.disabled}
                aria-pressed={selected}
                onClick={() => set({ ...preset.design, preset: preset.id })}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: 6,
                  textAlign: "left",
                  background: selected ? "var(--bg-surface-3)" : "transparent",
                  border: `2px solid ${selected ? "var(--accent-3)" : "var(--border-subtle)"}`,
                  borderRadius: "var(--radius)",
                  cursor: props.disabled ? "default" : "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ borderRadius: 6, overflow: "hidden", aspectRatio: `${OG_WIDTH} / ${OG_HEIGHT}`, background: "var(--bg-surface-2)" }}>
                  <Thumbnail template={resolveTemplate({ ...props.value, ...preset.design })} data={data} logo={logoBitmap} delay={i * 30} />
                </div>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "0 2px" }}>
                  <span style={{ fontSize: "var(--text-s)", fontWeight: 600, color: "var(--text-bright)" }}>
                    {selected ? "✓ " : ""}
                    {preset.name}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{preset.tags}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Section title="Customise">
          <Group title="Logo">
            <LogoPicker
              logo={props.value.logo}
              disabled={props.disabled}
              onPick={(picked, bitmap) => {
                setLogo({ hash: picked.hash, bitmap });
                // Logos usually include the name, so hide the duplicate text.
                set({ logo: picked, showLogo: true, showSiteName: false });
              }}
              onRemove={() => {
                const next = { ...props.value };
                delete next.logo;
                props.onChange(next);
              }}
            />
            {props.value.logo && (
              <Grid min={150} gap={10}>
                <Switch label="Show logo" checked={t.showLogo} disabled={props.disabled} onChange={(showLogo) => set({ showLogo })} />
                <Select
                  label="Logo colour"
                  value={t.logoTint}
                  disabled={props.disabled}
                  onChange={(logoTint) => set({ logoTint: logoTint as OgTemplate["logoTint"] })}
                  options={[
                    { value: "original", label: "Original colours" },
                    { value: "light", label: "All white" },
                    { value: "dark", label: "All dark" },
                  ]}
                />
              </Grid>
            )}
            <Text variant="muted">
              The logo replaces the letter mark and hides the site name text (turn "Site name" back on below if you want both). Presets pick white or dark logo colours to suit their background; change it here.
            </Text>
          </Group>
          <Group title="Layout & background">
            <Grid min={150} gap={10}>
              <Select
                label="Layout"
                value={t.layout}
                disabled={props.disabled}
                onChange={(layout) => set({ layout: layout as OgTemplate["layout"] })}
                options={Object.entries(LAYOUT_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Select
                label="Title case"
                value={t.titleCase}
                disabled={props.disabled}
                onChange={(titleCase) => set({ titleCase: titleCase as OgTemplate["titleCase"] })}
                options={[
                  { value: "normal", label: "As written" },
                  { value: "upper", label: "UPPERCASE" },
                ]}
              />
            </Grid>
          </Group>
          <Group title="Colours">
            <Grid min={150} gap={10}>
              <ColorField label="Background" value={t.background} disabled={props.disabled} onChange={(background) => set({ background })} />
              <ColorField label="Gradient to" value={t.background2} disabled={props.disabled || t.gradient === "none"} onChange={(background2) => set({ background2 })} />
              <ColorField label="Title" value={t.titleColor} disabled={props.disabled} onChange={(titleColor) => set({ titleColor })} />
              <ColorField label="Text" value={t.textColor} disabled={props.disabled} onChange={(textColor) => set({ textColor })} />
              <ColorField label="Accent" value={t.accentColor} disabled={props.disabled} onChange={(accentColor) => set({ accentColor })} />
              <ColorField label="Card / panel" value={t.surfaceColor} disabled={props.disabled || !["card", "sidebar"].includes(t.layout)} onChange={(surfaceColor) => set({ surfaceColor })} />
            </Grid>
            <Grid min={150} gap={10}>
              <Select
                label="Gradient"
                value={t.gradient}
                disabled={props.disabled}
                onChange={(gradient) => set({ gradient: gradient as OgTemplate["gradient"] })}
                options={[
                  { value: "none", label: "None" },
                  { value: "vertical", label: "Top to bottom" },
                  { value: "horizontal", label: "Left to right" },
                  { value: "diagonal", label: "Diagonal" },
                  { value: "radial", label: "Radial glow" },
                ]}
              />
              <Select
                label="Pattern"
                value={t.pattern}
                disabled={props.disabled || ["split", "sidebar"].includes(t.layout)}
                onChange={(pattern) => set({ pattern: pattern as OgTemplate["pattern"] })}
                options={Object.entries(PATTERN_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Grid>
          </Group>
          <Group title="Title">
            <Grid min={150} gap={10}>
              <Select
                label="Weight"
                value={t.titleWeight}
                disabled={props.disabled}
                onChange={(titleWeight) => set({ titleWeight: titleWeight as OgTemplate["titleWeight"] })}
                options={[
                  { value: "bold", label: "Bold" },
                  { value: "semibold", label: "Semibold" },
                  { value: "regular", label: "Regular" },
                ]}
              />
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: "var(--text-s)", color: "var(--text-muted)", fontWeight: 600 }}>
                  Largest size · {t.titleSize}px
                </span>
                <input
                  type="range"
                  min={40}
                  max={96}
                  step={4}
                  value={t.titleSize}
                  disabled={props.disabled}
                  onChange={(event) => set({ titleSize: Number(event.currentTarget.value) })}
                />
              </label>
            </Grid>
            <Text variant="muted">Long titles shrink to fit three lines, then end with "…".</Text>
            <Switch
              label="Remove the site name from the end of titles"
              description={'"Services | Flying Web" shows as "Services".'}
              checked={t.stripTitleSuffix}
              disabled={props.disabled}
              onChange={(stripTitleSuffix) => set({ stripTitleSuffix })}
            />
          </Group>
          <Group title="Brand & text">
            <Grid min={150} gap={10}>
              <Input
                label="Brand mark"
                description="Up to 3 letters, shown when there is no logo."
                placeholder="FW"
                value={t.brandMark}
                disabled={props.disabled}
                onChange={(brandMark) => set({ brandMark: brandMark.slice(0, 3) })}
              />
              <Input
                label="Site name"
                description="Blank uses the CMS site name."
                placeholder={props.status?.siteName || "Your website"}
                value={t.siteName}
                disabled={props.disabled}
                onChange={(name) => set({ siteName: name })}
              />
            </Grid>
            <Input
              label="Footer text"
              description="Replaces the page address at the bottom, e.g. a slogan or phone number."
              placeholder="example.com · Web design in Dublin"
              value={t.footerText}
              disabled={props.disabled}
              onChange={(footerText) => set({ footerText })}
            />
            <Grid min={200} gap={4}>
              <Switch label="Site name" checked={t.showSiteName} disabled={props.disabled} onChange={(showSiteName) => set({ showSiteName })} />
              <Switch label="Description" checked={t.showDescription} disabled={props.disabled} onChange={(showDescription) => set({ showDescription })} />
              <Switch label="Page address" checked={t.showUrl} disabled={props.disabled} onChange={(showUrl) => set({ showUrl })} />
              <Switch label="Collection badge" checked={t.showSection} disabled={props.disabled} onChange={(showSection) => set({ showSection })} />
              <Switch label="Publish date" checked={t.showDate} disabled={props.disabled} onChange={(showDate) => set({ showDate })} />
              <Switch label="Accent bar" checked={t.accentBar} disabled={props.disabled} onChange={(accentBar) => set({ accentBar })} />
            </Grid>
          </Group>
        </Section>

        <div style={{ position: "sticky", top: 16, display: "grid", gap: 16 }}>
          <Section
            title="Live preview"
            action={
              <Button variant="ghost" size="sm" onClick={download}>
                Download PNG
              </Button>
            }
          >
            {pages.length > 0 && (
              <Select
                label="Preview with page"
                value={page?.path ?? ""}
                onChange={setPreviewPath}
                options={pages.map((p) => ({ value: p.path, label: `${p.title || p.path} — ${p.path}` }))}
              />
            )}
            <canvas
              ref={canvasRef}
              width={OG_WIDTH}
              height={OG_HEIGHT}
              role="img"
              aria-label={`Social image preview: ${data.title}`}
              style={{
                width: "100%",
                height: "auto",
                aspectRatio: `${OG_WIDTH} / ${OG_HEIGHT}`,
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                display: "block",
              }}
            />
            <Text variant="muted">
              Exactly what the server generates · 1200×630 PNG · drawn in {renderMs} ms
              {pages.length ? "" : " · sample text until your site is generated"}
            </Text>
            {page?.ogImage && (
              <a href={page.ogImage} target="_blank" rel="noreferrer" style={{ fontSize: "var(--text-s)", color: "var(--accent-3)" }}>
                Open the published image for this page ↗
              </a>
            )}
          </Section>
          <Section title="When shared" description="How a link card typically looks in a feed.">
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
                background: "var(--bg-surface-2)",
                maxWidth: 520,
              }}
            >
              <canvas
                ref={cardRef}
                width={520}
                height={273}
                style={{ width: "100%", height: "auto", display: "block" }}
              />
              <div style={{ padding: "10px 14px", display: "grid", gap: 2 }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", textTransform: "uppercase" }}>
                  {host}
                </span>
                <span style={{ fontSize: "var(--text-m)", color: "var(--text-bright)", fontWeight: 600 }}>
                  {page?.title || SAMPLE.title}
                </span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {props.error && (
        <Alert tone="danger" title="Check the social image design">
          {props.error}
        </Alert>
      )}
      <Section
        title="Publish your images"
        description="Save & generate creates an image for each page (about a second each, and only for pages that changed) and adds it to the page's sharing tags. Social networks cache previews; use their link debuggers to refresh a card you already shared."
      >
        {props.actions}
      </Section>
    </Stack>
  );
}
