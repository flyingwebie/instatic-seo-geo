import { Type, type Static } from "@sinclair/typebox";
import { unzlibSync, zlibSync } from "fflate";
import { fromBase64, toBase64 } from "./base64";
import type { Bitmap } from "./raster";
import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH } from "./template";

/**
 * A logo travels and is stored as zlib-compressed straight RGBA, base64
 * encoded. The browser decodes any image format (PNG, JPEG, WebP, SVG) and
 * sends pixels, so the sandbox never needs an image decoder.
 */
export const LogoUploadSchema = Type.Object(
  {
    name: Type.String({ maxLength: 200 }),
    width: Type.Integer({ minimum: 1, maximum: LOGO_MAX_WIDTH }),
    height: Type.Integer({ minimum: 1, maximum: LOGO_MAX_HEIGHT }),
    data: Type.String({ maxLength: 1_500_000 }),
  },
  { additionalProperties: false },
);
export type LogoUpload = Static<typeof LogoUploadSchema>;

export function encodeLogo(bitmap: Bitmap): string {
  return toBase64(zlibSync(bitmap.data, { level: 9 }));
}

export function decodeLogo(upload: Pick<LogoUpload, "width" | "height" | "data">): Bitmap {
  let data: Uint8Array;
  try {
    data = unzlibSync(fromBase64(upload.data));
  } catch {
    throw new Error("The logo data is damaged. Choose the logo again.");
  }
  if (data.length !== upload.width * upload.height * 4)
    throw new Error("The logo size does not match its pixels. Choose the logo again.");
  return { width: upload.width, height: upload.height, data };
}

/** Content hash that names the logo, so designs can reference it. */
export async function logoHash(upload: Pick<LogoUpload, "width" | "height" | "data">): Promise<string> {
  const bytes = new TextEncoder().encode(`${upload.width}x${upload.height}:${upload.data}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Remove fully transparent margins (and, optionally, a white background) so
 * the logo sits tight against the text it accompanies.
 */
export function prepareLogo(bitmap: Bitmap, removeWhite: boolean): Bitmap {
  const { width, height } = bitmap;
  const data = bitmap.data.slice();
  if (removeWhite)
    for (let i = 0; i < data.length; i += 4) {
      // Near-white becomes transparent with a soft edge to avoid halos.
      const lightest = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      if (lightest > 235) data[i + 3] = Math.round(data[i + 3]! * Math.max(0, (255 - lightest) / 20));
    }
  let top = height,
    left = width,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return { width, height, data };
  const w = right - left + 1,
    h = bottom - top + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    out.set(data.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}
