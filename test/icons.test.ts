/**
 * PNG encoder, ICO conversion and favicon discovery. The network is a fake
 * fetcher, so these run offline.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzlibSync } from 'fflate';
import { encodePng } from '../src/core/png';
import { icoToPng } from '../src/core/ico';
import { fetchFavicon, findIconLinks, normalizeSiteUrl, FaviconError, type Fetcher } from '../src/core/favicon';

/** Decodes the unfiltered RGBA PNGs our encoder writes. */
function readPng(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = v.getUint32(16), height = v.getUint32(20);
  let at = 8, idat: Uint8Array | null = null;
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat = png.subarray(at + 8, at + 8 + len);
    at += 12 + len;
  }
  const raw = unzlibSync(idat!);
  const rgba: number[] = [];
  for (let y = 0; y < height; y++) rgba.push(...raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)));
  return { width, height, rgba };
}

function ico(entries: { w: number; bpp: number; data: Uint8Array }[]) {
  const header = 6 + entries.length * 16;
  const total = header + entries.reduce((n, e) => n + e.data.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let off = header;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    out[at] = e.w; out[at + 1] = e.w;
    v.setUint16(at + 4, 1, true);
    v.setUint16(at + 6, e.bpp, true);
    v.setUint32(at + 8, e.data.length, true);
    v.setUint32(at + 12, off, true);
    out.set(e.data, off);
    off += e.data.length;
  });
  return out;
}

/** 2×2 BMP for an ICO: rows bottom-up, BGRA, plus a 1-bit AND mask. */
function bmp2x2(bpp: 24 | 32, pixelsTopDown: number[][], maskTopDown: number[]) {
  const xorStride = ((2 * bpp + 31) >>> 5) * 4, andStride = 4;
  const out = new Uint8Array(40 + xorStride * 2 + andStride * 2);
  const v = new DataView(out.buffer);
  v.setUint32(0, 40, true); v.setInt32(4, 2, true); v.setInt32(8, 4, true);
  v.setUint16(12, 1, true); v.setUint16(14, bpp, true);
  for (let y = 0; y < 2; y++) {
    const row = 40 + (1 - y) * xorStride;
    for (let x = 0; x < 2; x++) {
      const [r, g, b, a] = pixelsTopDown[y * 2 + x];
      const p = row + x * (bpp / 8);
      out[p] = b; out[p + 1] = g; out[p + 2] = r;
      if (bpp === 32) out[p + 3] = a;
    }
    out[40 + xorStride * 2 + (1 - y) * andStride] = maskTopDown[y] << 6; // two mask bits per row
  }
  return out;
}

test('PNG encoder output decodes to the same pixels', () => {
  const px = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4, 5, 6]);
  const img = readPng(encodePng(3, 1, px.subarray(0, 12)));
  assert.deepEqual(img, { width: 3, height: 1, rgba: [...px.subarray(0, 12)] });
  assert.throws(() => encodePng(2, 2, px));
});

test('ICO: 32-bit alpha, 24-bit with AND mask, embedded PNG, garbage', () => {
  const rgba = [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 0], [9, 9, 9, 255]];
  const a = readPng(icoToPng(ico([{ w: 2, bpp: 32, data: bmp2x2(32, rgba, [0, 0]) }]))!);
  assert.deepEqual(a.rgba, rgba.flat());

  // 24-bit: mask bit 1 = transparent. Row 0 mask 0b01 → second pixel transparent.
  const b = readPng(icoToPng(ico([{ w: 2, bpp: 24, data: bmp2x2(24, rgba, [0b01, 0b00]) }]))!);
  assert.deepEqual(b.rgba, [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 9, 9, 9, 255]);

  // Largest image wins; PNG-in-ICO is passed through untouched.
  const embedded = encodePng(1, 1, Uint8Array.from([1, 2, 3, 255]));
  const small = bmp2x2(32, rgba, [0, 0]);
  assert.deepEqual(icoToPng(ico([{ w: 2, bpp: 32, data: small }, { w: 0 /* 256 */, bpp: 32, data: embedded }])), embedded);

  assert.equal(icoToPng(Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 0, 0, 0])), null);
  assert.equal(icoToPng(Uint8Array.from([1, 2, 3])), null);
});

