# NoteForge Vault (Android)

A second client for the NoteForge web vault. Same Supabase `vaults` row, same
`.kdbx` format, so a password saved here shows up on the web and opens in
KeePassXC. No backend changes, no paid services.

**Download (Android):** [NoteForge-Vault.apk](https://github.com/AreebMughal/noteforge-vault/releases/latest/download/NoteForge-Vault.apk)
— always the newest release. [All releases](https://github.com/AreebMughal/noteforge-vault/releases)

## What's in this build

- Email/password or Google sign-in against the web app's Supabase project
- Account vault: unlock, add/edit/delete logins, groups, search
- Conflict-safe saves (`where version = ?`, then download → merge → retry)
- Offline: last-synced encrypted copy, read-only until you reconnect
- Auto-lock (leaving the app, 1/5/15/30 min), clipboard cleared after 15 s,
  passwords decrypted only when shown or copied, screenshots blocked
- Optional fingerprint unlock (expires after 1/7/30 days)
- Export `.kdbx` through the Android share sheet
- A crypto self-test at every launch; the vault stays closed if it fails
- Entry icons: the icon stored in the vault (e.g. a favicon KeePassXC downloaded),
  else a coloured initial. Nothing is fetched from the internet.

**Not in this build:** the OneDrive/KeePassXC live-sync mode,
iOS, Android autofill. Custom fields, attachments and TOTP secrets aren't
shown but are always preserved.

## One-time setup (all free)

1. **Create a GitHub repo** and push this folder. Public repos get unlimited
   Actions minutes; private get 2,000/month (a build takes roughly 15–25).
2. **Pick your package id** (e.g. `com.yourname.noteforgevault`). It can never
   change without users reinstalling. Set it as a repository *variable*
   `APP_PACKAGE` (Settings → Secrets and variables → Actions → Variables).
3. **Create a signing key** on your computer (needs Java; `keytool` ships with it):
   ```sh
   keytool -genkeypair -v -keystore release.jks -alias noteforge \
     -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 release.jks > release.jks.b64     # macOS: base64 -i release.jks
   ```
   **Back up `release.jks` and its passwords somewhere safe.** If you lose it,
   you can't ship updates — users would have to uninstall (losing nothing on
   the server, but it's a hassle).
4. **Add repository secrets:**

   | Secret | Value |
   | --- | --- |
   | `EXPO_PUBLIC_SUPABASE_URL` | web app's `NEXT_PUBLIC_SUPABASE_URL` |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | web app's `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | `ANDROID_KEYSTORE_BASE64` | contents of `release.jks.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | keystore password |
   | `ANDROID_KEY_ALIAS` | `noteforge` (or what you chose) |
   | `ANDROID_KEY_PASSWORD` | key password |

5. **Optional — Google sign-in** (free). Skip it and the Google button simply
   doesn't appear.
   1. Print your key's SHA-1: `keytool -list -v -keystore release.jks -alias noteforge`
   2. Google Cloud Console → the project the web app already uses → APIs &
      Services → Credentials → *Create credentials → OAuth client ID* →
      **Android**, with your package id and that SHA-1.
      (For local debug builds, add a second Android client with the debug
      key's SHA-1. Expo's generated project signs debug builds with
      `android/app/debug.keystore` (the standard React Native debug key, usually
      `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`); confirm after
      `npx expo prebuild`: `keytool -list -v -keystore android/app/debug.keystore -storepass android`.)
   3. Copy the existing **Web** client ID (the one the web app uses) into a
      repository *variable* `GOOGLE_WEB_CLIENT_ID`.
   4. Supabase → Authentication → Providers → Google: make sure that web
      client ID is listed (it should be already, for the web app).

   Error "isn't set up for this build" on the phone means the package id or
   SHA-1 in step 2 doesn't match the installed APK.

6. **Release:** `git tag v1.0.0 && git push --tags`. The *Release APK* workflow
   tests, builds, verifies the signature and attaches
   `NoteForge-Vault-1.0.0.apk` (plus a fixed-name `NoteForge-Vault.apk`) to a
   GitHub Release. Share the permanent link
   `https://github.com/<you>/<repo>/releases/latest/download/NoteForge-Vault.apk`;
   it always points at the newest release.

Updates: bump the tag (`v1.0.1`). The version code comes from the run number,
so Android accepts it as an update over the previous install.

## First run checklist (do this before trusting it with real passwords)

1. Install the APK. If it shows **"Encryption check failed"**, stop and report
   the message — nothing was touched.
2. Sign in with a *test* account (try Google too, if enabled), create a vault, add two logins.
3. Open the same account in the web app: both logins appear.
4. Add one on the web, pull to *Settings → Check for changes* on the phone.
5. Edit the same vault on web and phone without refreshing either; both
   changes must survive.
6. *Export .kdbx* → open it in KeePassXC with the master password.
7. Airplane mode → unlock still works, editing is refused.
8. In KeePassXC, download a favicon for one entry and save; after *Check for
   changes* the phone shows that icon instead of the initial.

## Local development

```sh
npm install
cp .env.example .env        # fill in the two Supabase values
npm test                    # vault engine tests (Node)
npm run typecheck
npx expo run:android        # needs Android Studio + a device/emulator
```
This app uses native code, so **Expo Go won't run it**; `expo run:android`
builds a development client instead.

## Layout

```
src/core/      vault engine — pure TS, tested in Node (test/core.test.ts)
  kdbx.ts        format, Argon2id 64 MiB/4/2, credentials
  entries.ts     list models (no passwords), in-place edits
  sync.ts        version-checked save, merge, offline cache logic
  selftest.ts    on-device known-answer test
src/lib/       Android glue: Supabase, Google sign-in, cache, fingerprint, clipboard, Argon2
src/state/     app state, auto-lock
src/app/       screens (Expo Router)
modules/vault-native/   Kotlin: Argon2 (argon2kt, MIT) + sensitive clipboard
plugins/       release signing for CI
```

## Security notes

- The master password never leaves the phone and is never stored.
- Fingerprint unlock stores kdbxweb's SHA-256 of the master password in the
  Android Keystore behind a biometric prompt. That's password-equivalent for
  this vault (not for other sites). It can't be the Argon2 output instead,
  because kdbxweb re-salts Argon2 on every save.
- `android:allowBackup` is off, so the cache, session and key aren't copied to
  cloud backups.
- Clipboard clearing is best effort: keyboards with clipboard history may
  keep their own copy.

## Moving to Google Play later

Costs a one-time $25. New personal developer accounts must also run a closed
test with at least 12 testers for 14 days before public release (check
Google's current rules). Build an AAB with `./gradlew bundleRelease`, and use
the same `release.jks` as your upload key so existing installs can update.
