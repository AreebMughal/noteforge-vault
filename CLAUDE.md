# NoteForge Vault — handoff for Claude Code

@AGENTS.md

This project was built in a claude.ai chat and continued here. This file is the
context from that chat: what the app is, the contracts it must keep, what was
decided and why, what's verified, and what's next. Keep it up to date.

## What this is

Android app (Expo SDK 57, React Native 0.86, Expo Router, TypeScript) that is a
second client for the password vault in the **NoteForge** web app (Next.js,
`/vault`). Same Supabase project, same `.kdbx` file, so a password saved on the
phone shows on the web and opens in KeePassXC, and vice versa.

Hard constraints from the owner:
- **Zero cost.** No paid services. Distribution is a signed APK on GitHub
  Releases (built by GitHub Actions). Google Play ($25 one-time) and iOS
  ($99/yr) are deferred. Flag anything that isn't free before adding it.
- **No backend changes.** The mobile app is only a client of the existing schema.

## Contracts — do not break

- Table `public.vaults`: one row per user — `owner_id uuid pk`, `name`, `data`
  (base64 of the whole .kdbx, `octet_length(data) <= 8 MiB`), `byte_size`,
  `version int` (bumped every write), timestamps. RLS `owner_id = auth.uid()`.
- Writes are optimistic: `update … where owner_id = ? and version = ?`, set
  `version = v + 1`. Zero rows ⇒ someone else wrote ⇒ fetch, decrypt,
  `local.merge(remote)`, retry (max 4). Implemented in `src/core/sync.ts`.
- New vaults: **KDBX 4, AES-256, Argon2id 64 MiB / 4 passes / parallelism 2**
  (not kdbxweb's test defaults). `src/core/kdbx.ts`.
- Never rebuild entries from a view model. Edit kdbxweb entries in place so
  custom fields, attachments, TOTP, auto-type and history survive.
- Server never sees plaintext. No master-password reset exists; "forgot" =
  delete the row and start over (typed DELETE confirmation). Never offered
  for a OneDrive vault: the app must never delete someone's KeePass file.
- **Shared vault choice** (web ⇄ mobile, both directions): Supabase Auth
  `user_metadata.noteforge_vault` =
  `{v:1, source:'account'|'onedrive', onedrive?:{fileId, path, account?}, updatedAt}`.
  Written by whichever client *successfully unlocks* (or creates) a vault;
  read after sign-in via `auth.getUser()` (server, not the JWT). Mirror files:
  mobile `src/core/preference.ts` ⇄ web `lib/vault/preference.ts` — change both.
  No choice + existing account row ⇒ account; neither ⇒ ask.
- OneDrive mode = the web app's Graph flow: download via item metadata's
  `downloadUrl` (metadata first, so the cTag matches the bytes), write with
  `PUT …/content` + `If-Match: <cTag>`, 412 ⇒ merge + retry; >4 MB uses an
  upload session with a manual tag check. `src/core/onedrive.ts`. The sync
  engine's revision is an opaque string (Supabase version as text, or cTag).

## Architecture

```
src/core/     pure TS on kdbxweb, tested in Node — keep RN imports out of here
  kdbx.ts       format, KDF params, credentials (incl. from cached hash)
  entries.ts    list models (NO passwords), in-place edits, custom icons
  sync.ts       VaultSession: create/unlock/save/refresh, merge, offline cache
  selftest.ts   on-device known-answer test (fixture in selftest-fixture.ts)
  favicon.ts    user-initiated site icon fetch; ico.ts/png.ts convert ICO → PNG
  onedrive.ts   Graph client + VaultRemote for a KeePassXC file on OneDrive
  preference.ts shared vault choice (mirror of the web app's)
src/lib/      RN glue: supabase (+encrypted session storage), supabase-remote,
              google sign-in, cache (expo-file-system), biometric, clipboard, icons,
              argon2 wiring, settings
src/state/app.tsx   single provider: auth, session, auto-lock, saving
src/app/      screens (Expo Router, guarded with Stack.Protected)
src/ui/       theme ("tempered steel"), components, EntryIcon
modules/vault-native/  local Expo module (Kotlin): Argon2 via argon2kt (MIT),
              sensitive clipboard copy + native-timer clear
plugins/with-release-signing.js  injects release signing from CI env vars
.github/workflows/  ci.yml (typecheck+tests), release.yml (tag v* → signed APK)
```

## Decisions and why

- **Crypto:** Hermes has no WebAssembly, so no hash-wasm on device. Argon2 runs
  natively (argon2kt on Android; quick-crypto's OpenSSL Argon2 as fallback for
  future iOS). `react-native-quick-crypto` `install()` provides
  `global.crypto` (WebCrypto) and `Buffer`; Metro aliases `crypto` →
  quick-crypto because kdbxweb `require("crypto")`s at load.
- **Startup self-test** decrypts a reference .kdbx and checks an Argon2id
  known answer before any real vault is touched. If it fails the app refuses
  to open vaults. Regenerate the fixture only with Node + hash-wasm.
- **Fingerprint unlock** caches kdbxweb's SHA-256 password hash (not the
  password, not the Argon2 key — kdbxweb re-salts Argon2 on every save, so a
  cached Argon2 output breaks after the next write). Stored in SecureStore
  with `requireAuthentication`, expires after 1/7/30 days, cleared on sign-out.
  UI explains it is password-equivalent for this vault.
