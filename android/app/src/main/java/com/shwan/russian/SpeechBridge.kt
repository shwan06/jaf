package com.shwan.russian

import android.content.Context
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
        main.post { doStartRecognition(lang, interim) }
    }

    private fun doStartRecognition(lang: String, interim: Boolean) {
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

        val rec = SpeechRecognizer.createSpeechRecognizer(context)
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

    /** Maps SpeechRecognizer error codes onto Web Speech API error strings. */
    private fun mapError(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
        SpeechRecognizer.ERROR_NO_MATCH -> "no-speech"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_CLIENT -> "aborted"
        else -> "aborted"
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
}
