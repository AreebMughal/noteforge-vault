/**
 * Fetches a site's icon straight from the site, only when the user asks for
 * it on one entry. Same two steps as the web app's /api/vault/favicon:
 * icons the page declares with <link rel="…icon…">, then /favicon.ico at the
 * origin. No third-party favicon service is involved, so the only party that
 * learns anything is the site itself (as if the user had opened it).
 *
 * React Native's fetch isn't subject to CORS, so no proxy is needed.
 */
import * as kdbxweb from 'kdbxweb';
import { iconMime } from './entries';
import { icoToPng, isIco } from './ico';

const TIMEOUT_MS = 6000;
const MAX_HTML_SCAN = 64 * 1024;
const MAX_ICON_BYTES = 512 * 1024;

export interface FetchedIcon {
  /** PNG, JPEG, GIF or WebP bytes (ICO is converted to PNG). */
  bytes: Uint8Array;
  mime: string;
  source: string;
}
export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export class FaviconError extends Error {}

/** `github.com` → `https://github.com/`. Only http(s). Throws FaviconError on anything else. */
export function normalizeSiteUrl(input: string): URL {
  const s = input.trim();
  if (!s) throw new FaviconError('Add the website address first.');
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s) ? s : `https://${s}`);
  } catch {
    throw new FaviconError('That website address doesn’t look valid.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FaviconError('Only http and https websites have icons to fetch.');
  if (!u.hostname) throw new FaviconError('That website address doesn’t look valid.');
  return u;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}
function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * Icon URLs a page declares, best first: raster icons nearest 96 px and up,
 * then smaller ones, then ones without sizes. SVG and mask icons are skipped
 * (can't be stored as a KeePass icon without a rasteriser).
 */
export function findIconLinks(html: string, pageUrl: string): string[] {
  const head = html.slice(0, MAX_HTML_SCAN);
  let base = pageUrl;
  const baseTag = /<base\b[^>]*>/i.exec(head);
  const baseHref = baseTag && attr(baseTag[0], 'href');
  if (baseHref) try { base = new URL(decodeEntities(baseHref), pageUrl).href; } catch { /* keep page URL */ }

  const found: { url: string; score: number }[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.some((r) => r === 'icon' || r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed')) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    let url: string;
    try { url = new URL(decodeEntities(href.trim()), base).href; } catch { continue; }
    if (type.includes('svg') || /\.svg(\?|#|$)/i.test(url) || /^data:image\/svg/i.test(url)) continue;
    const sizes = (attr(tag, 'sizes') ?? '').toLowerCase();
    const px = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => n > 0));
    const size = px || (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') ? 180 : 0);
    // Lower is better: 96–256 px first (closest to 96), then smaller sized icons, then unknown sizes.
    const score = size >= 96 ? size - 96 : size > 0 ? 1000 + (96 - size) : 2000;
    found.push({ url, score });
  }
  found.sort((a, b) => a.score - b.score);
  return [...new Set(found.map((f) => f.url))];
}

async function withTimeout<T>(fetcher: Fetcher, url: string, accept: string, read: (r: Response) => Promise<T>): Promise<{ res: Response; body: T }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: ctl.signal, headers: { Accept: accept } });
    return { res, body: await read(res) };
  } finally {
    clearTimeout(timer);
  }
}

/** Turns downloaded bytes into a storable raster, or null if they aren't one. */
export function toStorableIcon(bytes: Uint8Array): { bytes: Uint8Array; mime: string } | null {
  const mime = iconMime(bytes);
  if (mime) return { bytes, mime };
  if (isIco(bytes)) {
    const png = icoToPng(bytes);
    if (png) return { bytes: png, mime: 'image/png' };
  }
  return null;
}

async function fetchIcon(fetcher: Fetcher, url: string): Promise<FetchedIcon | null> {
  if (url.startsWith('data:')) {
    const m = /^data:[^;,]*;base64,(.*)$/i.exec(url);
    if (!m) return null;
    const icon = toStorableIcon(new Uint8Array(kdbxweb.ByteUtils.base64ToBytes(m[1])));
    return icon && icon.bytes.length <= MAX_ICON_BYTES ? { ...icon, source: 'the page' } : null;
  }
  if (!/^https?:/i.test(url)) return null;
  try {
    const { res, body } = await withTimeout(fetcher, url, 'image/*,*/*;q=0.5', async (r) => {
      const declared = Number(r.headers.get('content-length') || 0);
      if (!r.ok || declared > MAX_ICON_BYTES) return null;
      return new Uint8Array(await r.arrayBuffer());
    });
    if (!res.ok || !body || body.length === 0 || body.length > MAX_ICON_BYTES) return null;
    const icon = toStorableIcon(body);
    return icon && { ...icon, source: url };
  } catch {
    return null;
  }
}

/** Declared icons first, then /favicon.ico. Throws FaviconError when nothing usable is found. */
export async function fetchFavicon(site: string, fetcher: Fetcher = fetch): Promise<FetchedIcon> {
  const start = normalizeSiteUrl(site);
  let pageUrl = start.href;
  let candidates: string[] = [];
  let reached = false;
  try {
    const { res, body } = await withTimeout(fetcher, start.href, 'text/html,*/*;q=0.5', (r) => r.text());
    reached = true;
    if (res.url) pageUrl = res.url;
    if ((res.headers.get('content-type') ?? 'text/html').includes('html')) candidates = findIconLinks(body, pageUrl);
  } catch {
    // Page unreachable or not HTML: still try /favicon.ico below.
  }
  const origins = [...new Set([new URL(pageUrl).origin, start.origin])];
  candidates.push(...origins.map((o) => `${o}/favicon.ico`));
  for (const url of [...new Set(candidates)]) {
    const icon = await fetchIcon(fetcher, url);
    if (icon) return icon;
  }
  throw new FaviconError(
    reached
      ? `${start.hostname} doesn’t offer an icon this app can use.`
      : `Couldn’t reach ${start.hostname}. Check the address and your connection.`,
  );
}
