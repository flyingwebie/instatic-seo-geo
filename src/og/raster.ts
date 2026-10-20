/**
 * Minimal software canvas for social images: RGBA pixels, filled paths with
 * anti-aliasing (signed-area accumulation, as in font-rs) and alpha blending.
 * Pure TypeScript so it runs in the plugin sandbox and in the browser alike.
 */

export type Rgb = [number, number, number];
export type Canvas = { width: number; height: number; data: Uint8Array };

export function canvas(width: number, height: number): Canvas {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function hex(color: string): Rgb {
  const value = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? "000000";
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Opaque fill of the whole canvas; gradients are computed per row/column. */
export function background(
  c: Canvas,
  from: Rgb,
  to: Rgb,
  direction: "none" | "vertical" | "horizontal" | "diagonal" | "radial",
) {
  const { width, height, data } = c;
  if (direction === "radial") {
    // Light source above centre; a 64-step lookup keeps the loop cheap.
    const steps: Rgb[] = [];
    for (let i = 0; i <= 64; i++) steps.push(mix(from, to, i / 64));
    const cx = width * 0.5,
      cy = height * 0.3;
    const max = (width * 0.62) ** 2;
    for (let y = 0; y < height; y++) {
      const dy2 = (y - cy) ** 2;
      let i = y * width * 4;
      for (let x = 0; x < width; x++, i += 4) {
        const t = Math.min(1, ((x - cx) ** 2 + dy2) / max);
        const color = steps[Math.round(Math.sqrt(t) * 64)]!;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 255;
      }
    }
    return;
  }
  const row = new Uint8Array(width * 4);
  const setRow = (y: number) => data.set(row, y * width * 4);
  const paint = (x: number, color: Rgb) => {
    row[x * 4] = color[0];
    row[x * 4 + 1] = color[1];
    row[x * 4 + 2] = color[2];
    row[x * 4 + 3] = 255;
  };
  if (direction === "none" || direction === "vertical") {
    for (let y = 0; y < height; y++) {
      const color = direction === "none" ? from : mix(from, to, y / (height - 1));
      for (let x = 0; x < width; x++) paint(x, color);
      setRow(y);
    }
    return;
  }
  // Horizontal rows are identical; diagonal rows are a shifted horizontal ramp.
  const span = direction === "horizontal" ? width : width + height;
  const ramp: Rgb[] = [];
  for (let i = 0; i < span; i++) ramp.push(mix(from, to, i / (span - 1)));
  for (let y = 0; y < height; y++) {
    if (y === 0 || direction === "diagonal") {
      for (let x = 0; x < width; x++) paint(x, ramp[direction === "diagonal" ? x + y : x]!);
    }
    setRow(y);
  }
}

/** Path made of straight segments, in pixel coordinates. */
export class Path {
  readonly segments: number[] = [];
  private sx = 0;
  private sy = 0;
  private x = 0;
  private y = 0;
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  private grow(x: number, y: number) {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }
  moveTo(x: number, y: number) {
    this.sx = this.x = x;
    this.sy = this.y = y;
    this.grow(x, y);
  }
  lineTo(x: number, y: number) {
    this.segments.push(this.x, this.y, x, y);
    this.x = x;
    this.y = y;
    this.grow(x, y);
  }
  quadTo(cx: number, cy: number, x: number, y: number) {
    const ddx = this.x - 2 * cx + x,
      ddy = this.y - 2 * cy + y;
    const steps = Math.min(24, 1 + Math.floor(Math.sqrt(Math.sqrt(ddx * ddx + ddy * ddy) * 3)));
    const x0 = this.x,
      y0 = this.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
  }
  close() {
    if (this.x !== this.sx || this.y !== this.sy) this.lineTo(this.sx, this.sy);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadTo(x, y, x + r, y);
    this.close();
  }
  /** Pass `reverse` for a hole: an opposite winding cancels the fill. */
  circle(cx: number, cy: number, r: number, reverse = false) {
    // Eight quadratic arcs approximate a circle within a fraction of a pixel.
    const dir = reverse ? -1 : 1;
    this.moveTo(cx + r, cy);
    for (let i = 1; i <= 8; i++) {
      const a0 = (dir * (i - 1) * Math.PI) / 4,
        a1 = (dir * i * Math.PI) / 4,
        am = (a0 + a1) / 2;
      const rc = r / Math.cos(Math.PI / 8);
      this.quadTo(cx + rc * Math.cos(am), cy + rc * Math.sin(am), cx + r * Math.cos(a1), cy + r * Math.sin(a1));
    }
    this.close();
  }
}

/** Coverage mask (0..1) for a path, cropped to its bounding box. */
export type Mask = { x: number; y: number; width: number; height: number; alpha: Float32Array };

export function mask(path: Path, clipWidth: number, clipHeight: number): Mask | null {
  if (!path.segments.length) return null;
  const x0 = Math.max(0, Math.floor(path.minX)),
    y0 = Math.max(0, Math.floor(path.minY));
  const x1 = Math.min(clipWidth, Math.ceil(path.maxX) + 1),
    y1 = Math.min(clipHeight, Math.ceil(path.maxY) + 1);
  const w = x1 - x0,
    h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const acc = new Float32Array(w * h + 2);
  const s = path.segments;
  for (let i = 0; i < s.length; i += 4)
    line(acc, w, h, s[i]! - x0, s[i + 1]! - y0, s[i + 2]! - x0, s[i + 3]! - y0);
  const alpha = new Float32Array(w * h);
  for (let row = 0; row < h; row++) {
    let sum = 0;
    const base = row * w;
    for (let col = 0; col < w; col++) {
      sum += acc[base + col]!;
      const a = sum < 0 ? -sum : sum;
      alpha[base + col] = a > 1 ? 1 : a;
    }
  }
  return { x: x0, y: y0, width: w, height: h, alpha };
}

/** Accumulate the signed area a line covers in each pixel (font-rs). */
function line(a: Float32Array, w: number, h: number, ax: number, ay: number, bx: number, by: number) {
  if (ay === by) return;
  // Keep x inside the mask; clamped spans still contribute the right area.
  const maxX = w - 1.001;
  ax = ax < 0 ? 0 : ax > maxX ? maxX : ax;
  bx = bx < 0 ? 0 : bx > maxX ? maxX : bx;
  let dir = 1;
  if (ay > by) {
    dir = -1;
    [ax, ay, bx, by] = [bx, by, ax, ay];
  }
  const dxdy = (bx - ax) / (by - ay);
  let x = ax;
  if (ay < 0) x -= ay * dxdy;
  const yEnd = Math.min(h, Math.ceil(by));
  for (let y = Math.max(0, Math.floor(ay)); y < yEnd; y++) {
    const start = y * w;
    const dy = Math.min(y + 1, by) - Math.max(y, ay);
    const xnext = x + dxdy * dy;
    const d = dy * dir;
    const lo = x < xnext ? x : xnext,
      hi = x < xnext ? xnext : x;
    const loFloor = Math.floor(lo),
      loI = loFloor;
    const hiCeil = Math.ceil(hi),
      hiI = hiCeil;
    if (hiI <= loI + 1) {
      const xmf = 0.5 * (x + xnext) - loFloor;
      a[start + loI] += d - d * xmf;
      a[start + loI + 1] += d * xmf;
    } else {
      const inv = 1 / (hi - lo);
      const lof = lo - loFloor;
      const a0 = 0.5 * inv * (1 - lof) * (1 - lof);
      const hif = hi - hiCeil + 1;
      const am = 0.5 * inv * hif * hif;
      a[start + loI] += d * a0;
      if (hiI === loI + 2) a[start + loI + 1] += d * (1 - a0 - am);
      else {
        const a1 = inv * (1.5 - lof);
        a[start + loI + 1] += d * (a1 - a0);
        for (let xi = loI + 2; xi < hiI - 1; xi++) a[start + xi] += d * inv;
        const a2 = a1 + (hiI - loI - 3) * inv;
        a[start + hiI - 1] += d * (1 - a2 - am);
      }
      a[start + hiI] += d * am;
    }
    x = xnext;
  }
}

/** Blend a colour through a mask, optionally offset (for stamping one mask many times). */
export function paint(c: Canvas, m: Mask, color: Rgb, opacity = 1, dx = 0, dy = 0) {
  const { width, height, data } = c;
  const [r, g, b] = color;
  for (let row = 0; row < m.height; row++) {
    const y = m.y + row + dy;
    if (y < 0 || y >= height) continue;
    for (let col = 0; col < m.width; col++) {
      const cov = m.alpha[row * m.width + col]!;
      if (cov <= 0.002) continue;
      const x = m.x + col + dx;
      if (x < 0 || x >= width) continue;
      const a = cov * opacity;
      const i = (y * width + x) * 4;
      data[i] = data[i]! + (r - data[i]!) * a;
      data[i + 1] = data[i + 1]! + (g - data[i + 1]!) * a;
      data[i + 2] = data[i + 2]! + (b - data[i + 2]!) * a;
    }
  }
}

export function fill(c: Canvas, path: Path, color: Rgb, opacity = 1) {
  const m = mask(path, c.width, c.height);
  if (m) paint(c, m, color, opacity);
}

/** Axis-aligned rectangle without anti-aliasing (grid lines, bars). */
export function rect(c: Canvas, x: number, y: number, w: number, h: number, color: Rgb, opacity = 1) {
  const x0 = Math.max(0, Math.round(x)),
    y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w)),
    y1 = Math.min(c.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * c.width + xx) * 4;
      c.data[i] = c.data[i]! + (color[0] - c.data[i]!) * opacity;
      c.data[i + 1] = c.data[i + 1]! + (color[1] - c.data[i + 1]!) * opacity;
      c.data[i + 2] = c.data[i + 2]! + (color[2] - c.data[i + 2]!) * opacity;
    }
}

