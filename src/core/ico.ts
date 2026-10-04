/**
 * ICO → PNG. Most /favicon.ico files hold one or more small bitmaps (BMP
 * without a file header, or PNG since Vista). Picks the largest image and
 * returns PNG bytes, or null if the file isn't a readable ICO.
 */
import { encodePng } from './png';

export function isIco(bytes: Uint8Array) {
  return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || bytes[2] === 2) && bytes[3] === 0;
}

export function icoToPng(bytes: Uint8Array): Uint8Array | null {
  if (!isIco(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  let best: { w: number; bpp: number; size: number; offset: number } | null = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > bytes.length) break;
    const w = bytes[at] || 256;
    const bpp = view.getUint16(at + 6, true);
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (offset + size > bytes.length || size < 8) continue;
    if (!best || w > best.w || (w === best.w && bpp > best.bpp)) best = { w, bpp, size, offset };
  }
  if (!best) return null;
  const img = bytes.subarray(best.offset, best.offset + best.size);
  if (img[0] === 0x89 && img[1] === 0x50 && img[2] === 0x4e && img[3] === 0x47) return img.slice();
  try {
    return bmpToPng(img);
  } catch {
    return null;
  }
}

function bmpToPng(img: Uint8Array): Uint8Array | null {
  const v = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const headerSize = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const height = Math.abs(v.getInt32(8, true)) / 2; // ICO stores XOR + AND mask heights together
  const bpp = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const clrUsed = v.getUint32(32, true);
  if (width <= 0 || width > 256 || height <= 0 || height > 256) return null;
  if (![1, 4, 8, 24, 32].includes(bpp) || (compression !== 0 && !(compression === 3 && bpp === 32))) return null;

  let at = headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const palette: number[][] = [];
  if (bpp <= 8) {
    const n = clrUsed || 1 << bpp;
    for (let i = 0; i < n; i++, at += 4) palette.push([img[at + 2], img[at + 1], img[at]]);
  }
  const xorStride = ((width * bpp + 31) >>> 5) * 4;
  const andStride = ((width + 31) >>> 5) * 4;
  const xorStart = at;
  const andStart = xorStart + xorStride * height;
  if (andStart > img.length) return null;
  const hasMask = andStart + andStride * height <= img.length;

  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = xorStart + (height - 1 - y) * xorStride; // bottom-up
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp === 32 || bpp === 24) {
        const p = row + x * (bpp / 8);
        rgba[o] = img[p + 2]; rgba[o + 1] = img[p + 1]; rgba[o + 2] = img[p];
        rgba[o + 3] = bpp === 32 ? img[p + 3] : 255;
        if (bpp === 32 && img[p + 3]) anyAlpha = true;
      } else {
        const bit = x * bpp;
        const idx = (img[row + (bit >>> 3)] >>> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = palette[idx] ?? [0, 0, 0];
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  }
  // Without real alpha the 1-bit AND mask says which pixels are transparent.
  if (hasMask && !(bpp === 32 && anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const row = andStart + (height - 1 - y) * andStride;
      for (let x = 0; x < width; x++) {
        const transparent = (img[row + (x >>> 3)] >>> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  } else if (bpp === 32 && !anyAlpha) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }
  return encodePng(width, height, rgba);
}
