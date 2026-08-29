/*
 * Android WebView speech bridge.
 *
 * Android's WebView does NOT implement the Web Speech API — `speechSynthesis`
 * and `SpeechRecognition` are simply undefined there (chromium bug 487255),
 * even though both work in Chrome for Android. That would silence every
 * "tap a word to hear it" control and kill the mic in the AI Tutor and the
 * Pronunciation trainer when the app runs inside the Play Store wrapper.
 *
 * The native wrapper (android/app/src/main/java/com/shwan/russian/) injects a
 * `RussianNative` object into the page. When it is present, this file
 * polyfills just enough of the Web Speech API on top of it that the rest of
 * app.js keeps working unchanged. On the normal web there is no
 * `RussianNative`, nothing is polyfilled, and the real browser APIs are used.
 *
 * Must be loaded BEFORE js/app.js.
 */
(function () {
  "use strict";

  var N = window.RussianNative;
  if (!N) return; // normal browser — leave the real APIs alone.

  /* ---------------- speechSynthesis ---------------- */

  // app.js constructs SpeechSynthesisUtterance and reads .voice/.lang/.rate.
  if (!window.SpeechSynthesisUtterance) {
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text == null ? "" : String(text);
      this.lang = "";
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.voice = null;
    };
  }

  if (!window.speechSynthesis) {
    window.speechSynthesis = {
      // getVoices() returning [] is honest here: the native engine picks the
      // Russian voice itself, so app.js's pickVoice() just leaves App.voice null.
      getVoices: function () { return []; },
      speak: function (utterance) {
        if (!utterance) return;
        try {
          N.speak(String(utterance.text || ""), Number(utterance.rate) || 1);
        } catch (e) { /* native side unavailable — stay silent rather than throw */ }
      },
      cancel: function () {
        try { N.cancelSpeech(); } catch (e) {}
      },
      pause: function () {},
      resume: function () {},
      onvoiceschanged: null,
      speaking: false,
      pending: false,
      paused: false,
    };
  }

  /* ---------------- SpeechRecognition ---------------- */

  // Only one recognition session can be live at a time (there is a single
  // native SpeechRecognizer), so the active instance is tracked here and the
  // native callbacks are routed to it.
  var active = null;

  function AndroidSpeechRecognition() {
    this.lang = "ru-RU";
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.continuous = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this.onstart = null;
    this._started = false;
  }

  AndroidSpeechRecognition.prototype.start = function () {
    if (this._started) throw new Error("recognition already started");
    // Starting a new session supersedes any previous one.
    if (active && active !== this) { try { active.stop(); } catch (e) {} }
    active = this;
    this._started = true;
    try {
      N.startRecognition(String(this.lang || "ru-RU"), !!this.interimResults);
      if (typeof this.onstart === "function") this.onstart({});
    } catch (e) {
      this._started = false;
      active = null;
      this._fireError("service-not-allowed");
    }
  };

  AndroidSpeechRecognition.prototype.stop = function () {
    if (!this._started) return;
    try { N.stopRecognition(); } catch (e) {}
  };

  AndroidSpeechRecognition.prototype.abort = function () { this.stop(); };

  AndroidSpeechRecognition.prototype._fireError = function (err) {
    if (typeof this.onerror === "function") this.onerror({ error: err });
    this._fireEnd();
  };

  AndroidSpeechRecognition.prototype._fireEnd = function () {
    if (!this._started) return;
    this._started = false;
    if (active === this) active = null;
    if (typeof this.onend === "function") this.onend({});
  };

  // Build the shape app.js actually reads:
  //   e.results.length, e.results[i][0].transcript   (AI Tutor)
  //   Array.from(e.results[0]) -> [{transcript}, …]  (Pronunciation trainer)
  function makeResults(alternatives, isFinal) {
    var alts = (alternatives || []).map(function (t) {
      return { transcript: String(t), confidence: 0 };
    });
    if (!alts.length) alts = [{ transcript: "", confidence: 0 }];

    // Array-like and iterable, so Array.from() yields the alternatives.
    var result = alts.slice();
    result.isFinal = !!isFinal;

    var results = [result];
    results.isFinal = !!isFinal;
    return results;
  }

  AndroidSpeechRecognition.prototype._fireResult = function (alternatives, isFinal) {
    if (typeof this.onresult === "function") {
      this.onresult({ results: makeResults(alternatives, isFinal), resultIndex: 0 });
    }
  };

  window.SpeechRecognition = AndroidSpeechRecognition;
  window.webkitSpeechRecognition = AndroidSpeechRecognition;

  // Callback surface invoked from Kotlin via evaluateJavascript().
  window.__russianNativeSpeech = {
    onResult: function (json, isFinal) {
      if (!active) return;
      var alts;
      try { alts = JSON.parse(json); } catch (e) { alts = [String(json || "")]; }
      active._fireResult(alts, isFinal);
    },
    onError: function (err) {
      if (active) active._fireError(String(err || "aborted"));
    },
    onEnd: function () {
      if (active) active._fireEnd();
    },
  };
})();
