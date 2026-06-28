# Audio pipeline — native / AI recordings for "Русский от А до Я"

The app speaks every Russian word and sentence with the browser's built-in
Russian voice (text-to-speech) by default — it works offline and needs no files.
This pipeline lets you drop in **real recordings** (AI-generated or human) and have
them play **everywhere automatically**, with the TTS as a fallback for anything
not yet recorded.

## How it works

* Every spoken Russian string has a stable id: `audioHash(ru)` — a 64-bit hash
  computed identically in `static/js/app.js` (`audioHash`) and
  `tools/build_audio.py` (`audio_hash`).
* Recordings live at `static/audio/<id>.mp3` (same-origin, so the service worker
  caches them for offline use on first play).
* `static/audio/index.json` maps `{ "<id>": "audio/<id>.mp3" }` for the files that
  exist. The app loads it at boot; if a string's id is in the index it plays the
  file, otherwise it uses TTS. An empty index = pure TTS (the current state).

No per-item edits to the content JSON are ever needed — matching is by text.

## The manifest

`tools/audio_manifest.csv` lists **every** unique string (regenerate any time):

```
python3 tools/build_audio.py --manifest-only
```

Columns: `id, category, source, file, ru, gloss`.
`source` is the **recommended** voice source per the plan:

| source | categories | count | use |
|--------|------------|------:|-----|
| `ai`    | vocabulary, example, listening, alphabet | 612 | bulk — AI TTS |
| `human` | dialogue | 97 | hire native actors (natural intonation) |

(709 strings total at time of writing.)

## 1) Bulk-generate the AI rows

Files land in `static/audio/<id>.mp3` and `index.json` is rebuilt automatically.

```bash
# FREE — no API key, no signup (Google Translate TTS). Solid quality, fastest start:
pip install gTTS
python3 tools/build_audio.py --provider gtts

# Google Cloud TTS (REST API key) — premium neural voices
GOOGLE_TTS_KEY=xxxx python3 tools/build_audio.py --provider google --voice ru-RU-Wavenet-D

# Azure AI Speech
AZURE_TTS_KEY=xxxx AZURE_TTS_REGION=eastus \
  python3 tools/build_audio.py --provider azure --voice ru-RU-SvetlanaNeural

# ElevenLabs (multilingual v2 — pass a voice_id)
ELEVEN_API_KEY=xxxx python3 tools/build_audio.py --provider elevenlabs --voice <voice_id>
```

Tips:
* `--limit 20` does a small test batch first.
* Re-running skips files that already exist (resumable).
* `--include-dialogues` also voices the `human` rows with the AI voice (handy as a
  temporary placeholder before actors deliver).
* Only `requests` is needed: `pip install requests`.

## 2) Human dialogue rows

Filter the manifest to `source == human`, send those sentences to your voice
actor(s), and ask for **MP3** files named exactly `<id>.mp3` (the `id`/`file`
columns tell them the name). Drop them into `static/audio/`, then:

```bash
python3 tools/build_audio.py --reindex   # rebuild index.json from files present
```

## 3) Commit & deploy

```bash
git add static/audio tools/audio_manifest.csv
git commit -m "Add native audio recordings"
git push            # GitHub Pages redeploys; bump the service-worker CACHE if you want an instant refresh
```

That's it — the app now plays real audio for every recorded string and falls back
to TTS for the rest.
