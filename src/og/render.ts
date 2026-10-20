import { OG_HEIGHT, OG_WIDTH, type OgData, type ResolvedTemplate } from "./template";
import {
  Path,
  background,
  canvas,
  drawImage,
  fill,
  glow,
  hex,
  mask,
  mix,
  paint,
  rect,
  type Bitmap,
  type Canvas,
  type Rgb,
} from "./raster";
import { drawable, fit, font, measure, textPath, wrap, type TextStyle } from "./text";

const W = OG_WIDTH,
  H = OG_HEIGHT,
  P = 72;

const luminance = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** Readable ink on top of a colour. */
const onColor = (color: Rgb): Rgb => (luminance(color) > 0.6 ? [17, 17, 17] : [255, 255, 255]);
const contrast = (a: Rgb, b: Rgb) => Math.abs(luminance(a) - luminance(b));
/** First colour that stands out from the background, else black or white. */
const readable = (bg: Rgb, ...choices: Rgb[]): Rgb =>
  choices.find((choice) => contrast(choice, bg) > 0.3) ?? onColor(bg);

type Block = { lines: number[][]; style: TextStyle; lineHeight: number; color: Rgb; opacity?: number };
type Box = { x: number; y: number; w: number; h: number };
type Align = "left" | "center";

const lineBox = (b: Block) => b.style.size * b.lineHeight;
const blockHeight = (b: Block) => b.lines.length * lineBox(b);
const capOf = (style: TextStyle) => {
  const f = font(style.weight);
  return (f.capHeight / f.unitsPerEm) * style.size;
};

function lineX(width: number, left: number, boxWidth: number, align: Align | "right") {
  return align === "left" ? left : align === "center" ? left + (boxWidth - width) / 2 : left + boxWidth - width;
}

/** Draw a text block with its top at `top`; `align` positions each line. */
function drawBlock(c: Canvas, b: Block, left: number, width: number, top: number, align: Align | "right" = "left") {
  const cap = capOf(b.style);
  const path = new Path();
  b.lines.forEach((line, i) => {
    const x = lineX(measure(line, b.style), left, width, align);
    textPath(path, line, b.style, x, top + i * lineBox(b) + lineBox(b) / 2 + cap / 2);
  });
  fill(c, path, b.color, b.opacity ?? 1);
}

function single(text: string, style: TextStyle, maxWidth: number, color: Rgb, opacity = 1): Block {
  return { lines: wrap(text, style, maxWidth, 1).lines, style, lineHeight: 1.2, color, opacity };
}

function logoTint(t: ResolvedTemplate): Rgb | undefined {
  return t.logoTint === "light" ? [255, 255, 255] : t.logoTint === "dark" ? [17, 17, 17] : undefined;
}

/** Brand row: logo (or letter mark) plus site name. Returns its height. */
function brand(
  c: Canvas,
  t: ResolvedTemplate,
  d: OgData,
  logo: Bitmap | undefined,
  o: { x: number; y: number; ink: Rgb; align: Align; maxWidth: number; size?: number; markColor?: Rgb; stacked?: boolean },
) {
  const size = o.size ?? 52;
  const accent = o.markColor ?? hex(t.accentColor);
  const useLogo = !!logo && t.showLogo;
  const mark = useLogo ? "" : t.brandMark.trim();
  const name = t.showSiteName ? d.siteName : "";
  let markW = 0;
  if (useLogo) markW = Math.min(o.maxWidth * (name && !o.stacked ? 0.6 : 1), (size * logo!.width) / logo!.height);
  else if (mark) markW = size;
  const markH = useLogo ? Math.min(size, (markW * logo!.height) / logo!.width) : size;
  const gap = 18;
  const nameSize = Math.round(size * (o.stacked ? 0.46 : 0.58));
  const room = o.stacked ? o.maxWidth : o.maxWidth - (markW ? markW + gap : 0);
  const fitted = name ? fit(name, { weight: "semibold", size: nameSize }, room, 1, Math.round(nameSize * 0.75)) : { size: nameSize, lines: [] };
  const nameStyle: TextStyle = { weight: "semibold", size: fitted.size };
  const nameCps = fitted.lines[0] ?? [];
  const nameW = nameCps.length ? measure(nameCps, nameStyle) : 0;
  const drawMark = (left: number, top: number) => {
    if (useLogo) drawImage(c, logo!, left, top + (size - markH) / 2, markW, markH, logoTint(t));
    else if (mark) {
      const box = new Path();
      box.roundRect(left, top, size, size, size * 0.27);
      fill(c, box, accent);
      const style: TextStyle = { weight: "bold", size: Math.round(size * (mark.length > 1 ? 0.42 : 0.54)) };
      const cps = drawable(mark, "bold");
      const p = new Path();
      textPath(p, cps, style, left + (size - measure(cps, style)) / 2, top + size / 2 + capOf(style) / 2);
      fill(c, p, onColor(accent));
    }
  };
  const drawName = (left: number, middle: number) => {
    if (!nameW) return;
    const p = new Path();
    textPath(p, nameCps, nameStyle, left, middle + capOf(nameStyle) / 2);
    fill(c, p, o.ink);
  };
  if (o.stacked) {
    // Mark above, name below, both centred in the column.
    const centre = o.x + o.maxWidth / 2;
    if (markW) drawMark(centre - markW / 2, o.y);
    drawName(centre - nameW / 2, o.y + (markW ? size + 26 : 0) + nameSize / 2);
    return (markW ? size + 26 : 0) + (nameW ? nameSize : 0);
  }
  const total = (markW ? markW + (nameW ? gap : 0) : 0) + nameW;
  let left = o.align === "center" ? o.x + (o.maxWidth - total) / 2 : o.x;
  if (markW) {
    drawMark(left, o.y);
    left += markW + gap;
  }
  drawName(left, o.y + size / 2);
  return markW || nameW ? size : 0;
}

