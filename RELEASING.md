# Building and releasing NoteForge Vault

Releases are built by GitHub Actions (free for public repos) and published as a
signed APK on GitHub Releases. Pushing a version tag is the whole release process.

**Permanent download link (always the newest release):**
https://github.com/AreebMughal/noteforge-vault/releases/latest/download/NoteForge-Vault.apk

---

## Release a new version (the normal case)

```sh
# 1. Make sure everything is committed and passes locally
npm run typecheck
npm test
git status                      # should be clean

# 2. Push your commits
git push origin main

# 3. Tag the release and push the tag. This starts the build.
git tag v1.0.1
git push origin v1.0.1
```

Tags must look like `v<major>.<minor>.<patch>` (`v1.0.1`). Pick a number higher
than the last one (`git tag` lists existing ones).

Then watch it (takes about 20 to 25 minutes):

```sh
gh run list -L 3                # find the run
gh run watch                    # follow it live (pick the "Release APK" run)
```

or open https://github.com/AreebMughal/noteforge-vault/actions

When it finishes, the release page has:

| File | What it is |
| --- | --- |
| `NoteForge-Vault.apk` | fixed name, what the permanent link serves |
| `NoteForge-Vault-1.0.1.apk` | the same build, versioned name |
| `NoteForge-Vault-1.0.1.apk.sha256` | checksums to verify the download |

Users install the new APK over the old one and keep their data. Android accepts
it as an update because the version code is the Actions run number, and every
build is signed with the same key.

### What the workflow does (`.github/workflows/release.yml`)

1. Checks the required secrets exist.
2. `npm ci`, typecheck, tests. A failure stops the release.
3. `expo prebuild` generates the native Android project.
4. `./gradlew assembleRelease` builds the APK (arm64 and armeabi-v7a).
5. Signs it with your release key, then verifies it is **not** debug-signed.
6. Uploads the APK and checksums to the GitHub Release.

## Test a build without publishing

Actions, then **Release APK**, then **Run workflow** (or `gh workflow run release.yml`).
Without a tag it builds and signs the APK but doesn't create a release. The APK is
attached to the run as an artifact called `apk`. Use this to check a risky change first.

## Fix a bad release

```sh
gh release delete v1.0.1 --yes --cleanup-tag   # removes the release and the tag
git tag -d v1.0.1                              # removes the local tag
# fix the problem, commit, push, then tag again (same or next number)
```

If users already installed the bad build, release a **higher** version instead.
Android will not install an older build over a newer one.

---

## Configuration (already set up)

Repo settings, Settings, Secrets and variables, Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | secret | web app's Supabase URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | secret | web app's anon key |
| `ANDROID_KEYSTORE_BASE64` | secret | `release.jks` as base64 |
| `ANDROID_KEYSTORE_PASSWORD` | secret | keystore password |
| `ANDROID_KEY_PASSWORD` | secret | key password (same as above for PKCS12) |
| `ANDROID_KEY_ALIAS` | secret | `noteforge` |
| `APP_PACKAGE` | variable | `com.noteforge.vault` (never change after release) |
| `GOOGLE_WEB_CLIENT_ID` | variable | web app's Google **Web** client ID |
| `AZURE_CLIENT_ID` / `AZURE_TENANT` | variable | OneDrive mode, same Azure app as the web |

List them: `gh secret list` and `gh variable list`. Change one:
`gh variable set NAME -b "value"` or `gh secret set NAME`.

### The signing key (critical)

- Lives outside the repo: `D:\Projects\noteforge-vault-signing\release.jks`, with the
  passwords in `CREDENTIALS.txt` next to it.
- **Back it up.** If it's lost, no update can ever install over existing installs.
- Release SHA-1 (the one on the Google Android OAuth client):
  `E6:3A:66:25:E1:BA:EB:BE:72:E7:18:8E:C5:A4:4A:CD:46:3D:66:7C`
- Print it any time:
  `keytool -list -v -keystore release.jks -alias noteforge`

---

## Build on your own machine

```sh
npm install
cp .env.example .env            # fill in the Supabase values (and Google/Azure ids)

# Debug build on a connected phone or emulator (Expo Go will NOT work)
npx expo run:android
```

A local debug build is signed with the debug key, so Google sign-in needs the
**debug** SHA-1 registered on an Android OAuth client (see README).

To build the same signed release APK as CI, locally:

```sh
npx expo prebuild --platform android --clean
export NF_UPLOAD_STORE_FILE=/d/Projects/noteforge-vault-signing/release.jks
export NF_UPLOAD_STORE_PASSWORD='<from CREDENTIALS.txt>'
export NF_UPLOAD_KEY_ALIAS=noteforge
export NF_UPLOAD_KEY_PASSWORD='<from CREDENTIALS.txt>'
cd android && ./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

The first local build is very slow (about 1.5 hours, mostly C++ for quick-crypto).
`android/` is generated and gitignored. Never edit it by hand.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Workflow fails instantly, "account is locked" | GitHub billing issue on the account |
| "Missing secret ..." | add it (table above) and re-run the workflow |
| "APK is debug-signed" | the keystore secrets are missing or wrong |
| Phone: "App not installed" over an old build | the old build was signed with a different key, or the new version is older. Uninstall, then install. |
| Google sign-in "isn't set up for this build" | package name or SHA-1 on the Android OAuth client doesn't match the installed APK |
| Typecheck or tests fail in CI | run `npm run typecheck && npm test` locally and fix before tagging |