- **Offline:** cache = same ciphertext as Supabase, per user, app-private dir.
  Offline unlock is **read-only**; `refresh()` makes it writable again.
- **Entry icons:** displayed only from what is stored *inside* the .kdbx:
  custom icons (PNG/JPEG/GIF/WebP; others fall back to the initial) or the
  KeePass standard icon index (0–68, drawn with the nearest
  MaterialCommunityIcons glyph, `src/ui/standardIcons.ts`; index 0 = the
  coloured initial). The editor's "Change icon" offers: standard icons,
  icons already in the vault, a picture from the phone (expo-image-picker,
  square crop), or "Get icon from <host>". New images are shrunk to ≤96 px
  PNG (expo-image-manipulator) and added to `meta.customIcons` only on Save,
  deduplicated by bytes. The website fetch is **user-initiated, one entry at a
  time, straight to that site** (`src/core/favicon.ts`, same logic as the web
  app's `/api/vault/favicon`: `<link rel=icon>` then `/favicon.ico`; ICO is
  converted to PNG in TS). No automatic/bulk fetching and no third-party
  favicon service — that would leak the site list. The web endpoint isn't
  used: it needs a cookie session, and RN fetch has no CORS to work around.
- **OneDrive / KeePassXC:** Microsoft sign-in per device with
  expo-auth-session (auth code + PKCE, public client, same Azure app
  registration as the web, plus a "Mobile and desktop applications" redirect
  `msal<client id>://auth` — Azure's portal rejected `noteforgevault://auth`;
  app.config.ts adds the `msal…` scheme when the client id is set). Refresh token per NoteForge user in the encrypted
  session storage; dropped on sign-out / Disconnect. Tokens are never shared
  with the web (the web's MSAL cache is per tab, and SPA refresh tokens are
  origin-bound, 24 h). `src/app/+native-intent.tsx` keeps Expo Router from
  routing the `/auth` redirect. Cache and fingerprint unlock are per vault
  (`<owner>` or `<owner>-od-<fileId>`). OneDrive files can't be created or
  deleted from the app (KeePassXC owns them). Key files are not supported yet
  on mobile (the web supports them).