/** Soft radial spot: alpha falls off smoothly from the centre to `r`. */
export function glow(c: Canvas, cx: number, cy: number, r: number, color: Rgb, opacity: number) {
  const x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(c.width, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(c.height, Math.ceil(cy + r));
  const r2 = r * r;
  const [cr, cg, cb] = color;
  for (let y = y0; y < y1; y++) {
    const dy2 = (y - cy) * (y - cy);
    if (dy2 >= r2) continue;
    let i = (y * c.width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      const d = ((x - cx) * (x - cx) + dy2) / r2;
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * opacity;
      c.data[i] = c.data[i]! + (cr - c.data[i]!) * a;
      c.data[i + 1] = c.data[i + 1]! + (cg - c.data[i + 1]!) * a;
      c.data[i + 2] = c.data[i + 2]! + (cb - c.data[i + 2]!) * a;
    }
  }
}

/** Straight (non-premultiplied) RGBA bitmap, e.g. a logo. */
export type Bitmap = { width: number; height: number; data: Uint8Array };

/**
 * Draw a bitmap scaled into a box with area averaging (sharp, not jagged,
 * when shrinking). `tint` recolours every pixel while keeping its alpha.
 */
export function drawImage(
  c: Canvas,
  img: Bitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  tint?: Rgb,
) {
  dx = Math.round(dx);
  dy = Math.round(dy);
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const sx = img.width / dw,
    sy = img.height / dh;
  for (let y = 0; y < dh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= c.height) continue;
    const syStart = y * sy,
      syEnd = syStart + sy;
    for (let x = 0; x < dw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= c.width) continue;
      const sxStart = x * sx,
        sxEnd = sxStart + sx;
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        area = 0;
      for (let yy = Math.floor(syStart); yy < Math.min(img.height, Math.ceil(syEnd)); yy++) {
        const wy = Math.min(yy + 1, syEnd) - Math.max(yy, syStart);
        for (let xx = Math.floor(sxStart); xx < Math.min(img.width, Math.ceil(sxEnd)); xx++) {
          const w = (Math.min(xx + 1, sxEnd) - Math.max(xx, sxStart)) * wy;
          const i = (yy * img.width + xx) * 4;
          const alpha = (img.data[i + 3]! / 255) * w;
          r += img.data[i]! * alpha;
          g += img.data[i + 1]! * alpha;
          b += img.data[i + 2]! * alpha;
          a += alpha;
          area += w;
        }
      }
      if (a <= 0 || area <= 0) continue;
      const cover = a / area;
      const o = (ty * c.width + tx) * 4;
      const pr = tint ? tint[0] : r / a,
        pg = tint ? tint[1] : g / a,
        pb = tint ? tint[2] : b / a;
      c.data[o] = c.data[o]! + (pr - c.data[o]!) * cover;
      c.data[o + 1] = c.data[o + 1]! + (pg - c.data[o + 1]!) * cover;
      c.data[o + 2] = c.data[o + 2]! + (pb - c.data[o + 2]!) * cover;
    }
  }
}
