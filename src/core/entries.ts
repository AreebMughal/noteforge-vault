/**
 * Entry/group view models and in-place edits. The list model deliberately has
 * no password field: passwords are read from the in-memory database only when
 * the user reveals or copies one (reveal-on-demand).
 */
import * as kdbxweb from 'kdbxweb';

export interface EntrySummary {
  id: string;
  title: string;
  username: string;
  url: string;
  /** Whether a password is set (never the password itself). */
  hasPassword: boolean;
  groupId: string;
  groupName: string;
  icon: number;
  /** Id of a custom icon stored in the vault (e.g. a favicon KeePassXC downloaded), if any. */
  customIconId: string | null;
  modified: number;
}
export interface GroupSummary {
  id: string;
  name: string;
  depth: number;
  entryCount: number;
}
export interface EntryFields {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

export function fieldText(entry: kdbxweb.KdbxEntry, name: string): string {
  const v = entry.fields.get(name);
  if (v === undefined) return '';
  return v instanceof kdbxweb.ProtectedValue ? v.getText() : String(v);
}

function hasPassword(entry: kdbxweb.KdbxEntry) {
  const v = entry.fields.get('Password');
  if (v === undefined) return false;
  return v instanceof kdbxweb.ProtectedValue ? v.byteLength > 0 : v !== '';
}

function recycleBinId(db: kdbxweb.Kdbx) {
  return db.meta.recycleBinEnabled && db.meta.recycleBinUuid ? db.meta.recycleBinUuid.id : null;
}
function isInRecycleBin(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup | undefined) {
  const bin = recycleBinId(db);
  for (let g = group; g; g = g.parentGroup) if (bin && g.uuid.id === bin) return true;
  return false;
}

export function listGroups(db: kdbxweb.Kdbx): GroupSummary[] {
  const out: GroupSummary[] = [];
  const bin = recycleBinId(db);
  const walk = (g: kdbxweb.KdbxGroup, depth: number) => {
    if (bin && g.uuid.id === bin) return;
    out.push({ id: g.uuid.id, name: g.name ?? '', depth, entryCount: g.entries.length });
    g.groups.forEach((c) => walk(c, depth + 1));
  };
  walk(db.getDefaultGroup(), 0);
  return out;
}

export function listEntries(db: kdbxweb.Kdbx): EntrySummary[] {
  const out: EntrySummary[] = [];
  for (const g of db.getDefaultGroup().allGroups()) {
    if (isInRecycleBin(db, g)) continue;
    for (const e of g.entries) {
      out.push({
        id: e.uuid.id,
        title: fieldText(e, 'Title'),
        username: fieldText(e, 'UserName'),
        url: fieldText(e, 'URL'),
        hasPassword: hasPassword(e),
        groupId: g.uuid.id,
        groupName: g.name ?? '',
        icon: e.icon ?? 0,
        customIconId: e.customIcon && db.meta.customIcons.has(e.customIcon.id) ? e.customIcon.id : null,
        modified: e.times.lastModTime?.getTime() ?? 0,
      });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function findEntry(db: kdbxweb.Kdbx, id: string): kdbxweb.KdbxEntry | undefined {
  for (const g of db.getDefaultGroup().allGroups()) for (const e of g.entries) if (e.uuid.id === id) return e;
  return undefined;
}
export function findGroup(db: kdbxweb.Kdbx, id: string): kdbxweb.KdbxGroup | undefined {
  for (const g of db.getDefaultGroup().allGroups()) if (g.uuid.id === id) return g;
  return undefined;
}

/** Fields/attachments the mobile UI doesn't show but always preserves. */
export function hiddenExtras(entry: kdbxweb.KdbxEntry) {
  const std = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
  const custom = [...entry.fields.keys()].filter((k) => !std.has(k));
  return {
    customFields: custom,
    attachments: [...entry.binaries.keys()],
    hasTotp: custom.some((k) => /otp/i.test(k)),
  };
}

/**
 * An entry's icon: one of KeePass's 69 standard icons (by index, shared with
 * KeePassXC) or a custom image stored in the vault's meta. Index 0 ("key")
 * is the default; this app shows it as the coloured initial.
 */
export type IconChoice = { standard: number } | { customId: string };

export function iconChoiceOf(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): IconChoice {
  const custom = entryIconId(db, entry);
  return custom ? { customId: custom } : { standard: entry.icon ?? 0 };
}

function applyIcon(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry, icon: IconChoice) {
  if ('customId' in icon) {
    if (!db.meta.customIcons.has(icon.customId)) throw new Error('That icon is no longer in the vault');
    entry.customIcon = new kdbxweb.KdbxUuid(icon.customId);
  } else {
    entry.customIcon = undefined;
    entry.icon = icon.standard;
  }
}

/** Edit standard fields in place (history snapshot first). Only changed fields are written. */
export function updateEntry(entry: kdbxweb.KdbxEntry, next: Partial<EntryFields> & { icon?: IconChoice }, db?: kdbxweb.Kdbx) {
  const map: [keyof EntryFields, string][] = [
    ['title', 'Title'],
    ['username', 'UserName'],
    ['password', 'Password'],
    ['url', 'URL'],
    ['notes', 'Notes'],
  ];
  const changes = map.filter(([k, f]) => next[k] !== undefined && next[k] !== fieldText(entry, f));
  const icon = next.icon;
  const iconChanged = icon !== undefined && (
    'customId' in icon ? entry.customIcon?.id !== icon.customId : entry.customIcon !== undefined || (entry.icon ?? 0) !== icon.standard
  );
  if (iconChanged && !db) throw new Error('updateEntry needs the database to change an icon');
  if (!changes.length && !iconChanged) return false;
  entry.pushHistory();
  for (const [k, f] of changes) {
    const v = next[k]!;
    entry.fields.set(f, f === 'Password' ? kdbxweb.ProtectedValue.fromString(v) : v);
  }
  if (iconChanged) applyIcon(db!, entry, icon!);
  entry.times.update();
  return true;
}

export function createEntry(db: kdbxweb.Kdbx, groupId: string | null, fields: EntryFields, icon: IconChoice = { standard: 0 }) {
  const group = (groupId && findGroup(db, groupId)) || db.getDefaultGroup();
  const e = db.createEntry(group);
  e.fields.set('Title', fields.title);
  e.fields.set('UserName', fields.username);
  e.fields.set('Password', kdbxweb.ProtectedValue.fromString(fields.password));
  e.fields.set('URL', fields.url);
  e.fields.set('Notes', fields.notes);
  e.icon = 0;
  applyIcon(db, e, icon);
  e.times.update();
  return e;
}

/**
 * Stores an image as a vault custom icon and returns its id. Identical bytes
 * reuse the existing icon so picking the same favicon twice doesn't grow the
 * vault. Unused icons are dropped by kdbxweb's cleanup during merge.
 */
export function addCustomIcon(db: kdbxweb.Kdbx, bytes: Uint8Array): string {
  if (!iconMime(bytes)) throw new Error('Icons must be PNG, JPEG, GIF or WebP');
  for (const [id, icon] of db.meta.customIcons) {
    const have = new Uint8Array(icon.data);
    if (have.length === bytes.length && have.every((b, i) => b === bytes[i])) return id;
  }
  const id = kdbxweb.KdbxUuid.random().id;
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  db.meta.customIcons.set(id, { data, lastModified: new Date() });
  return id;
}

/** KeePass semantics: delete moves to the recycle bin (as KeePassXC does). */
export function deleteEntry(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry) {
  db.remove(entry);
}
export function moveEntry(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry, groupId: string) {
  const g = findGroup(db, groupId);
  if (g && g !== entry.parentGroup) db.move(entry, g);
}
export function createGroup(db: kdbxweb.Kdbx, parentId: string | null, name: string) {
  const parent = (parentId && findGroup(db, parentId)) || db.getDefaultGroup();
  return db.createGroup(parent, name);
}
export function renameGroup(group: kdbxweb.KdbxGroup, name: string) {
  group.name = name;
  group.times.update();
}
export function deleteGroup(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup) {
  if (group === db.getDefaultGroup()) throw new Error('The root group cannot be deleted');
  db.remove(group);
}

/** Password generator on the CSPRNG, rejection-sampled to avoid modulo bias. */
export function generatePassword(length = 20) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?';
  const limit = 256 - (256 % alphabet.length);
  const out: string[] = [];
  while (out.length < length) {
    for (const b of kdbxweb.CryptoEngine.random(length * 2)) {
      if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

/**
 * Custom icons are stored inside the .kdbx itself (KeePassXC's "Download
 * favicon" saves them there), so showing them needs no network request and
 * reveals nothing about which sites the vault holds.
 */
export function iconMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null; // ICO, SVG and anything else fall back to the initial
}

/** data: URIs for every displayable custom icon, keyed by icon id. Build once per revision. */
export function customIconUris(db: kdbxweb.Kdbx): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, icon] of db.meta.customIcons) {
    const bytes = new Uint8Array(icon.data);
    const mime = iconMime(bytes);
    if (mime) out.set(id, `data:${mime};base64,${kdbxweb.ByteUtils.bytesToBase64(bytes)}`);
  }
  return out;
}

export function entryIconId(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): string | null {
  return entry.customIcon && db.meta.customIcons.has(entry.customIcon.id) ? entry.customIcon.id : null;
}
