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

/** Edit standard fields in place (history snapshot first). Only changed fields are written. */
export function updateEntry(entry: kdbxweb.KdbxEntry, next: Partial<EntryFields> & { icon?: number }) {
  const map: [keyof EntryFields, string][] = [
    ['title', 'Title'],
    ['username', 'UserName'],
    ['password', 'Password'],
    ['url', 'URL'],
    ['notes', 'Notes'],
  ];
  const changes = map.filter(([k, f]) => next[k] !== undefined && next[k] !== fieldText(entry, f));
  const iconChanged = next.icon !== undefined && next.icon !== entry.icon;
  if (!changes.length && !iconChanged) return false;
  entry.pushHistory();
  for (const [k, f] of changes) {
    const v = next[k]!;
    entry.fields.set(f, f === 'Password' ? kdbxweb.ProtectedValue.fromString(v) : v);
  }
  if (iconChanged) entry.icon = next.icon;
  entry.times.update();
  return true;
}

export function createEntry(db: kdbxweb.Kdbx, groupId: string | null, fields: EntryFields, icon = 0) {
  const group = (groupId && findGroup(db, groupId)) || db.getDefaultGroup();
  const e = db.createEntry(group);
  e.fields.set('Title', fields.title);
  e.fields.set('UserName', fields.username);
  e.fields.set('Password', kdbxweb.ProtectedValue.fromString(fields.password));
  e.fields.set('URL', fields.url);
  e.fields.set('Notes', fields.notes);
  e.icon = icon;
  e.times.update();
  return e;
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
