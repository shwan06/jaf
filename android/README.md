# Android app

A native Android app that ships the whole Russian course **inside the APK** and
runs with no network at all.

The web app in `../static/` is the single source of truth: a Gradle task copies
it into the app's assets on every build, so the phone app and the website can
never drift apart. Edit the course once, both update.

## Why it isn't just a WebView pointing at the website

Two things would break if it were:

**Audio would be silent.** Android's WebView does not implement the Web Speech
API — `speechSynthesis` and `SpeechRecognition` are `undefined` there
([chromium 487255](https://issues.chromium.org/issues/40417848)), even though
both work in Chrome for Android. Tapping a word to hear it, the 🔊 test button,
the Pronunciation trainer and the AI Tutor mic would all silently do nothing.
So `MainActivity` injects a `RussianNative` object, and
`../static/js/android-bridge.js` polyfills the web APIs on top of it using
Android's own `TextToSpeech` and `SpeechRecognizer`. On the normal website that
shim does nothing and the real browser APIs are used.

**Google Play would likely reject it.** Play's Minimum Functionality policy
explicitly targets apps that "simply load a website URL". Bundling the course
and serving it through `WebViewAssetLoader` makes it a real offline app.

## Get a test APK (no computer needed)

1. On GitHub open **Actions** → **Build Android app** → **Run workflow**.
2. When it finishes, download the **`russian-az-debug-apk`** artifact.
3. Unzip and tap the `.apk` on your phone. You'll need to allow **"Install
   unknown apps"** for your browser or file manager the first time.

Worth testing in **airplane mode** — the whole course should work offline.

## Signing for Google Play

Play needs a signed **AAB**, not an APK. Create an upload key once and keep it
safe: lose it and you cannot update your own app.

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias upload
```

### Build the AAB in CI (recommended — no computer needed)

Add four repository secrets under **Settings → Secrets and variables →
Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` (the whole file, one line) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

Re-run the workflow and download the **`russian-az-release-aab`** artifact —
that's the file you upload to Play. Without those secrets the AAB still builds
but is unsigned, and Play will reject it.

### Or build locally

Create `android/keystore.properties` (git-ignored):

```properties
storeFile=release.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

```bash
cd android
gradle wrapper --gradle-version 8.11.1   # first time only
./gradlew bundleRelease
# AAB at: app/build/outputs/bundle/release/app-release.aab
```

## Publishing checklist

Things only you can do, roughly in order:

- [ ] Play Console developer account (**$25**, one time).
- [ ] Create the upload keystore and add the secrets above.
- [ ] **Closed test: 12 testers, opted in for 14 continuous days.** Required for
      personal accounts created after 13 Nov 2023, per app, before you can apply
      for production access. Start this early — it's the long pole, not the code.
- [ ] Host a **privacy policy** and link it in the listing. It must cover: the
      AI Tutor sends your typed messages to whichever LLM provider you chose;
      the API key is stored only on your device and never sent anywhere else;
      the microphone is used for pronunciation practice and voice input.
- [ ] Fill the **Data safety** form to match that policy.
- [ ] Store listing: screenshots, feature graphic, description.

## Requirements this build already meets

- **`targetSdk 36`** — required for new submissions from 31 Aug 2026.
- **`minifyEnabled true`** (R8) — keeps the DEX small for Google Play's
  February 2027 code-optimization threshold.
- Works fully offline, so it isn't a "website in a box".
- Google Play's **April 2027 Zero-Tap Sign-In** requirement does **not** apply:
  it covers apps with user sign-in, and this app has no accounts. Progress lives
  in the WebView's `localStorage`, which Android Auto Backup covers, so it
  should survive a move to a new phone — worth testing before release.

## Structure

```
android/
├── settings.gradle / build.gradle / gradle.properties
└── app/
    ├── build.gradle                  # SDK 36, R8, signing, syncWebApp task
    ├── proguard-rules.pro            # keeps @JavascriptInterface methods
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/shwan/russian/
        │   ├── MainActivity.kt       # WebViewAssetLoader, permissions, navigation
        │   └── SpeechBridge.kt       # native TTS + speech recognition
        └── res/                      # app name, theme, launcher icons
```

The course itself is **not** duplicated here — `app/build.gradle`'s `syncWebApp`
task copies `../static` into the assets at build time.
