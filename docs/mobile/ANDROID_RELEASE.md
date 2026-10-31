# Android release signing and build

Application id: `ps.masari.mobile`. Closes gap G4 in `docs/deployment/DEPLOY_RUNBOOK.md`.

## How signing works

`apps/mobile/android/app/build.gradle.kts` reads release signing material from, in order:

1. `apps/mobile/android/key.properties` (git-ignored) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
2. Environment variables (for CI): `MASARI_KEYSTORE_FILE`, `MASARI_KEYSTORE_PASSWORD`, `MASARI_KEY_ALIAS`, `MASARI_KEY_PASSWORD`.

If neither is complete, packaging a release build (`assembleRelease`, `bundleRelease`, `flutter build apk|appbundle --release`) fails with "Release signing is not configured". Debug builds are unaffected.

The only bypass is `-PallowDebugSigning=true` (or the environment variable `MASARI_ALLOW_DEBUG_SIGNING=true`, which is how `flutter build` can receive it). It signs with the debug key and is used only by the CI job `ci-mobile.yml` so it can build and scan an APK without secrets. Never distribute such an APK.

Minify/shrink (R8) is deliberately left off. It has not been verified against the plugin set (flutter_secure_storage, google_sign_in, geolocator, file_picker and others) and a broken release would only show at runtime. Enable it only together with a device test of sign-in, secure storage, location and file upload, adding keep rules to `android/app/proguard-rules.pro` as needed.

Versions come from `pubspec.yaml` (`version: 1.0.0+1`, name `+` code). Override per build with `--build-name` and `--build-number`; the Flutter Gradle plugin feeds them to `versionName`/`versionCode`. Every Play upload needs a higher `versionCode`.

## Create the upload keystore (once, on a trusted machine)

```sh
keytool -genkeypair -v -storetype JKS -keystore <PATH>/masari-upload.jks \
  -alias <KEY_ALIAS> -keyalg RSA -keysize 2048 -validity 10000
```

keytool prompts for the store password, key password and certificate details. Choose strong unique passwords and store them in the owner's password manager. Show the fingerprint (to register with Google or Firebase):

```sh
keytool -list -v -keystore <PATH>/masari-upload.jks -alias <KEY_ALIAS>
```

Create `apps/mobile/android/key.properties` (never commit it):

```properties
storeFile=<ABSOLUTE_PATH>/masari-upload.jks
storePassword=<STORE_PASSWORD>
keyAlias=<KEY_ALIAS>
keyPassword=<KEY_PASSWORD>
```

Back-up warnings:

- Keep the keystore and passwords out of the repository, chat, tickets and CI logs. `.gitignore` covers `key.properties`, `*.jks` and `*.keystore`.
- Store at least two encrypted copies in separate places. Losing an app-signing key (without Play App Signing) means you can never update the app.
- Anyone holding the keystore and passwords can publish updates as you.

## Play App Signing (recommended)

Enrol the app in Play App Signing. Google keeps the real app-signing key; the key above is only the upload key, and if it is lost or leaked the owner can ask Google to reset it. Upload an `.aab`. Note that Google Sign-In clients for Android must use the SHA-1 of the Play app-signing certificate (and the upload key for sideloaded APKs).

## Build

The app appends `/api/v1` itself, so `API_BASE_URL` is the origin only (`https://masari.aynur.ps`), not `.../api/v1`. It must be HTTPS in staging and production.

Dart-defines the app reads:

| Define | Purpose |
| --- | --- |
| `APP_ENV` | `production` (also `staging`, development) |
| `API_BASE_URL` | API origin, required |
| `ENABLE_DEMO_FEATURES` | `false` for any real build |
| `GOOGLE_SERVER_CLIENT_ID` | Google Sign-In server (web) client id, optional |
| `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID` | web / iOS only, optional |
| `DEMO_*` | demo credentials; never set in release builds |

Play bundle:

```sh
cd apps/mobile
flutter build appbundle --release --build-number=<N> \
  --dart-define=APP_ENV=production \
  --dart-define=ENABLE_DEMO_FEATURES=false \
  --dart-define=API_BASE_URL=https://masari.aynur.ps \
  --dart-define=GOOGLE_SERVER_CLIENT_ID=<SERVER_CLIENT_ID>
```

Output: `build/app/outputs/bundle/release/app-release.aab`. Equivalent config file: `config/production.example.json` via `--dart-define-from-file`.

Tester APK (same flags with `flutter build apk --release`): `build/app/outputs/flutter-apk/app-release.apk`. Share it over a private channel, and on the phone allow "install unknown apps" for the app used to open it, or `adb install -r app-release.apk`. Verify the signature:

```sh
apksigner verify --print-certs app-release.apk   # must not say "Android Debug"
```

## CI

- `ci-mobile.yml` (PRs): builds with `MASARI_ALLOW_DEBUG_SIGNING=true` against a staging host and scans the APK. It needs no secrets and its output is not distributable.
- `release-android.yml` (manual `workflow_dispatch` only, not required for PRs): builds a signed AAB and uploads it as an artifact. The repository owner must first add the secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 masari-upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Until then it fails at the first step by design.

## Checklist

- [ ] Upload keystore generated, two encrypted backups made, passwords in a password manager
- [ ] `key.properties` created locally and `git status` shows it untracked/ignored
- [ ] Play App Signing enabled; Google client SHA-1s registered
- [ ] `--build-number` higher than the last upload
- [ ] `ENABLE_DEMO_FEATURES=false`, `APP_ENV=production`, HTTPS `API_BASE_URL`
- [ ] Build without key material fails with the signing message (sanity check)
- [ ] `apksigner verify --print-certs` shows the release certificate
- [ ] Install on a real device: Arabic UI, sign-in, API reachable
- [ ] Release APK/AAB scanned: `npm run security:artifacts -- --apk <path>`
