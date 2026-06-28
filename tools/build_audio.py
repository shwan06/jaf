#!/usr/bin/env python3
"""
build_audio.py — recording manifest + audio generator for "Русский от А до Я".

What it does
------------
1. Extracts every spoken Russian string from static/content/*.json.
2. Writes a recording manifest CSV (tools/audio_manifest.csv) — one row per
   unique string with a stable id (hash), category, recommended voice source
   (ai | human), and the exact target filename the app will look for.
3. (optional) Synthesizes the AI rows with Google Cloud TTS / Azure / ElevenLabs
   into static/audio/<hash>.mp3 and writes static/audio/index.json.

The app (static/js/app.js) computes the SAME hash for each Russian string at
runtime and plays static/audio/<hash>.mp3 if it appears in index.json, falling
back to the browser's Russian text-to-speech otherwise. So: drop the generated
files into static/audio/, run with --reindex, commit — and real audio plays
everywhere, with zero per-item edits.

Recommended workflow (matches the brief)
-----------------------------------------
  # 1. Get the manifest (no credentials needed) — hand the 'human' rows to actors
  python3 tools/build_audio.py --manifest-only

  # 2. Bulk-generate the AI rows (vocabulary, examples, listening) with your key
  GOOGLE_TTS_KEY=xxxx python3 tools/build_audio.py --provider google
  #   or: AZURE_TTS_KEY=xxx AZURE_TTS_REGION=eastus python3 tools/build_audio.py --provider azure
  #   or: ELEVEN_API_KEY=xxx python3 tools/build_audio.py --provider elevenlabs --voice <voice_id>

  # 3. Record the 'human' dialogue rows, save each as static/audio/<hash>.mp3,
  #    then refresh the index so the app picks them up:
  python3 tools/build_audio.py --reindex

Requires `requests` only for synthesis ( pip install requests ). Manifest/reindex
need no third-party packages.
"""
import argparse, csv, json, os, sys, unicodedata, glob, base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "static", "content")
AUDIO_DIR = os.path.join(ROOT, "static", "audio")
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio_manifest.csv")


def audio_hash(s):
    """Double FNV-1a (64-bit hex). MUST match audioHash() in static/js/app.js."""
    s = unicodedata.normalize("NFC", s).strip()
    M, P = 0xFFFFFFFF, 0x01000193
    h = 0x811c9dc5
    for ch in s:
        h = ((h ^ ord(ch)) * P) & M
    g = (0x811c9dc5 ^ (len(s) & M)) & M
    for ch in reversed(s):
        g = ((g ^ ord(ch)) * P) & M
    return format(h, "08x") + format(g, "08x")


def load(name):
    with open(os.path.join(CONTENT, name), encoding="utf-8") as f:
        return json.load(f)


def extract():
    """Return ordered list of {ru, category, source, gloss}. Deduped by hash."""
    rows, seen = [], set()

    def add(ru, category, source, gloss=""):
        ru = (ru or "").strip()
        if not ru:
            return
        h = audio_hash(ru)
        if h in seen:
            return
        seen.add(h)
        rows.append({"hash": h, "ru": ru, "category": category, "source": source, "gloss": gloss})

    # Vocabulary (AI)
    try:
        for d in load("vocabulary.json").get("decks", []):
            for c in d.get("cards", []):
                add(c.get("ru"), "vocabulary", "ai", c.get("en", ""))
    except FileNotFoundError:
        pass

    # Examples / dialogues / letters from the lesson sections
    for sec in ["alphabet", "grammar", "academic", "conversations"]:
        try:
            data = load(sec + ".json")
        except FileNotFoundError:
            continue
        for u in data.get("units", []):
            for b in u.get("blocks", []):
                t = b.get("type")
                if t == "examples":
                    for it in b.get("items", []):
                        add(it.get("ru"), "example", "ai", it.get("en", ""))
                elif t == "dialogue":
                    for l in b.get("lines", []):
                        add(l.get("ru"), "dialogue", "human", l.get("en", ""))
                elif t == "letters":
                    for L in b.get("items", []):
                        # letter name + example word
                        add((L.get("letter") or "").split(" ")[0], "alphabet", "ai", L.get("name", ""))
                        ex = (L.get("example") or "").split("—")[0].strip()
                        add(ex, "alphabet", "ai", L.get("name", ""))

    # Listening (AI)
    try:
        for l in load("listening.json").get("lessons", []):
            for it in l.get("items", []):
                add(it.get("ru"), "listening", "ai", it.get("en", ""))
    except FileNotFoundError:
        pass

    # Cases full sentences (AI) — the app speaks prompt with the answer filled in
    try:
        for d in load("cases.json").get("drills", []):
            sent = (d.get("prompt") or "").replace("___", d.get("answer", ""))
            add(sent, "example", "ai", d.get("en", ""))
    except FileNotFoundError:
        pass

    return rows


