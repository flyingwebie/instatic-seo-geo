/** Small base64 codec that works the same in the sandbox and the browser. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      (b === undefined ? "=" : ALPHABET[(n >> 6) & 63]!) +
      (c === undefined ? "=" : ALPHABET[n & 63]!);
  }
  return out;
}

const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function fromBase64(text: string): Uint8Array {
  const values: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const v = LOOKUP[text.charCodeAt(i)] ?? -1;
    if (v >= 0) values.push(v);
  }
  const out = new Uint8Array(Math.floor((values.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < values.length; i += 4) {
    const n =
      (values[i]! << 18) |
      ((values[i + 1] ?? 0) << 12) |
      ((values[i + 2] ?? 0) << 6) |
      (values[i + 3] ?? 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < values.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < values.length) out[o++] = n & 255;
  }
  return out;
}
