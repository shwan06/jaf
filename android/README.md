# Android app (WebView wrapper)

A minimal native Android app that wraps the live web app
(**https://shwan06.github.io/jaf/**) in a full-screen WebView. Because the web
app is a PWA, it already caches itself for offline use — this wrapper just gives
you a real launcher icon and a standalone app window, and is the basis for a
Google Play release later.

## Get the APK (no computer needed)

1. On GitHub, open the **Actions** tab → **Build Android APK**.
2. Click **Run workflow** (or it runs automatically when files here change).
3. When the run finishes (a few minutes), open it and download the
   **`russian-az-debug-apk`** artifact (a `.zip` containing `app-debug.apk`).
4. On your phone, unzip and tap the `.apk` to install. You'll need to allow
   **"Install unknown apps"** for your browser/file manager the first time.

> This is a **debug** APK — installable directly, but not signed for the Play
> Store. Publishing to Google Play needs a one-time signing key and a Play
> Console account (separate step; ask and I'll wire up the release signing).

## Build locally (optional)

Requires Android Studio or the Android command-line SDK + JDK 17:

```bash
cd android
gradle wrapper --gradle-version 8.9   # first time only
./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk
```

## Structure

```
android/
├── settings.gradle / build.gradle / gradle.properties
└── app/
    ├── build.gradle
    └── src/main/
        ├── AndroidManifest.xml          # INTERNET permission, launcher activity
        ├── java/com/shwan/russian/MainActivity.kt   # the WebView
        └── res/                         # app name, theme, launcher icons
```

To point the app at a different URL, edit `APP_URL` in `MainActivity.kt`.
