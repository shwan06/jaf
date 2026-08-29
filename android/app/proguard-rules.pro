# R8 is enabled for release builds (minifyEnabled true) to keep the DEX small,
# which is what Google Play's February 2027 code-optimization threshold measures.

# The WebView calls SpeechBridge's methods by name from JavaScript, so R8 must
# not rename or strip anything annotated @JavascriptInterface. Without this the
# release build would silently lose all audio and microphone support while the
# debug build kept working.
-keepclassmembers class com.shwan.russian.SpeechBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
