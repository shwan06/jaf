# Русский от А до Я — Learn Russian from A to Z

A full-stack web app for learning Russian **from the alphabet to academic
writing**, built for serious adult learners (it was designed with a PhD
student in mind). It combines a structured A‑to‑Z reference with interactive,
spaced‑repetition practice.

![sections](https://img.shields.io/badge/sections-5-blue) ![cards](https://img.shields.io/badge/flashcards-200%2B-red)

## What's inside

| Section | What you get |
| --- | --- |
| 🔤 **Alphabet & Phonetics** | All 33 Cyrillic letters with IPA, sounds and examples; hard/soft vowels; stress & vowel reduction; consonant assimilation. |
| 📐 **Grammar A→Z** | The full case system (all 6 cases with declension tables), nouns, adjectives, pronouns, numerals, the verb aspect system, conjugation, tenses, participles & verbal adverbs. |
| 📇 **Vocabulary** | 200+ flashcards across 9 themed decks — survival core, everyday verbs, university & research, academic connectors, abstract concepts and more. |
| 💬 **Conversation** | 10 realistic dialogue scenarios with phrase banks: introductions, meeting your supervisor, seminars, conferences, everyday life. |
| 🎓 **Academic Russian** | Scholarly register (научный стиль): impersonal/passive constructions, discourse connectors, paper/thesis structure, citation language, reading strategies. |
| 🤖 **AI Tutor** | A live chat tutor for open-ended conversation practice, with voice input (mic) and spoken replies. Needs a free API key from one of ~9 supported providers (OpenRouter, Gemini, Groq, Cerebras, Mistral, NVIDIA NIM, DeepSeek, Qwen, YandexGPT) or paid Anthropic — see [AI Tutor setup](#ai-tutor-setup) below. |

### Study tools

- **🃏 Flashcards** — spaced repetition using the **SM‑2** algorithm. Rate each
  card *Again / Hard / Good / Easy* and the scheduler adapts review intervals.
- **🎯 Practice quiz** — multiple‑choice recall drills (Russian→English and
  English→Russian), filterable by deck.
- **🔊 Audio everywhere** — click any Russian word or sentence to hear it
  pronounced (uses your browser's built‑in Russian text‑to‑speech).
- **Progress tracking** — mark lessons complete; the dashboard shows lessons
  done, cards due and total reviews. State is saved in your browser
  (`localStorage`), so it persists per device with no account needed.

## How it works

The frontend is a **self-contained static site**: all lessons load from
`static/content/*.json`, and the spaced-repetition schedule and progress are
computed in the browser and stored in `localStorage`. That means it can be
hosted anywhere static (Vercel, GitHub Pages, Netlify) and works great on a
phone. The AI Tutor is the one feature that talks to the outside world — it
calls your chosen provider's API directly from the browser using a key you
enter yourself (see [AI Tutor setup](#ai-tutor-setup)).

The included Flask app (`app.py`) is **optional** and only for running the
site locally with a server. It keeps its own progress in a local SQLite file
(`progress.db`) with its own copy of the SM-2 scheduler — this is a **separate,
non-syncing** store from the browser `localStorage` progress that the live
deployed site actually uses. Progress made while running `python app.py`
locally will not show up on the phone/live version, and vice versa. If you're
not sure which one you want, just serve `static/` directly (see Quick start
below) — that's what the deployed site does too.

## AI Tutor setup

The AI Tutor (`#/tutor`) is a live chat tutor for open-ended conversation
practice, with mic input and spoken replies. It needs a free API key from one
of the supported providers — pick whichever is easiest to sign up for:

| Provider | Sign up | Notes |
| --- | --- | --- |
| OpenRouter | openrouter.ai | Free-tier models available; reliable in-browser. |
| Gemini | aistudio.google.com | Free tier; reliable in-browser (CORS-friendly). |
| Groq | console.groq.com | Free, very fast. |
| Cerebras | cloud.cerebras.ai | Free tier. |
| Mistral | console.mistral.ai | Free tier. |
| NVIDIA NIM | build.nvidia.com | Free credits. |
| DeepSeek / Qwen | platform.deepseek.com / dashscope | Paid, OpenAI-compatible. |
| YandexGPT | yandex.cloud → AI Studio | Excellent Russian; needs a key **and** a folder ID; may hit CORS on some networks. |
| Anthropic (Claude) | console.anthropic.com | Paid per message, high quality. |

Open the Tutor, pick a provider, paste the key. **The key is stored only in
your browser's `localStorage` and sent directly to that provider's API** —
this app has no backend and never sees or stores your key itself. Don't use
this feature on a shared/public computer, and note that the key stays on that
device only (it is deliberately excluded from the "Export my progress"
backup).

## Deploy (public URL)

The live site (https://shwan06.github.io/jaf/) deploys automatically via
**GitHub Actions → GitHub Pages**: every push to `master` runs
`.github/workflows/deploy-pages.yml`, which validates `static/content/*.json`
(see [Tests](#tests)), then uploads `static/` as the Pages artifact. Nothing
manual is normally needed.

**One-time setup** (already done for this repo, but needed again if Pages
ever gets disabled — e.g. after a long period of repo inactivity): go to
**Settings → Pages → Build and deployment → Source**, and set it to
**"GitHub Actions"**. Do this in a desktop or mobile *browser* — the GitHub
mobile app doesn't show this setting. If a deploy fails with `Get Pages site
failed … Not Found`, this setting has been turned off and needs to be
switched back to "GitHub Actions" manually; only the repo owner can do this
(the workflow's own token isn't allowed to).

Other static hosts also work, since this is a zero-build static site:

- **Vercel:** this repo ships a `vercel.json` (`outputDirectory: static`) —
  import at [vercel.com/new](https://vercel.com/new), or run `npx vercel`.
- **Netlify or any other static host:** publish the `static/` directory as
  the site root.

## Quick start (local)

```bash
# 1. (optional) create a virtual environment
python3 -m venv venv && source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. run
python app.py

# 4. open the app
#    http://127.0.0.1:5000
```

Your progress (completed lessons + flashcard schedule) is stored in your
browser. To reset it, clear the site's data / `localStorage`.

> You don't actually need Python at all — you can also just serve the static
> folder: `cd static && python3 -m http.server 8000` and open
> `http://127.0.0.1:8000`.

> **Tip:** for the best audio, use a browser/OS with a Russian voice installed
> (Chrome and Edge ship one; on Linux you may need to install a Russian speech
> voice). Click **🔊 Test audio** in the sidebar to check.

## Project structure

```
.
├── .github/workflows/
│   ├── deploy-pages.yml   # validate content + deploy static/ to GitHub Pages
│   └── android.yml
├── tools/
│   ├── build_audio.py     # generates static/audio/*.mp3 + index.json
│   └── validate_content.js
├── tests/
│   └── audio_hash_parity.test.js
├── vercel.json            # zero-build static deploy config
├── app.py                 # optional local Flask server (not required, separate progress store)
├── requirements.txt
└── static/                # the app — deploy this directory
    ├── index.html
    ├── manifest.webmanifest
    ├── service-worker.js  # offline cache (bump the version string on every app.js/css change)
    ├── icons/
    ├── css/style.css
    ├── js/app.js          # SPA + client-side SM-2 + localStorage + AI Tutor
    ├── audio/              # pre-generated Russian recordings (index.json + *.mp3)
    └── content/            # all learning content as JSON (editable)
        ├── alphabet.json
        ├── grammar.json
        ├── vocabulary.json     # flashcards — decks/cards, not units/blocks
        ├── conversations.json
        ├── academic.json
        ├── cases.json          # case drills — {cases, drills}
        ├── listening.json      # listening lessons — {lessons: [{items}]}
        ├── verbs.json          # verb conjugation trainer — flat {verbs: [...]}
        ├── exam.json           # level checkpoints — {levels: [{decks, verbs, mcq}]}
        └── path.json           # Learning Path — {units: [{nodes}]}, cross-references the files above
```

## Tests

There's no build step, so tests are plain Node scripts with no dependencies:

```bash
node tools/validate_content.js       # content JSON parses, no duplicate vocab cards,
                                      # path.json references all resolve
node tests/audio_hash_parity.test.js # app.js's audioHash() and build_audio.py's
                                      # audio_hash() must stay byte-for-byte identical —
                                      # this catches it if they ever drift
```

Both run automatically in CI (`.github/workflows/deploy-pages.yml`) before every
deploy, so a broken content file or a hash mismatch fails the build instead of
shipping.

## Adding or editing content

Most lessons live in `static/content/*.json` as **sections → units → blocks**,
so you can extend the course without touching code:

```jsonc
{
  "id": "grammar",
  "title": "Грамматика — Grammar",
  "units": [
    {
      "id": "genitive",
      "title": "4. The Genitive case",
      "summary": "Possession, absence, 'of', and numbers.",
      "blocks": [
        { "type": "prose", "html": "The genitive answers <strong>кого? чего?</strong>" },
        { "type": "table", "caption": "Endings", "headers": ["Gender", "Sing.", "Pl."],
          "rows": [["Masc.", "-а / -я", "-ов / -ей"]] },
        { "type": "examples", "items": [
          { "ru": "Это книга брата.", "tr": "Eto kniga brata.", "en": "This is the brother's book.", "ar": "هذا كتاب الأخ.", "ku": "ئەمە کتێبی برایە." }
        ] },
        { "type": "note", "html": "After 2, 3, 4 → genitive singular; after 5+ → genitive plural." }
      ]
    }
  ]
}
```

**Block types:** `prose`, `note`, `list` (`items`), `table`
(`headers`+`rows`), `examples` (`items` of `{ru, tr, en, ar, ku}`), `dialogue`
(`lines` of `{speaker, ru, tr, en, ar, ku}`), and `letters` (alphabet only).
The `ar` (Arabic) and `ku` (Central Kurdish/Sorani) fields are optional but
feed the gloss-language toggle (EN / ع / کو / All) in the sidebar — worth
filling in on any new content, since that's who this app is actually for.

**Flashcards** come from `static/content/vocabulary.json`, which uses `decks`
instead of `units`; each deck has `cards` of
`{ru, en, tr, ar, ku, pos, example, emoji, img}`. `emoji` is a quick visual
cue shown on the flashcard/word-of-the-day/vocab list; `img` is an optional
image path that takes priority over `emoji` if you ever want to drop in a
real photo for a card.

**The other five content files are each their own shape**, not
units/blocks or decks/cards — they power specific trainers rather than
reference lessons: `cases.json` (`{cases, drills}`, the case-drill screen),
`listening.json` (`{lessons: [{items}]}`), `verbs.json` (a flat
`{verbs: [...]}` list), `exam.json` (`{levels: [{decks, verbs, mcq}]}`,
the checkpoint quizzes), and `path.json` (`{units: [{nodes}]}`, the
Duolingo-style Learning Path — each node references an id in one of the
other files, e.g. `{"kind":"lesson","section":"grammar","unit":"genitive"}`;
`node tools/validate_content.js` checks all of these resolve). Open the
file you want to extend and follow its existing entries — the shapes are
simple once you see one example.

## Tech

- **Frontend:** vanilla HTML/CSS/JS (no build step), Web Speech API for audio.
- **State:** browser `localStorage` (per device, no account).
- **Scheduler:** SM‑2 spaced repetition, implemented in the browser.
- **Optional local server:** Python + [Flask](https://flask.palletsprojects.com/).

The core lessons, flashcards, and progress tracking need no external
services, databases, or API keys. The one exception is the **AI Tutor**,
which is opt-in and calls a third-party LLM API directly from your browser
using a key you provide — see [AI Tutor setup](#ai-tutor-setup).
