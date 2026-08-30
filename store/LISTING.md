# Google Play store listing — copy & form answers

Everything here is ready to paste into the Play Console. Nothing in this file
is used by the app itself.

---

## App details

**App name** (max 30 chars)

```
Русский от А до Я — Russian
```

*26 characters. If you'd rather it sort under R for English speakers, use
`Russian A to Z — Русский` (24 chars).*

**Short description** (max 80 chars)

```
Learn Russian from the alphabet to academic writing. Offline, free, no ads.
```

*74 characters.*

**Full description** (max 4000 chars)

```
Русский от А до Я is a complete Russian course that takes you from the Cyrillic
alphabet all the way to academic and scholarly writing — with every explanation
given in English, Arabic and Central Kurdish (Sorani).

It was built for serious adult learners, especially students who need Russian
for university study or research. There are no ads, no subscriptions, no
accounts, and no tracking. Everything works offline.

WHAT'S INSIDE

• Alphabet & phonetics — all 33 Cyrillic letters with IPA, hard and soft
  vowels, stress, vowel reduction and consonant assimilation.
• Grammar A to Z — the full case system with complete declension tables,
  nouns, adjectives, pronouns, numerals, verb aspect, conjugation, tenses,
  participles and verbal adverbs.
• Vocabulary — 270 flashcards across 12 themed decks, from survival basics to
  academic and scholarly register, many with real photographs.
• Conversation — 10 realistic dialogue scenarios with reusable phrase banks:
  introductions, meeting a supervisor, seminars, conferences, daily life.
• Academic Russian — научный стиль: impersonal and passive constructions,
  discourse connectors, paper and thesis structure, citation language.

HOW YOU PRACTISE

• Flashcards with true spaced repetition (the SM-2 algorithm) — rate each card
  and the schedule adapts to how well you actually know it.
• A guided Learning Path that unlocks step by step, so you always know what to
  study next.
• Cases trainer — drill all six cases in real sentences, with the grammar rule
  explained in three languages every time you answer.
• Verb trainer, dictation, listening lessons and A1–C2 practice exams.
• Pronunciation practice — say the word aloud and the app checks what it heard.
• Progress dashboard with streaks, XP, badges and per-case mastery.

THREE LANGUAGES, SIDE BY SIDE

Every word, example sentence, dialogue line and grammar note carries an
English, Arabic and Kurdish (Sorani) translation. A single toggle switches
between showing one language or all three — useful whether you think in
English, Arabic or Kurdish.

OPTIONAL AI TUTOR

If you want free conversation practice, you can connect your own free API key
from a provider of your choice (Google Gemini, OpenRouter, Groq, Mistral and
others are supported) and chat with an AI tutor in Russian, by typing or by
voice. This is entirely optional — the whole course works without it. Your key
is stored only on your device and is sent only to the provider you picked.

PRIVACY

No accounts. No analytics. No advertising. No data collection. Your progress
stays on your device and is never uploaded anywhere.
```

*≈2,450 characters.*

---

## Graphics checklist

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 512×512 PNG, 32-bit | Derive from `static/icons/icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG, no alpha | **Still needed** |
| Phone screenshots | 2–8, min 320px, max 3840px | ✅ 8 provided, 1080×2340 |
| Tablet screenshots | optional | Not provided |

Screenshots are in `store/screenshots/`, in the order they should be uploaded:
dashboard, learning path, grammar, vocabulary, flashcards, cases trainer,
listening, progress.

---

## Data safety form

Play asks this as a questionnaire. The honest answers for this app:

**Does your app collect or share any of the required user data types?**
→ **No.**

The app has no backend, no analytics and no accounts, and the developer
receives no data whatsoever. The two features that touch the outside world
are both user-initiated and go directly from the device to a third party the
user chose, which Play treats as neither collection nor sharing by you:

- **AI Tutor** — messages the user types are sent from their device straight to
  the LLM provider whose API key they entered themselves.
- **Microphone** — used only during pronunciation practice and voice input, and
  handled by the device's own speech-recognition service. No audio is stored or
  transmitted by the app.

**Is all user data encrypted in transit?** → Yes (all API calls are HTTPS).
**Do you provide a way for users to request data deletion?** → Yes — all data is
local; clearing app storage or uninstalling removes everything.

If the form asks you to declare the microphone permission, describe it as:
*"Optional. Used only for pronunciation practice and voice input to the AI
tutor. Audio is processed by the device's speech recognition and is never
recorded, stored or sent to the developer."*

---

## Content rating questionnaire

Answer **no** to every question about violence, sexuality, profanity, drugs,
gambling and user-generated content sharing. The one nuance:

- **Does the app let users interact or exchange content?** The AI Tutor is a
  private conversation between the user and their own chosen AI provider —
  there is no communication between users, no user-to-user content, and nothing
  is shared publicly. Declare accordingly.

Expected outcome: **Everyone / PEGI 3**.

---

## Other required fields

| Field | Value |
| --- | --- |
| Category | Education |
| Tags | Language learning, Education |
| Privacy policy URL | `https://shwan06.github.io/jaf/privacy.html` |
| Contact email | *(your email — required and shown publicly)* |
| Website | `https://shwan06.github.io/jaf/` |
| Ads | No ads |
| In-app purchases | None |
| Target audience | 18+ (or 13+) — it is not a children's app |
| Government app | No |
| Financial features | None |

---

## Release notes for version 1.0

```
First release.

A complete Russian course — alphabet through academic writing — with English,
Arabic and Kurdish translations throughout. Spaced-repetition flashcards, a
guided learning path, trainers for the six cases, verbs, listening and
pronunciation, and A1–C2 practice exams. Works fully offline.
```
