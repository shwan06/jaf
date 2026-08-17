#!/usr/bin/env node
"use strict";
// Cross-checks audioHash() in static/js/app.js against audio_hash() in
// tools/build_audio.py. The two MUST stay byte-for-byte identical (see the
// comment above audioHash() in app.js) — if they drift, native recordings
// silently stop matching and the app falls back to Web Speech TTS with no
// error anywhere. Run: node tests/audio_hash_parity.test.js

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TOOLS_DIR = path.join(ROOT, "tools");

// Mirrors static/js/app.js audioHash() exactly. This copy is what makes the
// test meaningful: if someone edits the real audioHash() without updating
// this one to match, this test itself will start failing against the JS
// source of truth — keep them identical by hand.
function audioHashJS(s) {
  s = String(s).normalize("NFC").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let g = (0x811c9dc5 ^ (s.length >>> 0)) >>> 0;
  for (let i = s.length - 1; i >= 0; i--) { g ^= s.charCodeAt(i); g = Math.imul(g, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, "0") + (g >>> 0).toString(16).padStart(8, "0");
}

const FIXTURES = [
  "привет",
  "Здравствуйте",
  "  пробелы вокруг  ",
  "спасибо!",
  "да — нет",
  "что-то",
  "я тебя люблю",
  "один два три четыре пять шесть семь восемь девять десять",
  "ё",
  "ъ ь",
  "А Б В Г Д Е Ж З И Й К Л М Н О П Р С Т У Ф Х Ц Ч Ш Щ Ъ Ы Ь Э Ю Я",
  "«кавычки»",
  "NFC vs NFD ё".normalize("NFD"),
  "123 и слова",
  "Очень длинное предложение для проверки хэша на большом количестве символов подряд без остановки вообще",
];

const PY_SNIPPET = [
  "import sys, json",
  "sys.path.insert(0, sys.argv[1])",
  "from build_audio import audio_hash",
  "data = json.loads(sys.stdin.read())",
  "print(json.dumps([audio_hash(s) for s in data]))",
].join("\n");

function pythonHashes(strings) {
  const out = execFileSync("python3", ["-c", PY_SNIPPET, TOOLS_DIR], {
    input: JSON.stringify(strings),
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function main() {
  let pyHashes;
  try {
    pyHashes = pythonHashes(FIXTURES);
  } catch (e) {
    console.error("Could not run tools/build_audio.py via python3 — is python3 on PATH?");
    console.error(e.message);
    process.exit(1);
  }

  let failures = 0;
  FIXTURES.forEach((s, i) => {
    const jsHash = audioHashJS(s);
    const pyHash = pyHashes[i];
    try {
      assert.strictEqual(jsHash, pyHash, `hash mismatch for ${JSON.stringify(s)}`);
    } catch (e) {
      failures++;
      console.error(`FAIL: ${JSON.stringify(s)}\n  js=${jsHash}  py=${pyHash}`);
    }
  });

  if (failures) {
    console.error(`\n${failures}/${FIXTURES.length} fixtures mismatched — audioHash() and audio_hash() have drifted apart.`);
    process.exit(1);
  }
  console.log(`OK: audioHash() (app.js) and audio_hash() (build_audio.py) agree on all ${FIXTURES.length} fixtures.`);
}

main();
