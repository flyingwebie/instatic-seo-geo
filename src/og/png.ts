import { zlibSync } from "fflate";
import type { Canvas } from "./raster";

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** Level used for social images; keeps every preset under 250 KB. */
export const PNG_LEVEL = 6;
/**
 * About twice as fast to encode and up to half as large again. Used once a
 * render has run out of time, so a slow server still gets its images.
 */
export const PNG_FAST_LEVEL = 1;

/**
 * Opaque RGB PNG. The "Up" filter makes flat and gradient areas compress well.
 * Encoding is the slowest part of a social image in the sandbox, so the filter
 * reads the canvas directly instead of copying each row twice.
 */
export function encodePng(
  c: Canvas,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = PNG_LEVEL,
): Uint8Array {
  const { width, height, data } = c;
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    let src = y * width * 4;
    let out = y * (stride + 1);
    raw[out++] = 2;
    if (y === 0)
      for (let x = 0; x < width; x++, src += 4) {
        raw[out++] = data[src]!;
        raw[out++] = data[src + 1]!;
        raw[out++] = data[src + 2]!;
      }
    else
      for (let x = 0, up = src - width * 4; x < width; x++, src += 4, up += 4) {
        raw[out++] = (data[src]! - data[up]!) & 0xff;
        raw[out++] = (data[src + 1]! - data[up + 1]!) & 0xff;
        raw[out++] = (data[src + 2]! - data[up + 2]!) & 0xff;
      }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