/** Small uppercase pill, e.g. the collection name. */
function badge(c: Canvas, text: string, x: number, y: number, width: number, accent: Rgb, align: Align, bg: Rgb) {
  const style: TextStyle = { weight: "semibold", size: 20, letterSpacing: 2 };
  const cps = drawable(text.toUpperCase(), "semibold");
  const w = measure(cps, style) + 36;
  const left = align === "center" ? x + (width - w) / 2 : x;
  const pill = new Path();
  pill.roundRect(left, y, w, 40, 20);
  // A pale accent (yellow on white) gets a solid pill so the label stays legible.
  const solid = contrast(accent, bg) < 0.3;
  fill(c, pill, accent, solid ? 1 : 0.2);
  const p = new Path();
  textPath(p, cps, style, left + 18, y + 20 + capOf(style) / 2);
  fill(c, p, solid ? onColor(accent) : accent);
}

function pattern(c: Canvas, t: ResolvedTemplate, bg: Rgb) {
  const ink = mix(hex(t.titleColor), bg, 0.1);
  const accent = hex(t.accentColor);
  const second = hex(t.background2);
  switch (t.pattern) {
    case "dots": {
      const dot = new Path();
      dot.circle(2.5, 2.5, 2.5);
      const m = mask(dot, 8, 8)!;
      for (let y = 24; y < H; y += 36)
        for (let x = 24; x < W; x += 36) {
          // Fade towards the text side so the pattern never fights the title.
          const fade = Math.max(0, (x - W * 0.45) / (W * 0.55));
          if (fade > 0.02) paint(c, m, ink, 0.18 * fade, x, y);
        }
      return;
    }
    case "grid":
      for (let x = 0; x < W; x += 60) rect(c, x, 0, 1, H, ink, 0.07);
      for (let y = 0; y < H; y += 60) rect(c, 0, y, W, 1, ink, 0.07);
      return;
    case "circles":
      for (const [cx, cy, r, o] of [
        [W - 120, -60, 320, 0.16],
        [W - 40, H + 40, 220, 0.1],
        [W - 330, H - 70, 90, 0.08],
      ] as const) {
        const p = new Path();
        p.circle(cx, cy, r);
        fill(c, p, accent, o);
      }
      return;
    case "glow":
      glow(c, W * 0.82, H * 0.12, 520, accent, 0.45);
      glow(c, W * 0.08, H * 1.05, 380, accent, 0.22);
      return;
    case "mesh":
      // Overlapping soft spots in three hues, like a mesh gradient.
      glow(c, W * 0.15, H * 0.1, 560, accent, 0.5);
      glow(c, W * 0.9, H * 0.2, 520, mix(accent, [168, 85, 247], 0.7), 0.5);
      glow(c, W * 0.6, H * 1.1, 600, mix(accent, [59, 130, 246], 0.6), 0.45);
      return;
    case "stripes": {
      const p = new Path();
      for (let x = W * 0.52; x < W + H; x += 44) {
        p.moveTo(x, 0);
        p.lineTo(x + 18, 0);
        p.lineTo(x + 18 - H, H);
        p.lineTo(x - H, H);
        p.close();
      }
      fill(c, p, ink, 0.1);
      return;
    }
    case "waves":
      [0.14, 0.2, 0.27].forEach((top, i) => {
        const p = new Path();
        const y0 = H * (1 - top) + 20;
        p.moveTo(0, H);
        p.lineTo(0, y0);
        for (let k = 0; k < 4; k++) {
          const x = (k * W) / 4;
          p.quadTo(x + W / 8, y0 + (k % 2 ? 48 : -48) + i * 6, x + W / 4, y0);
        }
        p.lineTo(W, H);
        p.close();
        fill(c, p, i === 0 ? accent : [255, 255, 255], i === 0 ? 0.3 : 0.08);
      });
      return;
    case "rings": {
      const p = new Path();
      for (let r = 90; r < 600; r += 64) {
        p.circle(W - 110, H * 0.5, r);
        p.circle(W - 110, H * 0.5, r - 2, true);
      }
      fill(c, p, accent, 0.22);
      return;
    }
    case "corner": {
      const big = new Path();
      big.circle(W + 40, H + 60, 300);
      fill(c, big, accent, 0.9);
      const ring = new Path();
      ring.circle(W - 70, 90, 46);
      ring.circle(W - 70, 90, 32, true);
      fill(c, ring, second.some((v, i) => v !== bg[i]) ? second : accent, 0.9);
      const small = new Path();
      small.circle(110, H - 60, 18);
      fill(c, small, accent, 0.6);
      return;
    }
    default:
      return;
  }
}