- **Google sign-in:** `@react-native-google-signin/google-signin` 16.x free
  API → ID token → `supabase.auth.signInWithIdToken({provider:'google'})`,
  same as the web app. `webClientId` = the web app's Web client ID. Button
  hidden unless `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is set. Uses Google's
  official button (brand rules). No Expo config plugin needed on Android.
- **Security UX:** auto-lock on inactivity incl. background time (option to
  lock on leaving the app), FLAG_SECURE via expo-screen-capture, passwords
  decrypted only on Show/Copy, clipboard marked sensitive and cleared after
  15 s by a native timer, `allowBackup: false`.
- **Merge limit:** KDBX 4 stores times in whole seconds; two changes to the
  same entry within one second can't be ordered (same in KeePassXC). Tests
  use >1 s gaps on purpose.
- Pinned to Expo SDK 57's versions: `react-dom@19.2.3`,
  `react-native-reanimated@4.5.1`, `react-native-worklets@0.10.1`. Always add
  packages with `npx expo install`.

## Status

Verified in the sandbox: 11/11 Node tests (`npm test`), `tsc` clean, Android
JS bundle exports, `expo prebuild` generates the native project with signing,
`allowBackup=false`, and the local module autolinked. Real KeePassXC 2.7.6
round trip succeeded (both directions).

2026-10-03, local Windows machine: debug Gradle build succeeds (x86_64,
`./gradlew app:assembleDebug -PreactNativeArchitectures=x86_64`; first build
~1.5 h, mostly quick-crypto's C++). On the `Pixel_6_API_33` emulator the
startup self-test passes and the sign-in screen renders. The very first launch
crashed once with a native SIGSEGV in Fabric
(`MountingCoordinator::pullTransaction`, JS thread); relaunch was fine and it
hasn't come back. Watch for it.

**Not yet verified:** the flows after sign-in (step 2 below), a release build,
and a physical device. Screenshots and `adb screencap` come out blank because
of FLAG_SECURE; use `adb shell uiautomator dump` to inspect the screen.

UI prototype (clickable, all screens):
https://claude.ai/artifact/7wX4YJTV1UoKmNhX5F8c5y — screens in code match it.

## Release setup (done 2026-09-30)

- Public repo https://github.com/AreebMughal/noteforge-vault, branch `main`.
- Actions secrets set (Supabase URL/anon key, keystore base64/passwords/alias);
  variables `APP_PACKAGE=com.noteforge.vault`, `GOOGLE_WEB_CLIENT_ID`.
- Release signing key lives OUTSIDE the repo in `D:/Projects/noteforge-vault-signing/`
  (`release.jks`, `CREDENTIALS.txt`). Release SHA-1:
  `E6:3A:66:25:E1:BA:EB:BE:72:E7:18:8E:C5:A4:4A:CD:46:3D:66:7C`.
- Each release also uploads `NoteForge-Vault.apk`, so
  https://github.com/AreebMughal/noteforge-vault/releases/latest/download/NoteForge-Vault.apk
  is the permanent download link.
- Blocked: the owner's GitHub account was locked for a billing issue, so no Actions job
  has run yet. After it's unlocked: run "Release APK" manually (workflow_dispatch) to
  prove the Gradle build, then `git tag v1.0.0 && git push origin v1.0.0`.

## Next steps

1. Build locally: `npm install`, create `.env` from `.env.example`,
   `npx expo run:android` (Expo Go will NOT work — native modules). Fix any
   Gradle/Kotlin errors, especially in `modules/vault-native`.
2. On device: self-test passes → sign in → create vault → web app shows it →
   conflict test (edit on web and phone) → export .kdbx opens in KeePassXC →
   offline read-only → fingerprint unlock → Google sign-in.
3. Release: README steps (keystore, GitHub secrets/variables, `git tag v1.0.0`).
4. OneDrive mode is built (2026-10-03) but not yet tried against real
   Microsoft: needs `EXPO_PUBLIC_AZURE_CLIENT_ID` and the mobile redirect URI
   in Azure. Then test: web picks OneDrive → phone opens same file; phone
   picks first → web skips chooser; KeePassXC edit → 412 merge.
5. Later / not started: key files on mobile, iOS, Android
   Autofill service, optional favicon download, Play Store (closed-test rule:
   12 testers for 14 days for new personal accounts — recheck).

## Open items for the owner

- Azure: the web app's client id/tenant into `.env` (`EXPO_PUBLIC_AZURE_*`)
  and a GitHub Actions variable for release builds; tick redirect URI
  `msal<client id>://auth` under Authentication → Mobile and desktop.
- Package id (placeholder `com.noteforge.vault`, set via `APP_PACKAGE`) —
  fixed forever after first release.
- Supabase URL + anon key (same as the web app's `.env.local`).
- Google Cloud: Android OAuth client with package id + SHA-1 of `release.jks`
  (and one for the debug keystore when testing locally — `android/app/debug.keystore`
  from prebuild, not `~/.android`). No `release.jks` created yet.

## Commands

```sh
npm test            # core engine tests (Node, hash-wasm stands in for native Argon2)
npm run typecheck
npx expo run:android
npx expo prebuild --platform android --clean   # android/ is generated; never hand-edit
```