def write_manifest(rows):
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "category", "source", "file", "ru", "gloss"])
        for r in rows:
            w.writerow([r["hash"], r["category"], r["source"], "audio/%s.mp3" % r["hash"], r["ru"], r["gloss"]])
    return MANIFEST


def reindex():
    """Rebuild static/audio/index.json from the .mp3 files present on disk."""
    os.makedirs(AUDIO_DIR, exist_ok=True)
    idx = {}
    for p in glob.glob(os.path.join(AUDIO_DIR, "*.mp3")):
        h = os.path.splitext(os.path.basename(p))[0]
        idx[h] = "audio/%s.mp3" % h
    with open(os.path.join(AUDIO_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=0)
    return len(idx)


# ---- synthesis backends (each returns mp3 bytes) ----
def tts_google(text, voice, key):
    import requests
    r = requests.post(
        "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + key,
        json={
            "input": {"text": text},
            "voice": {"languageCode": "ru-RU", "name": voice or "ru-RU-Wavenet-D"},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.95},
        }, timeout=30)
    r.raise_for_status()
    return base64.b64decode(r.json()["audioContent"])


def tts_azure(text, voice, key, region):
    import requests
    voice = voice or "ru-RU-SvetlanaNeural"
    ssml = ("<speak version='1.0' xml:lang='ru-RU'><voice xml:lang='ru-RU' name='%s'>%s</voice></speak>"
            % (voice, text.replace("&", "&amp;").replace("<", "&lt;")))
    r = requests.post(
        "https://%s.tts.speech.microsoft.com/cognitiveservices/v1" % region,
        data=ssml.encode("utf-8"),
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3"}, timeout=30)
    r.raise_for_status()
    return r.content


def tts_eleven(text, voice, key):
    import requests
    r = requests.post(
        "https://api.elevenlabs.io/v1/text-to-speech/" + voice,
        json={"text": text, "model_id": "eleven_multilingual_v2"},
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"}, timeout=60)
    r.raise_for_status()
    return r.content


def main():
    ap = argparse.ArgumentParser(description="Recording manifest + audio generator")
    ap.add_argument("--provider", choices=["google", "azure", "elevenlabs"], help="TTS backend for AI rows")
    ap.add_argument("--voice", help="voice name/id (provider-specific)")
    ap.add_argument("--include-dialogues", action="store_true", help="also synthesize 'human' dialogue rows with the AI voice")
    ap.add_argument("--manifest-only", action="store_true", help="only write the CSV manifest, no synthesis")
    ap.add_argument("--reindex", action="store_true", help="rebuild audio/index.json from files on disk, no synthesis")
    ap.add_argument("--limit", type=int, default=0, help="cap number synthesized (for a test run)")
    args = ap.parse_args()

    rows = extract()
    write_manifest(rows)
    by_src = {}
    for r in rows:
        by_src[r["source"]] = by_src.get(r["source"], 0) + 1
    print("Manifest: %s" % MANIFEST)
    print("  %d unique strings  (%s)" % (len(rows), ", ".join("%s=%d" % kv for kv in sorted(by_src.items()))))

    if args.reindex:
        n = reindex()
        print("Reindexed: static/audio/index.json (%d files)" % n)
        return
    if args.manifest_only or not args.provider:
        if not args.provider:
            print("\n(no --provider given — wrote manifest only. Add --provider google|azure|elevenlabs to synthesize.)")
        n = reindex()
        print("Index refreshed (%d files present)." % n)
        return

    key = os.environ.get({"google": "GOOGLE_TTS_KEY", "azure": "AZURE_TTS_KEY", "elevenlabs": "ELEVEN_API_KEY"}[args.provider])
    if not key:
        sys.exit("Missing API key env var for provider '%s'." % args.provider)
    region = os.environ.get("AZURE_TTS_REGION", "eastus")

    os.makedirs(AUDIO_DIR, exist_ok=True)
    targets = [r for r in rows if r["source"] == "ai" or args.include_dialogues]
    made = skipped = failed = 0
    for r in targets:
        if args.limit and made >= args.limit:
            break
        out = os.path.join(AUDIO_DIR, r["hash"] + ".mp3")
        if os.path.exists(out):
            skipped += 1
            continue
        try:
            if args.provider == "google":
                data = tts_google(r["ru"], args.voice, key)
            elif args.provider == "azure":
                data = tts_azure(r["ru"], args.voice, key, region)
            else:
                data = tts_eleven(r["ru"], args.voice, key)
            with open(out, "wb") as f:
                f.write(data)
            made += 1
            if made % 25 == 0:
                print("  ...%d generated" % made)
        except Exception as e:
            failed += 1
            print("  FAILED %s (%s): %s" % (r["hash"], r["ru"][:30], e))
    n = reindex()
    print("Done: %d generated, %d already existed, %d failed. index.json now lists %d files." % (made, skipped, failed, n))


if __name__ == "__main__":
    main()
