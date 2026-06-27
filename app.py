"""
Русский от А до Я — Russian from A to Z
A full-stack web app for learning Russian grammar, vocabulary, conversation
and academic register, aimed at advanced (PhD-level) learners.

Backend: Flask + SQLite.
  * Serves the static single-page frontend.
  * Exposes the lesson/vocabulary/conversation content as JSON.
  * Implements an SM-2 spaced-repetition scheduler for flashcards.
  * Tracks per-user progress (single local profile by default).

Run:
    pip install -r requirements.txt
    python app.py
    # open http://127.0.0.1:5000
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
CONTENT_DIR = BASE_DIR / "content"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "progress.db"

# The content sections the app knows how to serve. Each maps to a JSON file.
SECTIONS = [
    "alphabet",
    "grammar",
    "vocabulary",
    "conversations",
    "academic",
]

app = Flask(__name__, static_folder=None)


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS cards (
            id            TEXT PRIMARY KEY,
            deck          TEXT NOT NULL,
            front         TEXT NOT NULL,
            back          TEXT NOT NULL,
            extra         TEXT,
            ease          REAL    NOT NULL DEFAULT 2.5,
            interval      INTEGER NOT NULL DEFAULT 0,
            repetitions   INTEGER NOT NULL DEFAULT 0,
            due           TEXT    NOT NULL,
            last_reviewed TEXT
        );

        CREATE TABLE IF NOT EXISTS progress (
            item       TEXT PRIMARY KEY,   -- e.g. "grammar:cases-nominative"
            section    TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'completed',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id   TEXT NOT NULL,
            quality   INTEGER NOT NULL,
            reviewed  TEXT NOT NULL
        );
        """
    )
    db.commit()
    db.close()


def seed_cards() -> None:
    """Populate the SRS deck from the vocabulary content on first run."""
    db = sqlite3.connect(DB_PATH)
    existing = db.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    if existing:
        db.close()
        return

    vocab = _load_section("vocabulary")
    today = date.today().isoformat()
    rows = []
    for deck in vocab.get("decks", []):
        for card in deck.get("cards", []):
            cid = f"{deck['id']}:{card['ru']}"
            extra = json.dumps(
                {
                    "tr": card.get("tr", ""),
                    "pos": card.get("pos", ""),
                    "example": card.get("example", ""),
                },
                ensure_ascii=False,
            )
            rows.append((cid, deck["id"], card["ru"], card["en"], extra, today))
    db.executemany(
        "INSERT OR IGNORE INTO cards (id, deck, front, back, extra, due) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Content loading
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=None)
def _load_section(name: str) -> dict:
    path = CONTENT_DIR / f"{name}.json"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# SM-2 spaced repetition
# --------------------------------------------------------------------------- #
def sm2(ease: float, interval: int, repetitions: int, quality: int):
    """Return updated (ease, interval, repetitions) per the SM-2 algorithm.

    quality: 0..5 (0 = total blackout, 5 = perfect recall).
    """
    if quality < 3:
        repetitions = 0
        interval = 1
    else:
        if repetitions == 0:
            interval = 1
        elif repetitions == 1:
            interval = 6
        else:
            interval = round(interval * ease)
        repetitions += 1

    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ease = max(1.3, ease)
    return ease, interval, repetitions


# --------------------------------------------------------------------------- #
# API: content
# --------------------------------------------------------------------------- #
@app.get("/api/sections")
def api_sections():
    out = []
    for name in SECTIONS:
        data = _load_section(name)
        out.append(
            {
                "id": name,
                "title": data.get("title", name.title()),
                "description": data.get("description", ""),
            }
        )
    return jsonify(out)


@app.get("/api/content/<section>")
def api_content(section: str):
    if section not in SECTIONS:
        return jsonify({"error": "unknown section"}), 404
    return jsonify(_load_section(section))


