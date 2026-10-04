/**
 * Getting icon images onto an entry: from the phone's photo picker or from
 * the entry's website. Everything ends up as a small PNG so the vault stays
 * small and KeePassXC and the web app can show it.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as kdbxweb from 'kdbxweb';
import { fetchFavicon } from '../core/favicon';

/** Enough for a sharp 56 dp tile on high-density screens; a few KB per icon. */
const ICON_PX = 96;
const MAX_STORED_BYTES = 128 * 1024;

/** Resizes to at most ICON_PX on the long side and re-encodes as PNG. */
async function toSmallPng(uri: string): Promise<Uint8Array> {
  const ctx = ImageManipulator.manipulate(uri);
  let image = await ctx.renderAsync();
  try {
    if (image.width > ICON_PX || image.height > ICON_PX) {
      const resized = ImageManipulator.manipulate(uri)
        .resize(image.width >= image.height ? { width: ICON_PX } : { height: ICON_PX });
      image.release();
      image = await resized.renderAsync();
      resized.release();
    }
    const out = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!out.base64) throw new Error('The image couldn’t be converted.');
    const bytes = new Uint8Array(kdbxweb.ByteUtils.base64ToBytes(out.base64));
    if (bytes.length > MAX_STORED_BYTES) throw new Error('That image is too detailed to use as an icon.');
    return bytes;
  } finally {
    image.release();
    ctx.release();
  }
}

/** Opens the system photo picker with a square crop. Null if the user backs out. */
export async function pickIconFromDevice(): Promise<Uint8Array | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return toSmallPng(res.assets[0].uri);
}

/** Downloads the site's own icon (see core/favicon.ts) and shrinks it. */
export async function fetchIconForSite(url: string): Promise<Uint8Array> {
  const icon = await fetchFavicon(url);
  return toSmallPng(`data:${icon.mime};base64,${kdbxweb.ByteUtils.bytesToBase64(icon.bytes)}`);
}

export function pngDataUri(bytes: Uint8Array) {
  return `data:image/png;base64,${kdbxweb.ByteUtils.bytesToBase64(bytes)}`;
}
