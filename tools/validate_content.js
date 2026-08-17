#!/usr/bin/env node
"use strict";
// Zero-dependency sanity check for static/content/*.json, run before deploy.
// Catches the two failure modes flagged in the codebase audit:
//   1. A file that doesn't even parse, or a vocabulary card missing ru/en.
//   2. Two vocabulary cards in the same deck sharing identical `ru` text --
//      masterCards() in app.js builds each flashcard's SRS-tracking id as
//      `${deck.id}:${card.ru}`, so a collision here silently merges their
//      spaced-repetition progress.
//   3. A Learning Path (path.json) node whose section/unit/deck/case/lesson/
//      level reference doesn't actually exist anywhere -- the node would
//      just silently never complete, with no error surfaced to the student.
//
// Run: node tools/validate_content.js

const fs = require("fs");
const path = require("path");

const CONTENT_DIR = path.join(__dirname, "..", "static", "content");
let errors = 0;

function fail(msg) {
  errors++;
  console.error(`✗ ${msg}`);
}

function loadJSON(file) {
  const full = path.join(CONTENT_DIR, file);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${file} is not valid JSON: ${e.message}`);
    return null;
  }
}

// ---- 1. every file parses ----
const FILES = [
  "vocabulary.json", "grammar.json", "academic.json", "alphabet.json",
  "conversations.json", "listening.json", "cases.json", "exam.json",
  "path.json", "verbs.json",
];
const data = {};
for (const f of FILES) data[f] = loadJSON(f);

// ---- 2. vocabulary cards: required fields + no duplicate SRS ids ----
const vocab = data["vocabulary.json"];
if (vocab && Array.isArray(vocab.decks)) {
  const seenIds = new Set();
  for (const deck of vocab.decks) {
    if (!deck.id) { fail(`vocabulary.json: a deck is missing "id"`); continue; }
    for (const card of deck.cards || []) {
      if (!card.ru || !String(card.ru).trim()) fail(`vocabulary.json: deck "${deck.id}" has a card with empty "ru"`);
      if (!card.en || !String(card.en).trim()) fail(`vocabulary.json: deck "${deck.id}" card "${card.ru}" has empty "en"`);
      const srsId = `${deck.id}:${card.ru}`;
      if (seenIds.has(srsId)) fail(`vocabulary.json: duplicate card "${card.ru}" in deck "${deck.id}" — SRS progress would merge silently`);
      seenIds.add(srsId);
    }
  }
} else {
  fail("vocabulary.json: missing or malformed (expected { decks: [...] })");
}

// ---- 3. path.json cross-references resolve ----
const pathData = data["path.json"];
if (pathData && Array.isArray(pathData.units)) {
  const unitIdsBySection = {};
  for (const section of ["alphabet", "grammar", "academic", "conversations"]) {
    const d = data[`${section}.json`];
    unitIdsBySection[section] = new Set((d && d.units || []).map((u) => u.id));
  }
  const deckIds = new Set((vocab && vocab.decks || []).map((d) => d.id));
  const caseIds = new Set((data["cases.json"] && data["cases.json"].cases || []).map((c) => c.id));
  const lessonIds = new Set((data["listening.json"] && data["listening.json"].lessons || []).map((l) => l.id));
  const levelIds = new Set((data["exam.json"] && data["exam.json"].levels || []).map((l) => l.id));

  for (const unit of pathData.units) {
    for (const node of unit.nodes || []) {
      const where = `path.json: node "${node.id}" (unit "${unit.id}")`;
      switch (node.kind) {
        case "lesson": {
          const known = unitIdsBySection[node.section];
          if (!known) fail(`${where} references unknown section "${node.section}"`);
          else if (!known.has(node.unit)) fail(`${where} references unit "${node.unit}" not found in ${node.section}.json`);
          break;
        }
        case "flashcards":
          if (!deckIds.has(node.deck)) fail(`${where} references deck "${node.deck}" not found in vocabulary.json`);
          break;
        case "cases":
          if (!caseIds.has(node.case)) fail(`${where} references case "${node.case}" not found in cases.json`);
          break;
        case "listening":
          if (!lessonIds.has(node.lesson)) fail(`${where} references listening lesson "${node.lesson}" not found in listening.json`);
          break;
        case "exam":
          if (!levelIds.has(node.level)) fail(`${where} references exam level "${node.level}" not found in exam.json`);
          break;
        case "checkpoint":
          break; // no reference to check
        default:
          fail(`${where} has unrecognized kind "${node.kind}"`);
      }
    }
  }
} else {
  fail("path.json: missing or malformed (expected { units: [...] })");
}

if (errors) {
  console.error(`\n${errors} problem${errors === 1 ? "" : "s"} found in static/content/*.json.`);
  process.exit(1);
}
console.log("OK: static/content/*.json parses cleanly, vocabulary has no duplicate cards, and path.json references all resolve.");