# --------------------------------------------------------------------------- #
# API: spaced repetition
# --------------------------------------------------------------------------- #
@app.get("/api/srs/decks")
def api_srs_decks():
    db = get_db()
    today = date.today().isoformat()
    rows = db.execute(
        """
        SELECT deck,
               COUNT(*)                              AS total,
               SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END) AS due,
               SUM(CASE WHEN repetitions > 0 THEN 1 ELSE 0 END) AS started
        FROM cards GROUP BY deck
        """,
        (today,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/srs/due")
def api_srs_due():
    db = get_db()
    today = date.today().isoformat()
    deck = request.args.get("deck")
    limit = int(request.args.get("limit", 20))
    params: list = [today]
    sql = "SELECT * FROM cards WHERE due <= ?"
    if deck and deck != "all":
        sql += " AND deck = ?"
        params.append(deck)
    sql += " ORDER BY due ASC, repetitions ASC LIMIT ?"
    params.append(limit)
    rows = db.execute(sql, params).fetchall()

    cards = []
    for r in rows:
        extra = json.loads(r["extra"]) if r["extra"] else {}
        cards.append(
            {
                "id": r["id"],
                "deck": r["deck"],
                "front": r["front"],
                "back": r["back"],
                "tr": extra.get("tr", ""),
                "pos": extra.get("pos", ""),
                "example": extra.get("example", ""),
            }
        )
    return jsonify(cards)


@app.post("/api/srs/review")
def api_srs_review():
    payload = request.get_json(force=True)
    card_id = payload.get("id")
    quality = int(payload.get("quality", 0))

    db = get_db()
    row = db.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    if row is None:
        return jsonify({"error": "card not found"}), 404

    ease, interval, reps = sm2(
        row["ease"], row["interval"], row["repetitions"], quality
    )
    due = (date.today() + timedelta(days=interval)).isoformat()
    now = datetime.utcnow().isoformat()
    db.execute(
        "UPDATE cards SET ease=?, interval=?, repetitions=?, due=?, last_reviewed=? "
        "WHERE id=?",
        (ease, interval, reps, due, now, card_id),
    )
    db.execute(
        "INSERT INTO reviews (card_id, quality, reviewed) VALUES (?, ?, ?)",
        (card_id, quality, now),
    )
    db.commit()
    return jsonify({"id": card_id, "interval": interval, "due": due, "ease": round(ease, 2)})


# --------------------------------------------------------------------------- #
# API: progress
# --------------------------------------------------------------------------- #
@app.get("/api/progress")
def api_progress():
    db = get_db()
    completed = db.execute(
        "SELECT item, section FROM progress WHERE status='completed'"
    ).fetchall()
    today = date.today().isoformat()
    card_stats = db.execute(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN repetitions>0 THEN 1 ELSE 0 END) AS learning, "
        "SUM(CASE WHEN due<=? THEN 1 ELSE 0 END) AS due FROM cards",
        (today,),
    ).fetchone()
    reviews_total = db.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
    return jsonify(
        {
            "completed": [dict(r) for r in completed],
            "cards": dict(card_stats),
            "reviews_total": reviews_total,
        }
    )


@app.post("/api/progress")
def api_progress_set():
    payload = request.get_json(force=True)
    item = payload.get("item")
    section = payload.get("section", "")
    status = payload.get("status", "completed")
    db = get_db()
    db.execute(
        "INSERT INTO progress (item, section, status, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(item) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
        (item, section, status, datetime.utcnow().isoformat()),
    )
    db.commit()
    return jsonify({"ok": True, "item": item, "status": status})


# --------------------------------------------------------------------------- #
# Static frontend
# --------------------------------------------------------------------------- #
@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path: str):
    full = STATIC_DIR / path
    if full.exists() and full.is_file():
        return send_from_directory(STATIC_DIR, path)
    # SPA fallback
    return send_from_directory(STATIC_DIR, "index.html")


def bootstrap() -> None:
    init_db()
    seed_cards()


if __name__ == "__main__":
    bootstrap()
    app.run(debug=True, host="127.0.0.1", port=5000)