test('site URLs are normalised; non-web schemes are refused', () => {
  assert.equal(normalizeSiteUrl('github.com').href, 'https://github.com/');
  assert.equal(normalizeSiteUrl(' https://github.com/login ').href, 'https://github.com/login');
  assert.equal(normalizeSiteUrl('localhost:3000/x').href, 'https://localhost:3000/x');
  assert.equal(normalizeSiteUrl('http://example.org').protocol, 'http:');
  assert.throws(() => normalizeSiteUrl('javascript:alert(1)'), FaviconError);
  assert.throws(() => normalizeSiteUrl('ftp://x.org'), FaviconError);
  assert.throws(() => normalizeSiteUrl(''), FaviconError);
});

test('declared icons are found, resolved and ranked; SVG and mask icons skipped', () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/a.css">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="mask-icon" href="/mask.png">
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link href='/favicon-32.png' rel='icon' sizes='32x32'>
    <LINK REL="shortcut icon" HREF="icons/plain.ico">
    <link rel="apple-touch-icon" href="https://cdn.example.net/touch.png?a=1&amp;b=2">
    <link rel="icon" href="/big.png" sizes="192x192">
  </head>`;
  assert.deepEqual(findIconLinks(html, 'https://example.com/login/page'), [
    'https://cdn.example.net/touch.png?a=1&b=2', // 180 px, nearest 96 and up
    'https://example.com/big.png',               // 192 px
    'https://example.com/favicon-32.png',
    'https://example.com/favicon-16.png',
    'https://example.com/login/icons/plain.ico', // no size, relative to the page
  ]);
  assert.deepEqual(findIconLinks('<base href="https://static.example.com/x/"><link rel=icon href=f.png>', 'https://example.com/'),
    ['https://static.example.com/x/f.png']);
});

function fakeFetcher(routes: Record<string, { status?: number; type?: string; body: string | Uint8Array; url?: string }>): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    const res = new Response(r.body as BodyInit, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html' } });
    if (r.url) Object.defineProperty(res, 'url', { value: r.url });
    return res;
  };
  return { fetcher, calls };
}

test('fetchFavicon: declared icon, falls through broken ones, then /favicon.ico', async () => {
  const png = encodePng(1, 1, Uint8Array.from([1, 2, 3, 255]));
  {
    // Redirected page; first declared icon is missing, second isn't an image, third works.
    const html = '<link rel=icon sizes=192x192 href=/a.png><link rel=icon sizes=128x128 href=/b.png><link rel=icon href=/c.png>';
    const { fetcher: f2 } = fakeFetcher({
      'https://example.com/': { body: html, url: 'https://www.example.com/home' },
      'https://www.example.com/b.png': { body: '<html>oops', type: 'image/png' },
      'https://www.example.com/c.png': { body: png, type: 'image/png' },
    });
    const got = await fetchFavicon('example.com', f2);
    assert.equal(got.source, 'https://www.example.com/c.png');
    assert.deepEqual(got.bytes, png);
  }
  {
    // No declared icons: /favicon.ico (an ICO) is converted to PNG.
    const icoBytes = ico([{ w: 2, bpp: 32, data: bmp2x2(32, [[1, 1, 1, 255], [2, 2, 2, 255], [3, 3, 3, 255], [4, 4, 4, 255]], [0, 0]) }]);
    const { fetcher, calls } = fakeFetcher({
      'https://plain.org/': { body: '<title>hi</title>' },
      'https://plain.org/favicon.ico': { body: icoBytes, type: 'image/x-icon' },
    });
    const got = await fetchFavicon('plain.org', fetcher);
    assert.equal(got.mime, 'image/png');
    assert.equal(readPng(got.bytes).width, 2);
    assert.deepEqual(calls, ['https://plain.org/', 'https://plain.org/favicon.ico']);
  }
  {
    // Inline data: icon.
    const b64 = Buffer.from(png).toString('base64');
    const { fetcher } = fakeFetcher({ 'https://inline.io/': { body: `<link rel="icon" href="data:image/png;base64,${b64}">` } });
    assert.deepEqual((await fetchFavicon('inline.io', fetcher)).bytes, png);
  }
  {
    // Oversized icon is rejected, nothing else → error that names the site.
    const { fetcher } = fakeFetcher({
      'https://huge.net/': { body: '<link rel=icon href=/big.png>' },
      'https://huge.net/big.png': { body: new Uint8Array(600 * 1024).fill(0x89), type: 'image/png' },
    });
    await assert.rejects(fetchFavicon('huge.net', fetcher), (e) => e instanceof FaviconError && /huge\.net doesn’t offer/.test(e.message));
  }
  {
    const down: Fetcher = async () => { throw new TypeError('Network request failed'); };
    await assert.rejects(fetchFavicon('down.example', down), (e) => e instanceof FaviconError && /Couldn’t reach down\.example/.test(e.message));
  }
});
