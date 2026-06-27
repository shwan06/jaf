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

### Study tools

- **🃏 Flashcards** — spaced repetition using the **SM‑2** algorithm. Rate each
  card *Again / Hard / Good / Easy* and the scheduler adapts review intervals.
- **🎯 Practice quiz** — multiple‑choice recall drills (Russian→English and
  English→Russian), filterable by deck.
- **🔊 Audio everywhere** — click any Russian word or sentence to hear it
  pronounced (uses your browser's built‑in Russian text‑to‑speech).
- **Progress tracking** — mark lessons complete; the dashboard shows lessons
  done, cards due and total reviews. State is stored locally in SQLite.

## Quick start

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

On first launch the app creates `progress.db` (SQLite) and seeds the flashcard
deck from the vocabulary content. To reset all progress, just delete
`progress.db` and restart.

> **Tip:** for the best audio, use a browser/OS with a Russian voice installed
> (Chrome and Edge ship one; on Linux you may need to install a Russian speech
> voice). Click **🔊 Test audio** in the sidebar to check.

## Project structure

```
.
├── app.py                 # Flask backend: API, SM-2 scheduler, progress, serves frontend
├── requirements.txt
├── content/               # All learning content as JSON (editable)
│   ├── alphabet.json
│   ├── grammar.json
│   ├── vocabulary.json    # flashcards are seeded from here
│   ├── conversations.json
│   └── academic.json
└── static/                # Frontend single-page app
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Adding or editing content

All lessons live in `content/*.json` and share one simple schema, so you can
extend the course without touching code. Each section is a list of **units**,
and each unit is a list of **blocks**:

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
          { "ru": "Это книга брата.", "tr": "Eto kniga brata.", "en": "This is the brother's book." }
        ] },
        { "type": "note", "html": "After 2, 3, 4 → genitive singular; after 5+ → genitive plural." }
      ]
    }
  ]
}
```

**Block types:** `prose`, `note`, `list` (`items`), `table`
(`headers`+`rows`), `examples` (`items` of `{ru, tr, en}`), `dialogue`
(`lines` of `{speaker, ru, tr, en}`), and `letters` (alphabet only).

**Flashcards** come from `content/vocabulary.json`, which uses `decks` instead
of `units`; each deck has `cards` of `{ru, en, tr, pos, example}`. Delete
`progress.db` after editing vocabulary to re‑seed the deck.

## Tech

- **Backend:** Python + [Flask](https://flask.palletsprojects.com/), SQLite (standard library).
- **Frontend:** vanilla HTML/CSS/JS (no build step), Web Speech API for audio.
- **Scheduler:** SM‑2 spaced repetition.

No external services or API keys required — it runs fully offline.
