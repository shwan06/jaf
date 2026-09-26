package com.shwan.russian

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.content.Intent
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import java.util.Locale

/**
 * Native speech for the WebView.
 *
 * Android's WebView does not implement the Web Speech API (chromium 487255):
 * `speechSynthesis` and `SpeechRecognition` are undefined inside it. Without
 * this bridge every audio control in the app would be silent and both mic
 * features would be dead. `static/js/android-bridge.js` polyfills the web APIs
 * on top of the `RussianNative` object exposed here, so the web app's own code
 * runs unchanged.
 *
 * All SpeechRecognizer calls must happen on the main thread; @JavascriptInterface
 * methods arrive on a WebView worker thread, so everything is posted to `main`.
 */
class SpeechBridge(
    private val context: Context,
    private val webView: WebView,
    private val onNeedsMicPermission: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pending: Pair<String, Float>? = null

    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    fun init() {
        tts = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val res = tts?.setLanguage(Locale("ru", "RU"))
                ttsReady = res != TextToSpeech.LANG_MISSING_DATA &&
                    res != TextToSpeech.LANG_NOT_SUPPORTED
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {}
                    @Deprecated("deprecated in API 21, still required by the abstract class")
                    override fun onError(utteranceId: String?) {}
                })
                pending?.let { (text, rate) -> pending = null; main.post { doSpeak(text, rate) } }
            }
        }
    }

    fun release() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        main.post { destroyRecognizer() }
    }

    /* ---------------- text to speech ---------------- */

    @JavascriptInterface
    fun speak(text: String, rate: Float) {
        main.post { doSpeak(text, rate) }
    }

    private fun doSpeak(text: String, rate: Float) {
        val engine = tts ?: return
        if (!ttsReady) {
            // Engine still initialising — remember the most recent request only.
            pending = text to rate
            return
        }
        if (text.isBlank()) return
        // The web app already passes a rate around 0.6–1.0; clamp defensively.
        engine.setSpeechRate(rate.coerceIn(0.1f, 2.0f))
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ru-utterance")
    }

    @JavascriptInterface
    fun cancelSpeech() {
        main.post { tts?.stop() }
    }

    /* ---------------- speech recognition ---------------- */

    @JavascriptInterface
    fun startRecognition(lang: String, interim: Boolean) {
        main.post { doStartRecognition(lang, interim, preferOffline = false) }
    }

    private fun doStartRecognition(lang: String, interim: Boolean, preferOffline: Boolean) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            emitError("service-not-allowed")
            return
        }
        if (!MainActivity.hasMicPermission(context)) {
            onNeedsMicPermission()
            emitError("not-allowed")
            return
        }
        destroyRecognizer()

        // For the offline retry, go straight to the on-device recogniser where
        // Android has one (API 31+); EXTRA_PREFER_OFFLINE on the default
        // recogniser is only a hint that some engines ignore.
        val rec = if (preferOffline && onDeviceRecognitionAvailable()) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }
        recognizer = rec
        listening = true

        rec.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                if (!interim) return
                val hits = partialResults
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    .orEmpty()
                if (hits.isNotEmpty()) emitResult(hits, false)
            }

            override fun onResults(results: Bundle?) {
                val hits = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    .orEmpty()
                if (hits.isNotEmpty()) emitResult(hits, true)
                finish()
            }

            override fun onError(error: Int) {
                // Android's default recogniser is cloud-backed, so it fails
                // with ERROR_NETWORK when the device is offline — which is
                // exactly how this app is meant to be usable. Retry once
                // preferring the on-device model, which works without a
                // connection if the user has the language pack installed.
                val networkFailure = error == SpeechRecognizer.ERROR_NETWORK ||
                    error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                if (networkFailure && !preferOffline) {
                    listening = false
                    destroyRecognizer()
                    // Give the destroyed recogniser a moment to release the
                    // service, or the retry can fail with ERROR_CLIENT / busy.
                    main.postDelayed(
                        { doStartRecognition(lang, interim, preferOffline = true) },
                        RETRY_DELAY_MS,
                    )
                    return
                }
                emitError(mapError(error))
                finish()
            }

            private fun finish() {
                listening = false
                emitEnd()
                destroyRecognizer()
            }
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim)
            if (preferOffline) {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
        }
        try {
            rec.startListening(intent)
        } catch (e: Exception) {
            listening = false
            emitError("audio-capture")
            emitEnd()
            destroyRecognizer()
        }
    }

    @JavascriptInterface
    fun stopRecognition() {
        main.post {
            if (listening) {
                try { recognizer?.stopListening() } catch (e: Exception) { /* already gone */ }
            }
        }
    }

    private fun destroyRecognizer() {
        try { recognizer?.destroy() } catch (e: Exception) { /* already gone */ }
        recognizer = null
    }

    /**
     * Maps SpeechRecognizer error codes onto Web Speech API error strings.
     *
     * The language codes matter most here: when the device is offline and the
     * Russian offline model has not been downloaded, the offline retry fails
     * with ERROR_LANGUAGE_UNAVAILABLE. Folding that into a generic "aborted"
     * hides the one thing the user can actually act on, so it gets its own
     * (non-standard) string that the page turns into real instructions.
     *
     * Unknown codes keep their number so an unexpected failure is diagnosable
     * from a screenshot rather than anonymous.
     */
    private fun mapError(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
        SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "network"
        SpeechRecognizer.ERROR_NO_MATCH -> "no-speech"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
        SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT -> "language-unavailable"
        SpeechRecognizer.ERROR_CLIENT -> "aborted"
        else -> "unknown-$code"
    }

    /**
     * Opens Android's voice-input settings, where the offline Russian model is
     * downloaded. Buried several levels deep in Settings, so the error message
     * offers a button rather than a list of directions to follow by hand.
     */
    @JavascriptInterface
    fun openVoiceInputSettings() {
        main.post {
            val targets = listOf(
                Intent("android.settings.VOICE_INPUT_SETTINGS"),
                Intent(android.provider.Settings.ACTION_INPUT_METHOD_SETTINGS),
                Intent(android.provider.Settings.ACTION_SETTINGS),
            )
            for (intent in targets) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    context.startActivity(intent)
                    return@post
                } catch (e: Exception) {
                    // try the next, broader target
                }
            }
        }
    }

    /* ---------------- offline model ---------------- */

    private fun onDeviceRecognitionAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    /** Whether [downloadOfflineModel] can do anything on this device (Android 13+). */
    @JavascriptInterface
    fun canDownloadOfflineModel(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && onDeviceRecognitionAvailable()

    /**
     * Asks Android to download the on-device recognition model for [lang], so
     * the mic keeps working with no connection. Needs internet at the time;
     * Android may show its own confirmation or progress notification, and the
     * download continues in the background.
     */
    @JavascriptInterface
    fun downloadOfflineModel(lang: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        main.post {
            if (!onDeviceRecognitionAvailable()) return@post
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            }
            var rec: SpeechRecognizer? = null
            try {
                rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                rec.triggerModelDownload(intent)
            } catch (e: Exception) {
                // No on-device service after all — the page offers Settings too.
            }
            // Destroying too soon can cancel the request before it reaches the
            // service, so hold on to the recogniser briefly.
            val toDestroy = rec
            main.postDelayed({
                try { toDestroy?.destroy() } catch (e: Exception) { /* already gone */ }
            }, MODEL_REQUEST_GRACE_MS)
        }
    }

    /* ---------------- JS callbacks ---------------- */

    private fun emitResult(alternatives: List<String>, isFinal: Boolean) {
        val json = JSONArray(alternatives).toString()
        // JSONArray.toString() is valid JS source for a string literal argument
        // once quoted; wrap it so the page parses it back with JSON.parse.
        val quoted = JSONArray().put(json).toString().let { it.substring(1, it.length - 1) }
        evalJs("window.__russianNativeSpeech && window.__russianNativeSpeech.onResult($quoted, $isFinal);")
    }

    private fun emitError(error: String) {
        val quoted = JSONArray().put(error).toString().let { it.substring(1, it.length - 1) }
        evalJs("window.__russianNativeSpeech && window.__russianNativeSpeech.onError($quoted);")
    }

    private fun emitEnd() {
        evalJs("window.__russianNativeSpeech && window.__russianNativeSpeech.onEnd();")
    }

    private fun evalJs(script: String) {
        main.post { webView.evaluateJavascript(script, null) }
    }

    private companion object {
        const val RETRY_DELAY_MS = 300L
        const val MODEL_REQUEST_GRACE_MS = 5_000L
    }
}
