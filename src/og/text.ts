import { FONTS } from "./fonts.generated";
import { Path } from "./raster";

export type Weight = keyof typeof FONTS;
type Command = number[]; // [op, ...coords]: 0 move, 1 line, 2 quad, 3 close
type Glyph = { commands: Command[]; advance: number };

type LoadedFont = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  glyph(cp: number): Glyph | undefined;
  kern(a: number, b: number): number;
};

const loaded = new Map<Weight, LoadedFont>();

function parseOutline(source: string): Command[] {
  const commands: Command[] = [];
  for (const match of source.matchAll(/([MLQZ])([-\d,]*)/g)) {
    const op = "MLQZ".indexOf(match[1]!);
    commands.push([op, ...(match[2] ? match[2].split(",").map(Number) : [])]);
  }
  return commands;
}

export function font(weight: Weight): LoadedFont {
  const cached = loaded.get(weight);
  if (cached) return cached;
  const data = FONTS[weight];
  const chars = data.chars as Record<string, readonly [string, number]>;
  const outlines = data.outlines as Record<string, string>;
  const byName = new Map<string, Command[]>();
  const resolve = (name: string): Command[] => {
    const hit = byName.get(name);
    if (hit) return hit;
    const source = outlines[name] ?? "";
    let commands: Command[];
    if (source.startsWith("@")) {
      // Composite: base glyph plus offset parts such as accents.
      commands = [];
      for (const part of source.slice(1).split(";")) {
        const [partName, dx, dy] = part.split(",");
        for (const command of resolve(partName!)) {
          const shifted = [command[0]!];
          for (let i = 1; i < command.length; i += 2)
            shifted.push(command[i]! + Number(dx), command[i + 1]! + Number(dy));
          commands.push(shifted);
        }
      }
    } else commands = parseOutline(source);
    byName.set(name, commands);
    return commands;
  };
  const kerning = new Map<number, number>();
  for (const entry of data.kern.split(";")) {
    const [a, b, v] = entry.split(",").map(Number);
    if (a !== undefined && b !== undefined && v !== undefined) kerning.set(a * 65536 + b, v);
  }
  const value: LoadedFont = {
    unitsPerEm: data.unitsPerEm,
    ascender: data.ascender,
    descender: data.descender,
    capHeight: data.capHeight,
    glyph(cp) {
      const entry = chars[String(cp)];
      return entry ? { commands: resolve(entry[0]), advance: entry[1] } : undefined;
    },
    kern(a, b) {
      return kerning.get(base(a) * 65536 + base(b)) ?? 0;
    },
  };
  loaded.set(weight, value);
  return value;
}

/** Kerning is stored for ASCII; accented letters use their base letter's pairs. */
function base(cp: number): number {
  if (cp < 128) return cp;
  const plain = String.fromCodePoint(cp).normalize("NFD").codePointAt(0) ?? cp;
  return plain < 128 ? plain : cp;
}

const REPLACEMENTS: Record<string, string> = { " ": " ", "\t": " ", "−": "-" };

/** Characters the font can draw; others fall back to their unaccented form or are dropped. */
export function drawable(text: string, weight: Weight): number[] {
  const f = font(weight);
  const out: number[] = [];
  for (const char of text.normalize("NFC")) {
    const c = REPLACEMENTS[char] ?? char;
    const cp = c.codePointAt(0)!;
    if (f.glyph(cp)) out.push(cp);
    else {
      const plain = c.normalize("NFD").codePointAt(0)!;
      if (f.glyph(plain)) out.push(plain);
    }
  }
  return out;
}

export type TextStyle = { weight: Weight; size: number; letterSpacing?: number };

export function measure(cps: readonly number[], style: TextStyle): number {
  const f = font(style.weight);
  const scale = style.size / f.unitsPerEm;
  let width = 0;
  for (let i = 0; i < cps.length; i++) {
    width += f.glyph(cps[i]!)!.advance * scale + (style.letterSpacing ?? 0);
    if (i + 1 < cps.length) width += f.kern(cps[i]!, cps[i + 1]!) * scale;
  }
  return width;
}

const ELLIPSIS = 0x2026;

/**
 * Greedy word wrap. Returns lines as code points; when the text needs more
 * than `maxLines`, the last line ends with an ellipsis.
 */
export function wrap(
  text: string,
  style: TextStyle,
  maxWidth: number,
  maxLines: number,
): { lines: number[][]; truncated: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean).map((w) => drawable(w, style.weight));
  const space = drawable(" ", style.weight);
  const lines: number[][] = [];
  let current: number[] = [];
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!;
    // Break words that are wider than a whole line (long URLs, slugs).
    while (measure(word, style) > maxWidth && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut), style) > maxWidth) cut--;
      if (current.length) {
        lines.push(current);
        current = [];
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = current.length ? [...current, ...space, ...word] : word;
    if (measure(candidate, style) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length) lines.push(current);
  if (lines.length > maxLines) {
    truncated = true;
    lines.length = maxLines;
    let last = lines[maxLines - 1]!;
    const ellipsis = [ELLIPSIS];
    while (last.length && measure([...last, ...ellipsis], style) > maxWidth) last = last.slice(0, -1);
    // Avoid ending on a dangling space or punctuation before the ellipsis.
    while (last.length && /[\s,.;:–—-]/.test(String.fromCodePoint(last[last.length - 1]!)))
      last = last.slice(0, -1);
    lines[maxLines - 1] = [...last, ...ellipsis];
  }
  return { lines, truncated };
}

/** Largest size (stepping down) at which the text fits in `maxLines` without truncation. */
export function fit(
  text: string,
  style: TextStyle,
  maxWidth: number,
  maxLines: number,
  minSize: number,
): { size: number; lines: number[][] } {
  for (let size = style.size; size >= minSize; size -= 4) {
    const result = wrap(text, { ...style, size }, maxWidth, maxLines);
    if (!result.truncated) return { size, lines: result.lines };
  }
  return { size: minSize, lines: wrap(text, { ...style, size: minSize }, maxWidth, maxLines).lines };
}

/** Append one line of glyph outlines to a path, with its baseline at `y`. */
export function textPath(path: Path, cps: readonly number[], style: TextStyle, x: number, y: number) {
  const f = font(style.weight);
  const scale = style.size / f.unitsPerEm;
  let pen = x;
  for (let i = 0; i < cps.length; i++) {
    const glyph = f.glyph(cps[i]!)!;
    for (const command of glyph.commands) {
      const op = command[0];
      if (op === 0) path.moveTo(pen + command[1]! * scale, y - command[2]! * scale);
      else if (op === 1) path.lineTo(pen + command[1]! * scale, y - command[2]! * scale);
      else if (op === 2)
        path.quadTo(
          pen + command[1]! * scale,
          y - command[2]! * scale,
          pen + command[3]! * scale,
          y - command[4]! * scale,
        );
      else path.close();
    }
    pen += glyph.advance * scale + (style.letterSpacing ?? 0);
    if (i + 1 < cps.length) pen += f.kern(cps[i]!, cps[i + 1]!) * scale;
  }
  return pen;
}