type ContentOptions = {
  box: Box;
  /** Colour behind the content, for contrast decisions. */
  bg: Rgb;
  align: Align;
  vertical: "center" | "bottom";
  title: Rgb;
  text: Rgb;
  accent: Rgb;
  showBrand: boolean;
  brandSize?: number;
  titleLines?: number;
  titleWidth?: number;
  band?: boolean;
  footer?: boolean;
  accentBarAbove?: boolean;
};

/** Brand at the top, footer at the bottom, badge + title + description between. */
function content(c: Canvas, t: ResolvedTemplate, d: OgData, logo: Bitmap | undefined, o: ContentOptions) {
  const { box, align } = o;
  const sectionText = t.showSection ? d.section : "";
  const footerLeft = o.footer === false ? "" : t.footerText.trim() || (t.showUrl ? d.url : "");
  const footerRight = o.footer === false ? "" : t.showDate ? d.date : "";
  const hasBrand = o.showBrand && (t.showSiteName || !!t.brandMark.trim() || (!!logo && t.showLogo));
  const brandH = hasBrand
    ? brand(c, t, d, logo, { x: box.x, y: box.y, ink: readable(o.bg, o.band ? o.text : o.title, o.title, o.text), align, maxWidth: box.w, size: o.brandSize })
    : 0;
  const footerStyle: TextStyle = { weight: "regular", size: 24 };
  const footerY = box.y + box.h - 30;
  if (footerLeft || footerRight) {
    if (align === "center") {
      const text = [footerLeft, footerRight].filter(Boolean).join("  ·  ");
      drawBlock(c, single(text, footerStyle, box.w, o.text, 0.85), box.x, box.w, footerY, "center");
    } else {
      if (footerLeft) drawBlock(c, single(footerLeft, footerStyle, box.w * (footerRight ? 0.65 : 1), o.text, 0.85), box.x, box.w, footerY);
      if (footerRight) drawBlock(c, single(footerRight, footerStyle, box.w * 0.3, o.text, 0.85), box.x, box.w, footerY, "right");
    }
  }
  const top = box.y + (brandH ? brandH + 36 : 0);
  const bottom = footerLeft || footerRight ? footerY - 28 : box.y + box.h;
  const titleWidth = Math.min(o.titleWidth ?? box.w, box.w);
  const upper = t.titleCase === "upper";
  const titleStyle: TextStyle = { weight: t.titleWeight, size: t.titleSize, letterSpacing: upper ? 1 : -0.5 };
  const sectionH = sectionText ? 64 : 0;
  // Leave room for the badge so the title never collides with it.
  const maxLines = Math.max(1, Math.min(o.titleLines ?? 3, Math.floor((bottom - top - sectionH) / (40 * 1.12))));
  const fitted = fit(upper ? d.title.toUpperCase() : d.title, titleStyle, titleWidth - (o.band ? 28 : 0), maxLines, 36);
  const titleBlock: Block = {
    lines: fitted.lines,
    style: { ...titleStyle, size: fitted.size },
    lineHeight: o.band ? 1.3 : 1.12,
    color: o.band ? onColor(o.accent) : o.title,
  };
  const descStyle: TextStyle = { weight: "regular", size: 30 };
  const room = bottom - top - blockHeight(titleBlock) - sectionH;
  const descLines = Math.min(2, Math.floor((room - 24) / (descStyle.size * 1.4)));
  const desc: Block | null =
    t.showDescription && d.description && descLines > 0
      ? { lines: wrap(d.description, descStyle, titleWidth, descLines).lines, style: descStyle, lineHeight: 1.4, color: o.text }
      : null;
  const gap = desc ? 24 : 0;
  const total = sectionH + blockHeight(titleBlock) + gap + (desc ? blockHeight(desc) : 0);
  let y = o.vertical === "bottom" ? bottom - total : top + Math.max(0, (bottom - top - total) / 2);
  const left = align === "center" ? box.x + (box.w - titleWidth) / 2 : box.x;
  if (o.accentBarAbove && t.accentBar) rect(c, align === "center" ? box.x + box.w / 2 - 32 : left, y - 30, 64, 6, o.accent);
  if (sectionText) {
    badge(c, sectionText, left, y, titleWidth, o.accent, align, o.bg);
    y += sectionH;
  }
  if (o.band) {
    // Highlighter: a solid bar behind each title line.
    const bar = lineBox(titleBlock) * 0.84;
    titleBlock.lines.forEach((line, i) => {
      const w = measure(line, titleBlock.style) + 28;
      const x = lineX(w, left, titleWidth, align);
      const p = new Path();
      p.roundRect(x, y + i * lineBox(titleBlock) + (lineBox(titleBlock) - bar) / 2, w, bar, 6);
      fill(c, p, o.accent);
    });
    drawBlock(c, titleBlock, left + (align === "left" ? 14 : 0), titleWidth, y, align);
  } else drawBlock(c, titleBlock, left, titleWidth, y, align);
  y += blockHeight(titleBlock);
  if (desc) drawBlock(c, desc, left, titleWidth, y + gap, align);
  return { titleBottom: y };
}

/** Render one social image. Deterministic: same template, data and logo give the same pixels. */
export function renderOg(t: ResolvedTemplate, d: OgData, logo?: Bitmap): Canvas {
  const c = canvas(W, H);
  const bg = hex(t.background);
  background(c, bg, hex(t.gradient === "none" ? t.background : t.background2), t.gradient);
  const title = hex(t.titleColor),
    text = hex(t.textColor),
    accent = hex(t.accentColor),
    surface = hex(t.surfaceColor);
  const full: Box = { x: P, y: P - 8, w: W - 2 * P, h: H - 2 * P + 12 };
  const base = { title, text, accent, showBrand: true, bg } as const;

  switch (t.layout) {
    case "split": {
      const panel = 400;
      rect(c, 0, 0, panel, H, accent);
      const ink = onColor(accent);
      brand(c, t, d, logo, { x: 56, y: 56, ink, align: "left", maxWidth: panel - 112, markColor: bg });
      const sectionText = t.showSection ? d.section : "";
      if (sectionText) drawBlock(c, single(sectionText.toUpperCase(), { weight: "semibold", size: 22, letterSpacing: 2 }, panel - 112, ink, 0.85), 56, panel - 112, H - 56 - 40 - (t.showDate ? 40 : 0));
      if (t.showDate && d.date) drawBlock(c, single(d.date, { weight: "regular", size: 22 }, panel - 112, ink, 0.75), 56, panel - 112, H - 56 - 30);
      const box: Box = { x: panel + 64, y: P, w: W - panel - 64 - P, h: H - 2 * P };
      if (t.accentBar) rect(c, box.x, P - 8, 72, 6, accent);
      content(c, { ...t, showSection: false, showDate: false }, d, logo, { ...base, box, align: "left", vertical: "center", showBrand: false, titleLines: 4 });
      return c;
    }
    case "sidebar": {
      const panel = 380;
      rect(c, W - panel, 0, panel, H, surface);
      const ink = onColor(surface);
      const hasLogo = !!logo && t.showLogo;
      const markSize = hasLogo ? 120 : 112;
      const stackH = (hasLogo || t.brandMark.trim() ? markSize + 26 : 0) + (t.showSiteName ? 26 : 0);
      brand(c, t, d, logo, { x: W - panel + 50, y: (H - stackH) / 2, ink, align: "center", maxWidth: panel - 100, size: markSize, markColor: accent, stacked: true });
      const box: Box = { x: P, y: P - 8, w: W - panel - P - 56, h: H - 2 * P + 12 };
      content(c, { ...t, showSiteName: false }, d, undefined, { ...base, box, align: "left", vertical: "center", showBrand: false, titleLines: 4, accentBarAbove: true });
      return c;
    }
    case "card": {
      pattern(c, t, bg);
      const card: Box = { x: 56, y: 52, w: W - 112, h: H - 104 };
      for (const [spread, offset, o] of [[18, 22, 0.08], [8, 10, 0.1]] as const) {
        const shadow = new Path();
        shadow.roundRect(card.x - spread / 2, card.y + offset - spread / 2, card.w + spread, card.h + spread, 36);
        fill(c, shadow, [0, 0, 0], o);
      }
      const panel = new Path();
      panel.roundRect(card.x, card.y, card.w, card.h, 32);
      fill(c, panel, surface);
      content(c, t, d, logo, { ...base, bg: surface, box: { x: card.x + 56, y: card.y + 44, w: card.w - 112, h: card.h - 88 }, align: "left", vertical: "center", titleWidth: 900 });
      return c;
    }
    case "frame": {
      pattern(c, t, bg);
      const inset = 30;
      rect(c, inset, inset, W - 2 * inset, 3, accent);
      rect(c, inset, H - inset - 3, W - 2 * inset, 3, accent);
      rect(c, inset, inset, 3, H - 2 * inset, accent);
      rect(c, W - inset - 3, inset, 3, H - 2 * inset, accent);
      content(c, t, d, logo, { ...base, box: { x: P + 24, y: P + 4, w: W - 2 * P - 48, h: H - 2 * P - 8 }, align: "left", vertical: "center", titleWidth: 940 });
      return c;
    }
    case "quote": {
      pattern(c, t, bg);
      // Classic quote mark drawn as two balls with tails, so it reads at any size.
      const q = new Path();
      for (const x of [P + 30, P + 112]) {
        const cy = P + 74;
        q.circle(x, cy, 30);
        q.moveTo(x - 30, cy);
        q.quadTo(x - 30, cy - 54, x + 18, cy - 74);
        q.lineTo(x + 22, cy - 62);
        q.quadTo(x - 4, cy - 46, x, cy - 30);
        q.close();
      }
      fill(c, q, accent);
      // The brand moves to the footer so the quote mark owns the top.
      const footerBrandH = 44;
      const hasBrand = t.showSiteName || !!t.brandMark.trim() || (!!logo && t.showLogo);
      if (hasBrand) brand(c, t, d, logo, { x: P, y: H - P - footerBrandH + 6, ink: title, align: "left", maxWidth: W * 0.5, size: footerBrandH });
      const right = t.showUrl ? t.footerText.trim() || d.url : t.footerText.trim();
      if (right) drawBlock(c, single(right, { weight: "regular", size: 22 }, W * 0.38, text, 0.85), P, W - 2 * P, H - P - 30, hasBrand ? "right" : "left");
      content(c, { ...t, showUrl: false, footerText: "", showDate: false }, d, logo, { ...base, box: { x: P, y: P + 120, w: W - 2 * P, h: H - 2 * P - 120 - 70 }, align: "left", vertical: "center", showBrand: false, titleWidth: 1000 });
      return c;
    }
    case "spotlight":
      pattern(c, t, bg);
      content(c, t, d, logo, { ...base, box: full, align: "center", vertical: "center", brandSize: 72, titleWidth: full.w - 80 });
      return c;
    case "centered":
      pattern(c, t, bg);
      content(c, t, d, logo, { ...base, box: full, align: "center", vertical: "center", titleWidth: full.w - 80 });
      if (t.accentBar && !t.showDescription) rect(c, (W - 80) / 2, H - P - 70, 80, 6, accent);
      return c;
    case "magazine":
      pattern(c, t, bg);
      content(c, t, d, logo, { ...base, box: full, align: "left", vertical: "bottom", titleWidth: 980, accentBarAbove: true });
      return c;
    case "band":
      pattern(c, t, bg);
      content(c, t, d, logo, { ...base, box: full, align: "left", vertical: "center", titleWidth: 1000, band: true });
      return c;
    default: {
      // classic
      pattern(c, t, bg);
      const bar = t.accentBar ? 16 : 0;
      if (bar) rect(c, 0, 0, 14, H, accent);
      content(c, t, d, logo, { ...base, box: { ...full, x: P + bar, w: full.w - bar }, align: "left", vertical: "center", titleWidth: 980 });
      return c;
    }
  }
}
