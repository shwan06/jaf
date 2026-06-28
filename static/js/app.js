/* ======================================================================
   Русский от А до Я — frontend SPA (fully client-side)
   Content is loaded from static JSON; progress + spaced-repetition state
   live in the browser (localStorage), so the app needs no backend and can
   be hosted as a static site. A Flask backend (app.py) is optional, for
   running locally.
   ====================================================================== */

const SECTION_IDS = ["alphabet", "grammar", "vocabulary", "conversations", "academic"];

const App = {
  sections: [],
  contentCache: {},
  voice: null,
};

/* ---------------- helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
};
const fetchJSON = async (path) => {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};
async function loadContent(section) {
  if (!App.contentCache[section]) {
    App.contentCache[section] = await fetchJSON(`content/${section}.json`);
  }
  return App.contentCache[section];
}

/* ---------------- local persistence ---------------- */
const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const addDaysStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const Store = {
  SRS: "ru_srs_v1",
  PROG: "ru_progress_v1",
  loadSrs() { try { return JSON.parse(localStorage.getItem(this.SRS)) || {}; } catch { return {}; } },
  saveSrs(s) { localStorage.setItem(this.SRS, JSON.stringify(s)); },
  loadProg() {
    try { return JSON.parse(localStorage.getItem(this.PROG)) || { completed: {}, reviews: 0 }; }
    catch { return { completed: {}, reviews: 0 }; }
  },
  saveProg(p) { localStorage.setItem(this.PROG, JSON.stringify(p)); },
};

/* ---------------- favorites / bookmarks ---------------- */
const Favs = {
  KEY: "ru_favorites_v1",
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  save(a) { localStorage.setItem(this.KEY, JSON.stringify(a)); },
  has(id) { return this.load().some((x) => x.id === id); },
  toggle(item) {
    const a = this.load();
    const i = a.findIndex((x) => x.id === item.id);
    if (i >= 0) { a.splice(i, 1); this.save(a); return false; }
    a.push(item); this.save(a); return true;
  },
  remove(id) { this.save(this.load().filter((x) => x.id !== id)); },
};

// A star toggle bound to a favoritable item ({id, ru, en, ar, tr, type, src}).
function starBtn(item) {
  const on0 = Favs.has(item.id);
  const b = el("button", { class: "star-btn" + (on0 ? " on" : ""), title: "Save to favorites", "aria-label": "Save to favorites" }, on0 ? "★" : "☆");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = Favs.toggle(item);
    b.classList.toggle("on", on);
    b.textContent = on ? "★" : "☆";
    showToast(on ? "★ Saved" : "☆ Removed", item.ru);
  });
  return b;
}

const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

// SM-2 spaced repetition (mirrors the original backend implementation)
function sm2(state, quality) {
  let { ease = 2.5, interval = 0, reps = 0 } = state || {};
  if (quality < 3) {
    reps = 0;
    interval = 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { ease, interval, reps };
}

// Master card list, derived from the vocabulary content.
async function masterCards() {
  const vocab = await loadContent("vocabulary");
  const cards = [];
  (vocab.decks || []).forEach((deck) => {
    (deck.cards || []).forEach((c) => {
      cards.push({
        id: `${deck.id}:${c.ru}`,
        deck: deck.id,
        front: c.ru,
        back: c.en,
        tr: c.tr || "",
        ar: c.ar || "",
        pos: c.pos || "",
        example: c.example || "",
      });
    });
  });
  return cards;
}

// Card state (defaults make a never-seen card "new" and due today).
function cardState(srs, id) {
  return srs[id] || { ease: 2.5, interval: 0, reps: 0, due: todayStr() };
}

async function srsStats() {
  const cards = await masterCards();
  const srs = Store.loadSrs();
  const today = todayStr();
  let due = 0, learning = 0;
  cards.forEach((c) => {
    const st = cardState(srs, c.id);
    if (st.due <= today) due++;
    if ((st.reps || 0) > 0) learning++;
  });
  return { total: cards.length, due, learning };
}

async function srsDecks() {
  const cards = await masterCards();
  const srs = Store.loadSrs();
  const today = todayStr();
  const map = {};
  cards.forEach((c) => {
    const m = (map[c.deck] = map[c.deck] || { deck: c.deck, total: 0, due: 0, started: 0 });
    const st = cardState(srs, c.id);
    m.total++;
    if (st.due <= today) m.due++;
    if ((st.reps || 0) > 0) m.started++;
  });
  return Object.values(map);
}

async function srsDue(deck, limit = 30) {
  const cards = await masterCards();
  const srs = Store.loadSrs();
  const today = todayStr();
  return cards
    .filter((c) => (deck === "all" || c.deck === deck) && cardState(srs, c.id).due <= today)
    .sort((a, b) => cardState(srs, a.id).due.localeCompare(cardState(srs, b.id).due))
    .slice(0, limit);
}

function srsReview(cardId, quality) {
  const srs = Store.loadSrs();
  const updated = sm2(srs[cardId], quality);
  updated.due = addDaysStr(updated.interval);
  updated.last = new Date().toISOString();
  srs[cardId] = updated;
  Store.saveSrs(srs);
  const prog = Store.loadProg();
  prog.reviews = (prog.reviews || 0) + 1;
  Store.saveProg(prog);
}

/* ---------------- gamification: XP, levels, streak, badges ---------------- */
const daysBetween = (a, b) =>
  Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 86400000);

const BADGES = [
  { id: "first_lesson", icon: "🌱", title: "First steps", desc: "Complete your first lesson", test: (g, p) => Object.keys(p.completed || {}).length >= 1 },
  { id: "ten_lessons", icon: "📚", title: "Bookworm", desc: "Complete 10 lessons", test: (g, p) => Object.keys(p.completed || {}).length >= 10 },
  { id: "thirty_lessons", icon: "🎓", title: "Devoted scholar", desc: "Complete 30 lessons", test: (g, p) => Object.keys(p.completed || {}).length >= 30 },
  { id: "reviews_50", icon: "🧠", title: "Memory athlete", desc: "Review 50 flashcards", test: (g, p) => (p.reviews || 0) >= 50 },
  { id: "reviews_200", icon: "🧬", title: "Memory master", desc: "Review 200 flashcards", test: (g, p) => (p.reviews || 0) >= 200 },
  { id: "streak_3", icon: "🔥", title: "On a roll", desc: "3-day streak", test: (g) => (g.longest || g.streak) >= 3 },
  { id: "streak_7", icon: "⚡", title: "Unstoppable", desc: "7-day streak", test: (g) => (g.longest || g.streak) >= 7 },
  { id: "streak_30", icon: "🌋", title: "Monthly master", desc: "30-day streak", test: (g) => (g.longest || g.streak) >= 30 },
  { id: "xp_500", icon: "💎", title: "Dedicated", desc: "Earn 500 XP", test: (g) => g.xp >= 500 },
  { id: "xp_2000", icon: "💠", title: "XP titan", desc: "Earn 2000 XP", test: (g) => g.xp >= 2000 },
  { id: "level_5", icon: "🚀", title: "Rising star", desc: "Reach level 5", test: (g) => Gamify.level(g.xp).level >= 5 },
  { id: "exam_ace", icon: "🏆", title: "Exam ace", desc: "Score 80%+ on any exam", test: () => { try { return Object.values(JSON.parse(localStorage.getItem("ru_exam")) || {}).some((v) => v >= 80); } catch { return false; } } },
  { id: "cases_25", icon: "🧩", title: "Case cadet", desc: "Get 25 case drills right", test: () => Cases.totalCorrect() >= 25 },
  { id: "cases_100", icon: "🏅", title: "Case expert", desc: "Get 100 case drills right", test: () => Cases.totalCorrect() >= 100 },
  { id: "cases_master", icon: "👑", title: "Grammar crown", desc: "Reach 60%+ mastery in all 6 cases", test: () => { const ids = ["nominative","genitive","dative","accusative","instrumental","prepositional"]; return ids.every((id) => (Cases.mastery(id) || 0) >= 60); } },
];

const Gamify = {
  KEY: "ru_gamify_v1",
  DAILY_GOAL: 40,
  load() {
    const def = { xp: 0, streak: 0, longest: 0, lastDay: "", todayDay: "", todayXp: 0, badges: [], history: {} };
    try { const s = Object.assign(def, JSON.parse(localStorage.getItem(this.KEY)) || {}); s.history = s.history || {}; return s; } catch { return def; }
  },
  save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  level(xp) {
    let lvl = 1, need = 50, acc = 0;
    while (xp >= acc + need) { acc += need; lvl++; need = Math.round(need * 1.25); }
    return { level: lvl, into: xp - acc, need };
  },
  stats() {
    const s = this.load();
    return { ...s, ...this.level(s.xp), goal: this.DAILY_GOAL };
  },
  award(amount, reason) {
    const s = this.load();
    const today = todayStr();
    if (s.todayDay !== today) {
      const prev = s.lastDay;
      s.streak = prev ? (daysBetween(prev, today) === 1 ? s.streak + 1 : 1) : 1;
      s.lastDay = today; s.todayDay = today; s.todayXp = 0;
    }
    s.xp += amount; s.todayXp += amount;
    s.longest = Math.max(s.longest || 0, s.streak);
    // Per-day XP log for the analytics calendar/trend; keep ~140 days.
    s.history = s.history || {};
    s.history[today] = (s.history[today] || 0) + amount;
    const cutoff = addDaysStr(-140);
    Object.keys(s.history).forEach((d) => { if (d < cutoff) delete s.history[d]; });
    const prog = Store.loadProg();
    const earned = BADGES.filter((b) => !s.badges.includes(b.id) && b.test(s, prog));
    earned.forEach((b) => s.badges.push(b.id));
    this.save(s);
    showToast(`+${amount} XP`, reason);
    earned.forEach((b) => setTimeout(() => showToast(b.icon + " " + b.title, "Badge unlocked!"), 250));
    return s;
  },
};

let _toastHost = null;
function showToast(title, sub) {
  if (!_toastHost) { _toastHost = el("div", { class: "toast-host" }); document.body.append(_toastHost); }
  const t = el("div", { class: "toast" }, el("strong", {}, title), sub ? el("span", {}, sub) : null);
  _toastHost.append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2200);
}

/* ---------------- speech ---------------- */
function pickVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  App.voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ru")) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text, rate) {
  if (!window.speechSynthesis) return;
  const clean = String(text).replace(/[—–-].*$/u, "").trim() || String(text);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "ru-RU";
  u.rate = rate || 0.92;
  if (App.voice) u.voice = App.voice;
  speechSynthesis.speak(u);
}

// Play a clip: a real recording if the item provides audioUrl, otherwise the
// device's Russian text-to-speech. `slow` halves the pace for careful listening.
let _audioEl = null;
function playClip(item, slow) {
  if (item && item.audioUrl) {
    try { speechSynthesis.cancel(); } catch {}
    if (!_audioEl) _audioEl = new Audio();
    _audioEl.src = item.audioUrl;
    _audioEl.playbackRate = slow ? 0.7 : 1;
    _audioEl.play().catch(() => speak(item.ru, slow ? 0.6 : 0.92));
  } else if (item) {
    speak(item.ru, slow ? 0.6 : 0.92);
  }
}
document.addEventListener("click", (e) => {
  const ru = e.target.closest(".ru");
  if (ru) speak(ru.dataset.say || ru.textContent);
});
const ru = (text, sayOverride) =>
  el("span", { class: "ru", "data-say": sayOverride || text }, text);

/* ---------------- block renderer ---------------- */
function renderBlock(b) {
  switch (b.type) {
    case "prose":
      return el("div", { class: "prose", html: b.html || "" });
    case "note":
      return el("div", { class: "note", html: b.html || "" });
    case "list": {
      const ul = el("ul", { class: "block-list" });
      (b.items || []).forEach((it) => ul.append(el("li", { html: it })));
      return ul;
    }
    case "table": {
      const wrap = el("div", { class: "table-wrap" });
      if (b.caption) wrap.append(el("div", { class: "table-cap" }, b.caption));
      const t = el("table", { class: "grid" });
      if (b.headers) {
        const tr = el("tr");
        b.headers.forEach((h) => tr.append(el("th", { html: String(h) })));
        t.append(el("thead", {}, tr));
      }
      const tb = el("tbody");
      (b.rows || []).forEach((row) => {
        const tr = el("tr");
        row.forEach((c) => tr.append(el("td", { html: String(c) })));
        tb.append(tr);
      });
      t.append(tb);
      wrap.append(t);
      return wrap;
    }
    case "examples": {
      const wrap = el("div", { class: "examples" });
      (b.items || []).forEach((it) => {
        const row = el("div", { class: "example" });
        row.append(el("div", { class: "ex-ru" }, ru(it.ru)));
        if (it.tr) row.append(el("div", { class: "ex-tr" }, it.tr));
        if (it.en) row.append(el("div", { class: "ex-en gloss-en" }, it.en));
        if (it.ar) row.append(el("div", { class: "ex-ar gloss-ar", dir: "rtl" }, it.ar));
        wrap.append(row);
      });
      return wrap;
    }
    case "dialogue": {
      const wrap = el("div", { class: "dialogue" });
      if (b.title) wrap.append(el("h4", {}, b.title));
      (b.lines || []).forEach((l) => {
        const line = el("div", { class: "d-line" });
        const speaker = l.speaker ? l.speaker + " " : "";
        line.append(el("div", { class: "d-ru" }, ru((speaker + l.ru).trim(), l.ru)));
        if (l.tr) line.append(el("div", { class: "d-tr" }, l.tr));
        if (l.en) line.append(el("div", { class: "d-en gloss-en" }, l.en));
        if (l.ar) line.append(el("div", { class: "d-ar gloss-ar", dir: "rtl" }, l.ar));
        wrap.append(line);
      });
      return wrap;
    }
    case "letters": {
      const grid = el("div", { class: "letters-grid" });
      (b.items || []).forEach((L) => {
        const card = el(
          "div",
          { class: "letter-card", "data-say": (L.example || L.letter).replace(/[—-].*$/, "").trim() },
          el("div", { class: "lc-letter ru", "data-say": L.letter.split(" ")[0] }, L.letter),
          el("div", { class: "lc-name" }, L.name || ""),
          el("div", { class: "lc-ipa" }, L.ipa || ""),
          el("div", { class: "lc-sound" }, L.sound || ""),
          L.example ? el("div", { class: "lc-ex ru", "data-say": L.example.replace(/[—-].*$/, "").trim() }, L.example) : null
        );
        grid.append(card);
      });
      return grid;
    }
    default:
      return el("div", { class: "prose", html: b.html || "" });
  }
}

function renderUnit(unit, sectionId) {
  const card = el("section", { class: "unit", id: "u-" + unit.id });
  const head = el("div", { class: "unit-head" });
  const titleWrap = el("div", {}, el("h2", {}, unit.title || ""));
  if (unit.summary) titleWrap.append(el("p", { class: "summary gloss-en" }, unit.summary));
  if (unit.summary_ar) titleWrap.append(el("p", { class: "summary summary-ar gloss-ar", dir: "rtl" }, unit.summary_ar));
  head.append(titleWrap);

  const itemKey = `${sectionId}:${unit.id}`;
  const prog = Store.loadProg();
  const done = !!(prog.completed && prog.completed[itemKey]);
  const toggle = el(
    "button",
    { class: "done-toggle" + (done ? " done" : "") },
    done ? "✓ Completed" : "Mark complete"
  );
  toggle.addEventListener("click", () => {
    const p = Store.loadProg();
    p.completed = p.completed || {};
    const nowDone = !toggle.classList.contains("done");
    if (nowDone) p.completed[itemKey] = sectionId;
    else delete p.completed[itemKey];
    Store.saveProg(p);
    if (nowDone) Gamify.award(10, "Lesson completed");
    toggle.classList.toggle("done", nowDone);
    toggle.textContent = nowDone ? "✓ Completed" : "Mark complete";
    renderNav();
  });
  head.append(toggle);
  card.append(head);

  (unit.blocks || []).forEach((b) => card.append(renderBlock(b)));
  return card;
}

/* ---------------- views ---------------- */
// Browsable vocabulary: render each deck as a card of words (ru click-to-speak,
// glosses, example, favorite star) with quick-jump chips and a practice link.
function renderDeckBrowser(view, decks) {
  const jump = el("div", { class: "deck-pills", style: "justify-content:flex-start" });
  decks.forEach((d) => {
    const a = el("a", { class: "deck-pill", href: "#u-" + d.id }, prettyDeck(d.id), el("span", { class: "cnt" }, String((d.cards || []).length)));
    jump.append(a);
  });
  view.append(jump);
  view.append(el("div", { class: "toolbar", style: "margin-top:-4px" },
    el("a", { class: "resume-btn", href: "#/flashcards", style: "margin:0" }, "🃏 Practice these with flashcards")));

  decks.forEach((d) => {
    const card = el("section", { class: "unit", id: "u-" + d.id });
    card.append(el("div", { class: "unit-head" }, el("div", {},
      el("h2", {}, prettyDeck(d.title || d.id)),
      d.description ? el("p", { class: "summary gloss-en" }, d.description) : null)));
    const list = el("div", { class: "vocab-list" });
    (d.cards || []).forEach((c) => {
      const row = el("div", { class: "vocab-row" });
      row.append(starBtn({ id: "v:" + d.id + ":" + c.ru, ru: c.ru, en: c.en || "", ar: c.ar || "", tr: c.tr || "", type: "word", src: prettyDeck(d.id) }));
      const body = el("div", { class: "vr-body" },
        el("div", { class: "vr-head" },
          el("span", { class: "vr-ru ru", "data-say": c.ru }, c.ru),
          c.pos ? el("span", { class: "vr-pos" }, c.pos) : null),
        c.tr ? el("span", { class: "vr-tr" }, c.tr) : null,
        c.en ? el("div", { class: "vr-en gloss-en" }, c.en) : null,
        c.ar ? el("div", { class: "vr-ar gloss-ar", dir: "rtl" }, c.ar) : null,
        c.example ? el("div", { class: "vr-ex" }, c.example) : null);
      row.append(body);
      list.append(row);
    });
    card.append(list);
    view.append(card);
  });
}

async function viewSection(section, focusUnit) {
  const data = await loadContent(section);
  const view = $("#view");
  view.innerHTML = "";
  view.append(
    el("div", { class: "page-head" },
      el("h1", {}, data.title || section),
      el("p", {}, data.description || ""))
  );
  const units = data.units || [];
  // Vocabulary is stored as decks of cards (not lesson units) — render it as a
  // browsable word list so the section isn't empty.
  if (!units.length && (data.decks || []).length) {
    renderDeckBrowser(view, data.decks);
    if (focusUnit) {
      const t = document.getElementById("u-" + focusUnit);
      if (t) setTimeout(() => { t.scrollIntoView({ behavior: "smooth", block: "start" }); t.classList.add("unit-focus"); setTimeout(() => t.classList.remove("unit-focus"), 2200); }, 60);
    }
    return;
  }
  if (!units.length) {
    view.append(el("div", { class: "fc-empty" }, "No content yet for this section."));
    return;
  }
  units.forEach((u) => view.append(renderUnit(u, section)));
  // Deep-link from the Learning Path: scroll to and highlight a specific unit.
  if (focusUnit) {
    const target = document.getElementById("u-" + focusUnit);
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("unit-focus");
        setTimeout(() => target.classList.remove("unit-focus"), 2200);
      }, 60);
    }
  }
}

async function viewDashboard() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(
    el("div", { class: "page-head" },
      el("h1", {}, "Добро пожаловать! 👋"),
      el("p", {}, "Your path to academic-level Russian — from the alphabet to scholarly writing. Pick up where you left off, or review your flashcards below."))
  );

  // Learning-path banner — Duolingo-style next-step CTA.
  try {
    const ps = await pathState();
    const next = ps.currentIdx >= 0 ? ps.flat[ps.currentIdx] : null;
    const pct = ps.totalSteps ? Math.round((ps.doneCount / ps.totalSteps) * 100) : 0;
    view.append(el("a", { class: "path-banner", href: "#/path" },
      el("div", { class: "pb-left" },
        el("div", { class: "pb-ico" }, "🗺️"),
        el("div", {},
          el("div", { class: "pb-title" }, next ? "Continue your path" : (pct >= 100 ? "Path complete! 🎉" : "Start your path")),
          el("div", { class: "pb-sub" }, next ? `Next: ${next.unit.title.split("—").pop().trim()} · ${next.n.label}` : `${ps.doneCount}/${ps.totalSteps} steps done`))),
      el("div", { class: "pb-ring", style: `--p:${pct}` }, el("span", {}, pct + "%"))));
  } catch { /* path optional */ }

  const last = localStorage.getItem("ru_last_route");
  if (last && last !== "#/" && last !== "#/path") {
    view.append(el("a", { class: "resume-btn", href: last }, "▶ Continue where you left off — " + routeLabel(last)));
  }

  const c = await srsStats();
  const prog = Store.loadProg();
  const totalUnits = await countAllUnits();
  const doneUnits = Object.keys(prog.completed || {}).length;

  view.append(renderGamePanel());

  // Word of the day — deterministic pick so it's stable across reloads on the same day.
  const wodCards = await masterCards().catch(() => []);
  if (wodCards.length) {
    const w = wodCards[hashStr(todayStr()) % wodCards.length];
    view.append(el("div", { class: "wod-panel" },
      el("div", { class: "wod-head" }, "📅 Word of the day"),
      el("div", { class: "wod-ru ru", "data-say": w.front }, w.front),
      w.tr ? el("div", { class: "wod-tr" }, w.tr) : null,
      el("div", { class: "wod-en gloss-en" }, w.back),
      w.ar ? el("div", { class: "wod-ar gloss-ar", dir: "rtl" }, w.ar) : null,
      w.example ? el("div", { class: "wod-ex" }, w.example) : null,
      starBtn({ id: "v:" + w.deck + ":" + w.front, ru: w.front, en: w.back, ar: w.ar, tr: w.tr, type: "word", src: "Word of the day" })));
  }

  view.append(
    el("div", { class: "stat-grid" },
      statBox(doneUnits + "/" + totalUnits, "Lessons completed", "accent"),
      statBox(c.due || 0, "Cards due today", "red"),
      statBox(c.learning || 0, "Cards in progress", "green"),
      statBox(prog.reviews || 0, "Total reviews", ""))
  );

  const grid = el("div", { class: "section-cards" });
  const icons = { alphabet: "🔤", grammar: "📐", vocabulary: "📇", conversations: "💬", academic: "🎓" };
  for (const s of App.sections) {
    const data = await loadContent(s.id).catch(() => ({ units: [] }));
    const total = (data.units || []).length || (data.decks || []).length;
    const done = Object.entries(prog.completed || {}).filter(([, sec]) => sec === s.id).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    grid.append(
      el("a", { class: "section-card", href: "#/section/" + s.id },
        el("div", { class: "sc-ico" }, icons[s.id] || "📘"),
        el("h3", {}, s.title),
        el("p", {}, s.description || ""),
        el("div", { class: "progress-bar" }, el("i", { style: `width:${pct}%` })),
        el("div", { class: "sc-meta" }, total ? `${done}/${total} done` : "Open"))
    );
  }
  grid.append(
    el("a", { class: "section-card", href: "#/flashcards" },
      el("div", { class: "sc-ico" }, "🃏"),
      el("h3", {}, "Flashcards"),
      el("p", {}, "Spaced-repetition review of all vocabulary (SM-2)."),
      el("div", { class: "sc-meta" }, (c.due || 0) + " due now")),
    el("a", { class: "section-card", href: "#/practice" },
      el("div", { class: "sc-ico" }, "🎯"),
      el("h3", {}, "Practice quiz"),
      el("p", {}, "Test recall with multiple-choice vocabulary drills."),
      el("div", { class: "sc-meta" }, "Start a round"))
  );
  view.append(grid);
}

const statBox = (num, lbl, cls) =>
  el("div", { class: "stat " + (cls || "") }, el("div", { class: "s-num" }, String(num)), el("div", { class: "s-lbl" }, lbl));

function renderGamePanel() {
  const g = Gamify.stats();
  const pct = Math.min(100, Math.round((g.into / g.need) * 100));
  const goalPct = Math.min(100, Math.round((g.todayXp / g.goal) * 100));
  const panel = el("div", { class: "game-panel" });

  panel.append(
    el("div", { class: "game-main" },
      el("div", { class: "game-level" }, el("span", { class: "lvl-badge" }, "Lv " + g.level), el("span", { class: "lvl-xp" }, g.xp + " XP")),
      el("div", { class: "game-bar" }, el("i", { style: `width:${pct}%` })),
      el("div", { class: "game-sub" }, `${g.into} / ${g.need} XP to level ${g.level + 1}`))
  );
  const best = Math.max(g.longest || 0, g.streak || 0);
  panel.append(
    el("div", { class: "game-side" },
      el("div", { class: "game-streak" }, el("span", { class: "fire" }, "🔥"), el("strong", {}, String(g.streak)),
        el("span", { class: "muted" }, "day streak"),
        el("span", { class: "muted best" }, "🏆 best " + best)),
      el("div", { class: "game-goal" + (goalPct >= 100 ? " done" : "") },
        el("div", { class: "goal-ring", style: `--p:${goalPct}` }, el("span", {}, goalPct >= 100 ? "✓" : g.todayXp)),
        el("span", { class: "muted" }, goalPct >= 100 ? "Daily goal done!" : `${g.todayXp}/${g.goal} today`)))
  );

  const earned = new Set(g.badges);
  const badges = el("div", { class: "badges" });
  BADGES.forEach((b) => {
    const has = earned.has(b.id);
    badges.append(el("div", { class: "badge-chip" + (has ? " earned" : ""), title: b.desc + (has ? "" : " (locked)") },
      el("span", { class: "b-ico" }, has ? b.icon : "🔒"), el("span", { class: "b-title" }, b.title)));
  });

  return el("div", {}, panel, badges);
}

async function countAllUnits() {
  let n = 0;
  for (const s of App.sections) {
    const data = await loadContent(s.id).catch(() => ({}));
    n += (data.units || []).length;
  }
  return n;
}

/* ---------------- listening comprehension ---------------- */
async function viewListening() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🎧 Listening"),
    el("p", {}, "Press Listen, choose what you heard, then reveal the transcript. Audio uses your device's Russian voice now — and real recordings automatically if they're added. Tip: use 🐢 Slower for tricky sentences.")));
  const data = await loadContent("listening");
  const lessons = data.lessons || [];
  const stage = el("div", { class: "quiz-stage", style: "max-width:640px" });
  view.append(stage);
  const pills = el("div", { class: "deck-pills" });
  const host = el("div", {});
  stage.append(pills, host);

  function renderPicker() {
    pills.innerHTML = ""; host.innerHTML = "";
    lessons.forEach((l) => {
      const p = el("button", { class: "deck-pill" }, l.title, el("span", { class: "cnt" }, String((l.items || []).length)));
      p.addEventListener("click", () => startLesson(l));
      pills.append(p);
    });
    host.append(el("p", { class: "search-hint" }, "Pick a lesson above. Each plays " + lessons.reduce((a, l) => a + (l.items || []).length, 0) + " short sentences across " + lessons.length + " lessons."));
  }

  function startLesson(lesson) {
    const items = lesson.items || [];
    const pool = items.map((it) => it.en);
    const state = { i: 0, score: 0 };

    function render() {
      pills.innerHTML = ""; host.innerHTML = "";
      const back = el("button", { class: "deck-pill" }, "← Lessons");
      back.addEventListener("click", renderPicker);
      pills.append(back);

      if (state.i >= items.length) {
        host.append(el("div", { class: "quiz-card", style: "text-align:center" },
          el("h2", { style: "font-family:'PT Serif',serif" }, lesson.title + " — done"),
          el("p", { style: "font-size:32px;margin:12px 0" }, `${state.score} / ${items.length}`),
          el("button", { class: "btn primary big", style: "margin-top:8px", onclick: () => startLesson(lesson) }, "Listen again"),
          el("button", { class: "deck-pill", style: "margin-top:12px", onclick: renderPicker }, "Other lessons")));
        return;
      }
      const it = items[state.i];
      const card = el("div", { class: "quiz-card" });
      card.append(el("div", { class: "quiz-bar" },
        el("span", {}, `${lesson.title} · ${state.i + 1}/${items.length}`), el("span", {}, `Score: ${state.score}`)));

      const listen = el("button", { class: "btn primary big listen-btn" }, "🎧 Listen");
      listen.addEventListener("click", () => playClip(it));
      const slow = el("button", { class: "btn", style: "background:var(--panel-2);color:var(--text)" }, "🐢 Slower");
      slow.addEventListener("click", () => playClip(it, true));
      card.append(el("div", { class: "listen-row" }, listen, slow));
      card.append(el("div", { class: "quiz-q", style: "margin-top:16px" }, "What did you hear?"));

      const distractors = shuffle(pool.filter((e) => e !== it.en)).slice(0, 3);
      const options = shuffle([it.en, ...distractors]);
      const opts = el("div", { class: "quiz-options" });
      options.forEach((o) => {
        const btn = el("button", { class: "quiz-opt" }, o);
        btn.addEventListener("click", () => {
          if (opts.dataset.done) return;
          opts.dataset.done = "1";
          const correct = o === it.en;
          btn.classList.add(correct ? "correct" : "wrong");
          [...opts.children].forEach((c) => { if (c.textContent === it.en) c.classList.add("correct"); });
          if (correct) { state.score++; Gamify.award(4, "Listening"); }
          // reveal transcript
          const tr = el("div", { class: "listen-transcript" },
            el("div", { class: "lt-ru ru", "data-say": it.ru }, it.ru),
            it.tr ? el("div", { class: "lt-tr" }, it.tr) : null,
            el("div", { class: "lt-en gloss-en" }, it.en),
            it.ar ? el("div", { class: "lt-ar gloss-ar", dir: "rtl" }, it.ar) : null,
            starBtn({ id: "ls:" + it.id, ru: it.ru, en: it.en, ar: it.ar || "", tr: it.tr || "", type: "phrase", src: "Listening" }));
          card.append(tr);
          card.append(el("button", { class: "btn primary", style: "margin-top:14px", onclick: () => { state.i++; render(); } },
            state.i + 1 >= items.length ? "See results" : "Next →"));
        });
        opts.append(btn);
      });
      card.append(opts);
      host.append(card);
      // auto-play the clip when the question appears
      setTimeout(() => playClip(it), 250);
    }
    render();
  }

  renderPicker();
}

/* ---------------- analytics / progress dashboard ---------------- */
const CASE_NAMES = { nominative: "Nominative", genitive: "Genitive", dative: "Dative", accusative: "Accusative", instrumental: "Instrumental", prepositional: "Prepositional" };

// Mutually-exclusive flashcard memory buckets + due-today count.
async function analyticsSrs() {
  const cards = await masterCards();
  const srs = Store.loadSrs();
  const today = todayStr();
  let fresh = 0, learning = 0, mature = 0, due = 0;
  cards.forEach((c) => {
    const st = cardState(srs, c.id);
    const reps = st.reps || 0, interval = st.interval || 0;
    if (reps === 0) fresh++;
    else if (interval >= 21) mature++;
    else learning++;
    if (reps > 0 && st.due <= today) due++;
  });
  return { total: cards.length, fresh, learning, mature, due };
}

function buildCalendar(history, weeks) {
  const today = todayStr();
  const td = new Date(today + "T00:00:00");
  const dow = (td.getDay() + 6) % 7; // 0 = Monday
  const startMon = new Date(td);
  startMon.setDate(td.getDate() - dow - (weeks - 1) * 7);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(startMon);
      cur.setDate(startMon.getDate() + w * 7 + d);
      const ds = new Date(cur.getTime() - cur.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      col.push(ds > today ? null : { date: ds, xp: history[ds] || 0 });
    }
    cols.push(col);
  }
  return cols;
}
const xpTier = (xp) => (!xp ? 0 : xp < 10 ? 1 : xp < 30 ? 2 : xp < 60 ? 3 : 4);

function exportProgress() {
  const dump = {};
  Object.keys(localStorage).filter((k) => k.startsWith("ru_")).forEach((k) => {
    try { dump[k] = JSON.parse(localStorage.getItem(k)); } catch { dump[k] = localStorage.getItem(k); }
  });
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), app: "Русский от А до Я", data: dump }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: "russian-progress.json" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("📥 Exported", "russian-progress.json");
}

async function viewStats() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "📊 Progress & Analytics"),
    el("p", {}, "Your learning at a glance — all computed on this device from your own activity. Nothing leaves your phone.")));

  const g = Gamify.stats();
  const prog = Store.loadProg();
  const lessonsDone = Object.keys(prog.completed || {}).length;
  const activeDays = Object.keys(g.history || {}).filter((d) => g.history[d] > 0).length;
  const srs = await analyticsSrs();
  const favs = Favs.load().length;
  const cstore = Cases.load();
  const exam = (() => { try { return JSON.parse(localStorage.getItem("ru_exam")) || {}; } catch { return {}; } })();
  const ps = await pathState().catch(() => null);

  // ---- recommended next step ----
  let rec;
  if (srs.due > 0) rec = { icon: "🃏", title: `Review ${srs.due} card${srs.due > 1 ? "s" : ""} due today`, sub: "Spaced repetition keeps them in long-term memory", href: "#/flashcards" };
  if (!rec) {
    const weak = Object.keys(CASE_NAMES).map((id) => ({ id, m: Cases.mastery(id) })).filter((x) => x.m === null || x.m < 60).sort((a, b) => (a.m ?? -1) - (b.m ?? -1))[0];
    if (weak) rec = { icon: "🧩", title: `Practise the ${CASE_NAMES[weak.id]} case`, sub: weak.m === null ? "You haven't started this case yet" : `Currently ${weak.m}% mastery — aim for 60%+`, href: "#/cases" };
  }
  if (!rec && ps && ps.currentIdx >= 0) { const n = ps.flat[ps.currentIdx]; rec = { icon: "🗺️", title: `Continue the path: ${n.n.label}`, sub: n.unit.title.split("—").pop().trim(), href: "#/path" }; }
  if (!rec) { const lvl = ["A1","A2","B1","B2","C1","C2"].find((l) => (exam[l] || 0) < 80); rec = lvl ? { icon: "🎓", title: `Take the ${lvl} exam`, sub: exam[lvl] ? `Best so far ${exam[lvl]}% — beat it!` : "Test yourself at this level", href: "#/exam" } : { icon: "🎉", title: "You're flying — keep the streak alive!", sub: "Everything's on track", href: "#/path" }; }
  view.append(el("a", { class: "rec-card", href: rec.href },
    el("div", { class: "rec-ico" }, rec.icon),
    el("div", { class: "rec-body" }, el("div", { class: "rec-k" }, "Recommended next step"), el("div", { class: "rec-t" }, rec.title), el("div", { class: "rec-s" }, rec.sub)),
    el("div", { class: "rec-go" }, "Go →")));

  // ---- headline stats ----
  view.append(el("div", { class: "stat-grid" },
    statBox("Lv " + g.level, "Level · " + g.xp + " XP", "accent"),
    statBox(activeDays, "Active days", "green"),
    statBox(g.streak, "Current streak", ""),
    statBox(Math.max(g.longest || 0, g.streak), "Best streak", ""),
    statBox(lessonsDone, "Lessons done", "accent"),
    statBox(srs.mature, "Words mastered", "green"),
    statBox(prog.reviews || 0, "Total reviews", ""),
    statBox(favs, "Favorites", "red")));

  // ---- XP last 14 days ----
  const hist = g.history || {};
  const days14 = []; for (let i = 13; i >= 0; i--) { const ds = addDaysStr(-i); days14.push({ ds, xp: hist[ds] || 0 }); }
  const maxXp = Math.max(1, ...days14.map((d) => d.xp));
  const bars = el("div", { class: "xp-bars" });
  days14.forEach((d) => {
    const h = Math.round((d.xp / maxXp) * 100);
    bars.append(el("div", { class: "xp-col", title: `${d.ds}: ${d.xp} XP` },
      el("div", { class: "xp-bar-wrap" }, el("i", { class: d.xp ? "" : "empty", style: `height:${Math.max(d.xp ? 6 : 2, h)}%` })),
      el("span", { class: "xp-day" }, d.ds.slice(8))));
  });
  view.append(el("section", { class: "unit" }, el("h2", {}, "XP — last 14 days"), bars));

  // ---- study calendar heatmap ----
  const cal = buildCalendar(hist, 13);
  const heat = el("div", { class: "heatmap" });
  cal.forEach((col) => {
    const c = el("div", { class: "heat-col" });
    col.forEach((cell) => c.append(el("div", { class: "heat-cell t" + (cell ? xpTier(cell.xp) : 0) + (cell ? "" : " blank"), title: cell ? `${cell.date}: ${cell.xp} XP` : "" })));
    heat.append(c);
  });
  view.append(el("section", { class: "unit" },
    el("h2", {}, "Study calendar"),
    el("p", { class: "summary gloss-en", style: "margin-bottom:10px" }, "Each square is a day in the last 13 weeks; greener = more XP earned."),
    heat,
    el("div", { class: "heat-legend" }, "less ", el("span", { class: "heat-cell t0" }), el("span", { class: "heat-cell t1" }), el("span", { class: "heat-cell t2" }), el("span", { class: "heat-cell t3" }), el("span", { class: "heat-cell t4" }), " more")));

  // ---- cases accuracy (weakest first) ----
  const caseRows = Object.keys(CASE_NAMES).map((id) => {
    const m = cstore[id]; const total = m ? m.total : 0; const acc = total ? Math.round((m.correct / total) * 100) : null;
    return { id, name: CASE_NAMES[id], total, acc };
  }).sort((a, b) => (a.acc ?? -1) - (b.acc ?? -1));
  const casePanel = el("section", { class: "unit" }, el("h2", {}, "Case accuracy (weakest first)"));
  caseRows.forEach((r) => {
    const pct = r.acc ?? 0;
    casePanel.append(el("div", { class: "acc-row" },
      el("div", { class: "acc-name" }, r.name),
      el("div", { class: "acc-bar" }, el("i", { class: r.acc === null ? "none" : pct < 60 ? "low" : pct < 80 ? "mid" : "high", style: `width:${r.acc === null ? 0 : pct}%` })),
      el("div", { class: "acc-val" }, r.acc === null ? "—" : pct + "%"),
      el("div", { class: "acc-n" }, r.total ? r.total + " tries" : "not started")));
  });
  casePanel.append(el("a", { class: "resume-btn", href: "#/cases", style: "margin-top:8px" }, "🧩 Train cases"));
  view.append(casePanel);

  // ---- flashcard memory breakdown ----
  const segs = [["New", srs.fresh, "seg-new"], ["Learning", srs.learning, "seg-learn"], ["Mature", srs.mature, "seg-mature"]];
  const tot = Math.max(1, srs.total);
  const segbar = el("div", { class: "seg-bar" });
  segs.forEach(([lbl, n, cls]) => { if (n) segbar.append(el("div", { class: "seg " + cls, style: `flex:${n}`, title: `${lbl}: ${n}` })); });
  view.append(el("section", { class: "unit" },
    el("h2", {}, "Flashcard memory — " + srs.total + " words"),
    segbar,
    el("div", { class: "seg-legend" },
      el("span", {}, el("i", { class: "dot seg-new" }), ` New ${srs.fresh}`),
      el("span", {}, el("i", { class: "dot seg-learn" }), ` Learning ${srs.learning}`),
      el("span", {}, el("i", { class: "dot seg-mature" }), ` Mature ${srs.mature}`),
      el("span", {}, `🔔 ${srs.due} due now`))));

  // ---- exam scores ----
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const examPanel = el("section", { class: "unit" }, el("h2", {}, "CEFR exam best scores"));
  levels.forEach((l) => {
    const best = exam[l] || 0;
    examPanel.append(el("div", { class: "acc-row" },
      el("div", { class: "acc-name" }, l),
      el("div", { class: "acc-bar" }, el("i", { class: best === 0 ? "none" : best < 60 ? "low" : best < 80 ? "mid" : "high", style: `width:${best}%` })),
      el("div", { class: "acc-val" }, best ? best + "%" : "—")));
  });
  examPanel.append(el("a", { class: "resume-btn", href: "#/exam", style: "margin-top:8px" }, "🎓 Take an exam"));
  view.append(examPanel);

  // ---- export ----
  const exp = el("button", { class: "ghost-btn", style: "width:auto;padding:11px 18px" }, "📥 Export my progress (JSON)");
  exp.addEventListener("click", exportProgress);
  view.append(el("section", { class: "unit" },
    el("h2", {}, "Your data"),
    el("p", { class: "summary gloss-en", style: "margin-bottom:12px" }, "Everything here lives only in this browser. Export a backup you can keep or move to another device."),
    exp));
}

/* ---------------- flashcards ---------------- */
async function viewFlashcards() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🃏 Flashcards"), el("p", {}, "Spaced repetition with the SM-2 algorithm. Rate honestly — the schedule adapts to you. Progress is saved on this device.")));
  const decks = await srsDecks();
  const stage = el("div", { class: "fc-stage" });
  view.append(stage);

  const state = { deck: "all", queue: [], idx: 0 };

  const pills = el("div", { class: "deck-pills" });
  const totalDue = decks.reduce((a, d) => a + (d.due || 0), 0);
  const mkPill = (id, label, due) => {
    const p = el("button", { class: "deck-pill" + (state.deck === id ? " active" : "") }, label, el("span", { class: "cnt" }, String(due)));
    p.addEventListener("click", () => {
      state.deck = id;
      [...pills.children].forEach((x) => x.classList.remove("active"));
      p.classList.add("active");
      startSession();
    });
    return p;
  };
  pills.append(mkPill("all", "All decks", totalDue));
  decks.forEach((d) => pills.append(mkPill(d.deck, prettyDeck(d.deck), d.due || 0)));
  stage.append(pills);

  const cardHost = el("div", {});
  stage.append(cardHost);

  async function startSession() {
    state.queue = await srsDue(state.deck, 30);
    state.idx = 0;
    renderCard();
  }

  function renderCard() {
    cardHost.innerHTML = "";
    if (state.idx >= state.queue.length) {
      cardHost.append(
        el("div", { class: "fc-empty" },
          el("div", { class: "big-emoji" }, "🎉"),
          el("h2", {}, state.queue.length ? "Session complete!" : "Nothing due right now"),
          el("p", {}, state.queue.length ? "You reviewed " + state.queue.length + " card(s). Come back tomorrow for more." : "All caught up in this deck. Try another, or come back later."))
      );
      renderNav();
      return;
    }
    const card = state.queue[state.idx];
    const host = el("div", {});
    host.append(el("div", { class: "fc-meta" }, `${state.idx + 1} / ${state.queue.length} · ${prettyDeck(card.deck)}`));

    const fc = el("div", { class: "flashcard" });
    fc.append(el("div", { class: "fc-front ru", "data-say": card.front }, card.front));
    if (card.pos) fc.append(el("div", { class: "fc-pos" }, card.pos));

    const back = el("div", { style: "display:none" });
    back.append(el("div", { class: "fc-divider" }));
    back.append(el("div", { class: "fc-back gloss-en" }, card.back));
    if (card.ar) back.append(el("div", { class: "fc-ar gloss-ar", dir: "rtl" }, card.ar));
    if (card.tr) back.append(el("div", { class: "fc-tr" }, card.tr));
    if (card.example) back.append(el("div", { class: "fc-ex" }, card.example));
    back.append(el("div", { class: "fc-fav" }, starBtn({ id: card.id, ru: card.front, en: card.back, ar: card.ar, tr: card.tr, type: "word", src: prettyDeck(card.deck) })));
    fc.append(back);
    host.append(fc);

    const controls = el("div", { class: "fc-controls" });
    const showBtn = el("button", { class: "btn primary big" }, "Show answer");
    showBtn.addEventListener("click", () => {
      back.style.display = "block";
      speak(card.front);
      controls.innerHTML = "";
      controls.append(
        rateBtn("Again", 1, "btn-again", card),
        rateBtn("Hard", 3, "btn-hard", card),
        rateBtn("Good", 4, "btn-good", card),
        rateBtn("Easy", 5, "btn-easy", card)
      );
    });
    controls.append(showBtn);
    host.append(controls);
    cardHost.append(host);
  }

  function rateBtn(label, quality, cls, card) {
    const b = el("button", { class: "btn " + cls }, label);
    b.addEventListener("click", () => {
      srsReview(card.id, quality);
      Gamify.award(quality >= 4 ? 3 : 1, "Flashcard reviewed");
      state.idx++;
      renderCard();
    });
    return b;
  }

  startSession();
}

const prettyDeck = (id) =>
  String(id).replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/* ---------------- practice quiz ---------------- */
async function viewPractice() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🎯 Practice quiz"), el("p", {}, "Multiple-choice recall drills drawn from the vocabulary decks.")));

  const vocab = await loadContent("vocabulary");
  const allCards = (vocab.decks || []).flatMap((d) => d.cards.map((c) => ({ ...c, deck: d.id })));
  const stage = el("div", { class: "quiz-stage" });
  view.append(stage);

  const state = { mode: "ru2en", deck: "all", score: 0, asked: 0, total: 10 };

  const modePills = el("div", { class: "quiz-mode-pills" });
  const mkMode = (id, label) => {
    const p = el("button", { class: "deck-pill" + (state.mode === id ? " active" : "") }, label);
    p.addEventListener("click", () => { state.mode = id; [...modePills.children].forEach((x) => x.classList.remove("active")); p.classList.add("active"); newRound(); });
    return p;
  };
  modePills.append(mkMode("ru2en", "Russian → English"), mkMode("en2ru", "English → Russian"));

  const deckSel = el("select", { class: "dropdown" });
  deckSel.append(el("option", { value: "all" }, "All decks"));
  (vocab.decks || []).forEach((d) => deckSel.append(el("option", { value: d.id }, prettyDeck(d.id))));
  deckSel.addEventListener("change", () => { state.deck = deckSel.value; newRound(); });

  stage.append(el("div", { class: "toolbar" }, modePills, deckSel));
  const host = el("div", {});
  stage.append(host);

  const pool = () => (state.deck === "all" ? allCards : allCards.filter((c) => c.deck === state.deck));
  function sample(arr, n, exclude) {
    const out = [];
    const copy = arr.filter((x) => x !== exclude);
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }

  function newRound() { state.score = 0; state.asked = 0; nextQuestion(); }

  function nextQuestion() {
    const p = pool();
    if (state.asked >= state.total || p.length < 4) {
      host.innerHTML = "";
      host.append(
        el("div", { class: "quiz-card" },
          el("h2", { style: "font-family:'PT Serif',serif" }, "Round complete"),
          el("p", { style: "font-size:34px;margin:14px 0" }, `${state.score} / ${state.asked}`),
          el("button", { class: "btn primary big", onclick: newRound }, "Play again"))
      );
      return;
    }
    const answer = p[Math.floor(Math.random() * p.length)];
    const distractors = sample(p, 3, answer);
    const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
    const promptIsRu = state.mode === "ru2en";
    const prompt = promptIsRu ? answer.ru : answer.en;

    host.innerHTML = "";
    const card = el("div", { class: "quiz-card" });
    card.append(el("div", { class: "quiz-bar" },
      el("span", {}, `Question ${state.asked + 1} of ${state.total}`),
      el("span", {}, `Score: ${state.score}`)));
    card.append(el("div", { class: "quiz-q" }, promptIsRu ? "What does this mean?" : "How do you say this?"));
    const promptEl = el("div", { class: "quiz-prompt" + (promptIsRu ? " ru" : "") }, prompt);
    if (promptIsRu) { promptEl.dataset.say = answer.ru; speak(answer.ru); }
    card.append(promptEl);

    const opts = el("div", { class: "quiz-options" });
    options.forEach((o) => {
      const label = promptIsRu ? o.en : o.ru;
      const btn = el("button", { class: "quiz-opt" + (state.mode === "en2ru" ? " ru" : "") }, label);
      if (state.mode === "en2ru") btn.dataset.say = o.ru;
      btn.addEventListener("click", () => {
        if (btn.dataset.answered) return;
        [...opts.children].forEach((c) => (c.dataset.answered = "1"));
        const correct = o === answer;
        btn.classList.add(correct ? "correct" : "wrong");
        if (!correct) [...opts.children][options.indexOf(answer)].classList.add("correct");
        else { state.score++; Gamify.award(2, "Quiz answer"); }
        state.asked++;
        if (state.mode === "en2ru") speak(answer.ru);
        setTimeout(nextQuestion, correct ? 750 : 1500);
      });
      opts.append(btn);
    });
    card.append(opts);
    host.append(card);
  }

  newRound();
}

/* ---------------- verb trainer ---------------- */
const normRu = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ё/g, "е").trim();

async function viewVerbs() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🔁 Verb trainer"),
    el("p", {}, "Browse conjugation tables for common verbs, or drill yourself on the present tense.")));
  const data = await loadContent("verbs");
  const verbs = data.verbs || [];
  const stage = el("div", {});
  view.append(stage);

  const pills = el("div", { class: "quiz-mode-pills" });
  const browseBtn = el("button", { class: "deck-pill active" }, "📖 Browse");
  const drillBtn = el("button", { class: "deck-pill" }, "✏️ Drill");
  pills.append(browseBtn, drillBtn);
  stage.append(pills);
  const host = el("div", {});
  stage.append(host);

  browseBtn.addEventListener("click", () => { browseBtn.classList.add("active"); drillBtn.classList.remove("active"); renderBrowse(); });
  drillBtn.addEventListener("click", () => { drillBtn.classList.add("active"); browseBtn.classList.remove("active"); renderDrill(); });

  function tenseTable(v) {
    const forms = v.present || v.future || {};
    const label = v.present ? "Present" : "Future";
    const rows = Object.entries(forms).map(([k, val]) => [k, `<span class="rucell">${val}</span>`]);
    return { label, rows };
  }

  function renderBrowse() {
    host.innerHTML = "";
    verbs.forEach((v) => {
      const card = el("section", { class: "unit" });
      const h = el("div", { class: "unit-head" },
        el("div", {},
          el("h2", {}, ru(v.inf)),
          el("p", { class: "summary gloss-en" }, `${v.en}${v.pair && v.pair !== "—" ? "  ·  pf. " + v.pair : ""}`),
          v.ar ? el("p", { class: "summary summary-ar gloss-ar", dir: "rtl" }, v.ar) : null));
      card.append(h);
      const t = tenseTable(v);
      card.append(blockTable(t.label, ["Pronoun", t.label], t.rows));
      if (v.past) card.append(blockTable("Past", ["Gender / number", "Form"],
        Object.entries(v.past).map(([k, val]) => [k, `<span class="rucell">${val}</span>`])));
      if (v.imperative) card.append(blockTable("Imperative", ["", "Form"],
        Object.entries(v.imperative).map(([k, val]) => [k, `<span class="rucell">${val}</span>`])));
      host.append(card);
    });
    // make Russian cells clickable for audio
    host.querySelectorAll(".rucell").forEach((c) => { c.classList.add("ru"); c.dataset.say = c.textContent; });
  }

  function blockTable(cap, headers, rows) {
    return renderBlock({ type: "table", caption: cap, headers, rows });
  }

  function renderDrill() {
    const state = { score: 0, asked: 0, total: 12, cur: null };
    function next() {
      host.innerHTML = "";
      if (state.asked >= state.total) {
        host.append(el("div", { class: "quiz-card" },
          el("h2", { style: "font-family:'PT Serif',serif" }, "Drill complete"),
          el("p", { style: "font-size:32px;margin:12px 0" }, `${state.score} / ${state.asked}`),
          el("button", { class: "btn primary big", onclick: renderDrill }, "Again")));
        return;
      }
      const v = verbs[Math.floor(Math.random() * verbs.length)];
      const forms = v.present || v.future || {};
      const keys = Object.keys(forms);
      const key = keys[Math.floor(Math.random() * keys.length)];
      state.cur = { v, key, answer: forms[key] };

      const card = el("div", { class: "quiz-card" });
      card.append(el("div", { class: "quiz-bar" },
        el("span", {}, `${state.asked + 1} / ${state.total}`), el("span", {}, `Score: ${state.score}`)));
      card.append(el("div", { class: "quiz-q" }, `Conjugate — ${v.present ? "present" : "future"} tense`));
      card.append(el("div", { class: "quiz-prompt" }, el("span", { class: "ru", "data-say": v.inf }, v.inf), el("span", { style: "color:var(--muted)" }, `  →  ${key} …`)));
      const input = el("input", { class: "text-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "type the form…" });
      const feedback = el("div", { class: "drill-feedback" });
      const submit = el("button", { class: "btn primary", style: "margin-top:12px" }, "Check");
      const check = () => {
        if (submit.dataset.done) { next(); return; }
        const ok = normRu(input.value) === normRu(state.cur.answer);
        if (ok) { state.score++; Gamify.award(2, "Verb drill"); }
        feedback.innerHTML = ok
          ? `<span class="ok">✓ Correct</span>`
          : `<span class="bad">✗ ${state.cur.answer}</span>`;
        speak(state.cur.answer);
        input.disabled = true;
        state.asked++;
        submit.textContent = "Next →";
        submit.dataset.done = "1";
      };
      submit.addEventListener("click", check);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
      card.append(input, submit, feedback, attachKeyboard(input));
      host.append(card);
      input.focus();
    }
    next();
  }

  renderBrowse();
}

/* ---------------- on-screen Cyrillic keyboard ---------------- */
const CYR_ROWS = ["й ц у к е н г ш щ з х ъ", "ф ы в а п р о л д ж э", "я ч с м и т ь б ю ё"];
function attachKeyboard(input) {
  const wrap = el("div", { class: "cyr-kb", style: "display:none" });
  const edit = (fn) => {
    if (input.disabled) return;
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? input.value.length;
    fn(s, e);
    input.focus();
  };
  const insert = (ch) => edit((s, e) => {
    input.value = input.value.slice(0, s) + ch + input.value.slice(e);
    const pos = s + ch.length; input.setSelectionRange(pos, pos);
  });
  CYR_ROWS.forEach((row) => {
    const r = el("div", { class: "cyr-row" });
    row.split(" ").forEach((ch) => {
      const k = el("button", { class: "cyr-key", type: "button" }, ch);
      k.addEventListener("click", (ev) => { ev.preventDefault(); insert(ch); });
      r.append(k);
    });
    wrap.append(r);
  });
  const space = el("button", { class: "cyr-key wide", type: "button" }, "␣ пробел");
  space.addEventListener("click", (ev) => { ev.preventDefault(); insert(" "); });
  const back = el("button", { class: "cyr-key", type: "button" }, "⌫");
  back.addEventListener("click", (ev) => { ev.preventDefault(); edit((s, e) => {
    if (s === e && s > 0) { input.value = input.value.slice(0, s - 1) + input.value.slice(e); input.setSelectionRange(s - 1, s - 1); }
    else { input.value = input.value.slice(0, s) + input.value.slice(e); input.setSelectionRange(s, s); }
  }); });
  wrap.append(el("div", { class: "cyr-row" }, space, back));

  const toggle = el("button", { class: "kb-toggle", type: "button" }, "⌨️ Cyrillic keyboard");
  toggle.addEventListener("click", () => {
    const show = wrap.style.display === "none";
    wrap.style.display = show ? "flex" : "none";
    toggle.classList.toggle("on", show);
  });
  return el("div", { class: "kb-wrap" }, toggle, wrap);
}

/* ---------------- listening / dictation ---------------- */
async function viewDictation() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "✍️ Listening dictation"),
    el("p", {}, "Listen to a Russian word and type what you hear (stress marks optional). Trains your Cyrillic spelling and ear.")));
  const cards = await masterCards();
  if (!cards.length) { view.append(el("div", { class: "fc-empty" }, "No words available.")); return; }

  const stage = el("div", { class: "quiz-stage" });
  view.append(stage);
  const host = el("div", {});
  stage.append(host);
  const state = { score: 0, asked: 0, total: 12, cur: null };

  function next() {
    host.innerHTML = "";
    if (state.asked >= state.total) {
      host.append(el("div", { class: "quiz-card" },
        el("h2", { style: "font-family:'PT Serif',serif" }, "Round complete"),
        el("p", { style: "font-size:32px;margin:12px 0" }, `${state.score} / ${state.asked}`),
        el("button", { class: "btn primary big", onclick: () => { state.score = 0; state.asked = 0; next(); } }, "Again")));
      return;
    }
    state.cur = cards[Math.floor(Math.random() * cards.length)];
    speak(state.cur.front);

    const card = el("div", { class: "quiz-card" });
    card.append(el("div", { class: "quiz-bar" },
      el("span", {}, `${state.asked + 1} / ${state.total}`), el("span", {}, `Score: ${state.score}`)));
    const playBtn = el("button", { class: "btn", style: "background:var(--panel-2);color:var(--text);margin-bottom:14px" }, "🔊 Play again");
    playBtn.addEventListener("click", () => speak(state.cur.front));
    card.append(playBtn);
    const input = el("input", { class: "text-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "type what you hear…", dir: "ltr" });
    const feedback = el("div", { class: "drill-feedback" });
    const submit = el("button", { class: "btn primary", style: "margin-top:12px" }, "Check");
    const check = () => {
      if (submit.dataset.done) { next(); return; }
      const ok = normRu(input.value) === normRu(state.cur.front);
      if (ok) { state.score++; Gamify.award(3, "Dictation"); }
      feedback.innerHTML = ok
        ? `<span class="ok">✓ ${state.cur.front}</span>`
        : `<span class="bad">✗ correct: ${state.cur.front}</span>`;
      feedback.append(el("div", { class: "gloss-en", style: "color:var(--muted);font-size:14px;margin-top:4px" }, state.cur.back));
      if (state.cur.ar) feedback.append(el("div", { class: "gloss-ar", dir: "rtl", style: "color:var(--accent-2);margin-top:2px" }, state.cur.ar));
      input.disabled = true;
      state.asked++;
      submit.textContent = "Next →";
      submit.dataset.done = "1";
    };
    submit.addEventListener("click", check);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    card.append(input, submit, feedback, attachKeyboard(input));
    host.append(card);
    input.focus();
  }
  next();
}

/* ---------------- pronunciation (speech recognition) ---------------- */
function getRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "ru-RU";
  r.interimResults = false;
  r.maxAlternatives = 5;
  return r;
}

async function viewPronounce() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🎤 Pronunciation"),
    el("p", {}, "See a word, tap the mic and say it aloud — the app checks what it heard. Works best in Chrome / Android Chrome.")));
  const stage = el("div", { class: "quiz-stage" });
  view.append(stage);

  if (!getRecognizer()) {
    stage.append(el("div", { class: "fc-empty" },
      el("div", { class: "big-emoji" }, "🙉"),
      el("p", {}, "Your browser doesn't support speech recognition. Try Google Chrome (desktop or Android) for this feature. You can still use the 🔊 audio everywhere else.")));
    return;
  }

  const cards = await masterCards();
  const state = { score: 0, asked: 0, total: 10, cur: null };
  const host = el("div", {});
  stage.append(host);

  function next() {
    host.innerHTML = "";
    if (state.asked >= state.total) {
      host.append(el("div", { class: "quiz-card" },
        el("h2", { style: "font-family:'PT Serif',serif" }, "Session complete"),
        el("p", { style: "font-size:32px;margin:12px 0" }, `${state.score} / ${state.asked}`),
        el("button", { class: "btn primary big", onclick: () => { state.score = 0; state.asked = 0; next(); } }, "Again")));
      return;
    }
    state.cur = cards[Math.floor(Math.random() * cards.length)];
    const card = el("div", { class: "quiz-card", style: "text-align:center" });
    card.append(el("div", { class: "quiz-bar" }, el("span", {}, `${state.asked + 1} / ${state.total}`), el("span", {}, `Score: ${state.score}`)));
    card.append(el("div", { class: "fc-front ru", style: "font-size:40px", "data-say": state.cur.front }, state.cur.front));
    if (state.cur.tr) card.append(el("div", { class: "fc-tr", style: "margin-bottom:6px" }, state.cur.tr));
    card.append(el("div", { class: "gloss-en", style: "color:var(--muted)" }, state.cur.back));
    const mic = el("button", { class: "btn primary big", style: "margin-top:18px" }, "🎤 Tap & speak");
    const fb = el("div", { class: "drill-feedback" });
    card.append(mic, fb);
    host.append(card);

    mic.addEventListener("click", () => {
      const rec = getRecognizer();
      if (!rec) return;
      mic.textContent = "🎙️ Listening…";
      mic.disabled = true;
      fb.innerHTML = "";
      rec.onresult = (e) => {
        const heard = Array.from(e.results[0]).map((r) => r.transcript);
        const ok = heard.some((h) => normRu(h) === normRu(state.cur.front));
        if (ok) { state.score++; Gamify.award(3, "Pronunciation"); }
        fb.innerHTML = ok
          ? `<span class="ok">✓ Heard “${heard[0]}”</span>`
          : `<span class="bad">✗ Heard “${heard[0] || "—"}” — target: ${state.cur.front}</span>`;
        speak(state.cur.front);
        state.asked++;
        mic.textContent = "Next →";
        mic.disabled = false;
        mic.onclick = next;
      };
      rec.onerror = (ev) => {
        fb.innerHTML = `<span class="bad">Mic error (${ev.error}). Check microphone permission and try again.</span>`;
        mic.textContent = "🎤 Tap & speak";
        mic.disabled = false;
      };
      rec.onend = () => { if (mic.textContent === "🎙️ Listening…") { mic.textContent = "🎤 Tap & speak"; mic.disabled = false; } };
      try { rec.start(); } catch { mic.textContent = "🎤 Tap & speak"; mic.disabled = false; }
    });
  }
  next();
}

/* ---------------- A1–C2 exams ---------------- */
function shuffle(a) { return a.slice().sort(() => Math.random() - 0.5); }

async function viewExam() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🎓 Exams (A1–C2)"),
    el("p", {}, "Pick a level for a mixed test — translation, conjugation and grammar. Your best score per level is saved.")));
  const [exam, vocab, verbsData] = [await loadContent("exam"), await loadContent("vocabulary"), await loadContent("verbs")];
  const best = (() => { try { return JSON.parse(localStorage.getItem("ru_exam")) || {}; } catch { return {}; } })();
  const stage = el("div", { class: "quiz-stage" });
  view.append(stage);
  const host = el("div", {});

  const pills = el("div", { class: "deck-pills" });
  exam.levels.forEach((lv) => {
    const b = best[lv.id] ? ` · best ${best[lv.id]}%` : "";
    const p = el("button", { class: "deck-pill" }, lv.title.split("—")[0].trim(), el("span", { class: "cnt" }, b || "—"));
    p.addEventListener("click", () => startExam(lv));
    pills.append(p);
  });
  stage.append(pills, host);

  function buildQuestions(lv) {
    const qs = [];
    // curated grammar MCQ
    (lv.mcq || []).forEach((m) => qs.push({ prompt: m.q, options: m.options, answer: m.options[m.answer], explain: m.explain }));
    // vocab translation MCQ from the level's decks
    const pool = (vocab.decks || []).filter((d) => (lv.decks || []).includes(d.id)).flatMap((d) => d.cards);
    const vcount = Math.max(0, 14 - qs.length - (lv.verbs ? 3 : 0));
    shuffle(pool).slice(0, vcount).forEach((card) => {
      const distractors = shuffle(pool.filter((c) => c !== card)).slice(0, 3).map((c) => c.en);
      qs.push({ prompt: `What does “${card.ru}” mean?`, ru: card.ru, options: shuffle([card.en, ...distractors]), answer: card.en, explain: card.example || "" });
    });
    // verb conjugation MCQ
    if (lv.verbs) {
      shuffle(verbsData.verbs).slice(0, 3).forEach((v) => {
        const forms = v.present || v.future || {};
        const keys = Object.keys(forms);
        const key = keys[Math.floor(Math.random() * keys.length)];
        const others = shuffle(verbsData.verbs.flatMap((x) => Object.values(x.present || x.future || {})).filter((f) => f !== forms[key])).slice(0, 3);
        qs.push({ prompt: `Conjugate ${v.inf} (${v.en}) — ${key}:`, options: shuffle([forms[key], ...others]), answer: forms[key], explain: "" });
      });
    }
    return shuffle(qs).slice(0, 14);
  }

  function startExam(lv) {
    const qs = buildQuestions(lv);
    const state = { i: 0, score: 0 };
    function render() {
      host.innerHTML = "";
      if (state.i >= qs.length) {
        const pct = Math.round((state.score / qs.length) * 100);
        best[lv.id] = Math.max(best[lv.id] || 0, pct);
        localStorage.setItem("ru_exam", JSON.stringify(best));
        Gamify.award(10 + Math.round(pct / 5), `Exam ${lv.id} (${pct}%)`);
        const verdict = pct >= 80 ? "Excellent — you've got this level. 🎉" : pct >= 60 ? "Good — a bit more practice will solidify it." : "Keep practising this level's vocabulary and grammar.";
        host.append(el("div", { class: "quiz-card" },
          el("h2", { style: "font-family:'PT Serif',serif" }, `${lv.title}`),
          el("p", { style: "font-size:34px;margin:12px 0" }, `${state.score} / ${qs.length}  (${pct}%)`),
          el("p", { style: "color:var(--muted)" }, verdict),
          el("button", { class: "btn primary big", style: "margin-top:10px", onclick: () => startExam(lv) }, "Retake")));
        renderNav();
        return;
      }
      const q = qs[state.i];
      const card = el("div", { class: "quiz-card" });
      card.append(el("div", { class: "quiz-bar" }, el("span", {}, `${lv.title.split("—")[0].trim()} · Q${state.i + 1}/${qs.length}`), el("span", {}, `Score: ${state.score}`)));
      card.append(el("div", { class: "quiz-prompt" + (q.ru ? " ru" : ""), "data-say": q.ru || "" }, q.prompt));
      const opts = el("div", { class: "quiz-options" });
      q.options.forEach((o) => {
        const btn = el("button", { class: "quiz-opt" }, o);
        btn.addEventListener("click", () => {
          if (opts.dataset.done) return;
          opts.dataset.done = "1";
          const correct = o === q.answer;
          if (correct) state.score++;
          btn.classList.add(correct ? "correct" : "wrong");
          [...opts.children].forEach((c) => { if (c.textContent === q.answer) c.classList.add("correct"); });
          if (q.explain) card.append(el("div", { class: "note", style: "margin-top:14px" }, q.explain));
          card.append(el("button", { class: "btn primary", style: "margin-top:14px", onclick: () => { state.i++; render(); } }, state.i + 1 >= qs.length ? "See results" : "Next →"));
        });
        opts.append(btn);
      });
      card.append(opts);
      host.append(card);
    }
    render();
  }
}

/* ---------------- learning path (Duolingo-style) ---------------- */
const NODE_ICON = { lesson: "📖", flashcards: "🃏", cases: "🧩", exam: "🎓", checkpoint: "🏆" };
const NODE_ROUTE = {
  lesson: (n) => `#/section/${n.section}/${n.unit}`,
  flashcards: () => "#/flashcards",
  cases: () => "#/cases",
  exam: () => "#/exam",
  checkpoint: () => null,
};

// Shared path computation: gating + done-state from real progress signals.
async function pathState() {
  const data = await loadContent("path");
  const completed = (Store.loadProg().completed) || {};
  const exam = (() => { try { return JSON.parse(localStorage.getItem("ru_exam")) || {}; } catch { return {}; } })();
  const deckStats = {};
  (await srsDecks()).forEach((d) => (deckStats[d.deck] = d));
  const isDone = (n) => {
    switch (n.kind) {
      case "lesson": return !!completed[`${n.section}:${n.unit}`];
      case "flashcards": { const d = deckStats[n.deck]; return d && d.total ? d.started / d.total >= 0.6 : false; }
      case "cases": return (Cases.mastery(n.case) || 0) >= 60;
      case "exam": return (exam[n.level] || 0) >= 60;
      default: return false;
    }
  };
  const flat = [];
  data.units.forEach((u) => u.nodes.forEach((n) => flat.push({ n, unit: u })));
  let runningAllDone = true;
  flat.forEach((row) => {
    row.done = row.n.kind === "checkpoint" ? runningAllDone : isDone(row.n);
    if (!row.done) runningAllDone = false;
  });
  flat.forEach((row, i) => { row.unlocked = i === 0 || flat[i - 1].done || row.done; });
  // Crown level 0–5 (Duolingo-style): graded mastery you raise by practising again.
  const crownOf = (n) => {
    switch (n.kind) {
      case "cases": return Math.min(5, Math.floor((Cases.mastery(n.case) || 0) / 20));
      case "exam": return Math.min(5, Math.floor((exam[n.level] || 0) / 20));
      case "flashcards": { const d = deckStats[n.deck]; return d && d.total ? Math.min(5, Math.floor((d.started / d.total) * 5)) : 0; }
      case "lesson": return row_done_lesson(n) ? 1 : 0;
      default: return 0;
    }
  };
  function row_done_lesson(n) { return !!completed[`${n.section}:${n.unit}`]; }
  const crownCap = (k) => (k === "cases" || k === "exam" || k === "flashcards") ? 5 : 1;
  flat.forEach((row) => { row.crown = row.n.kind === "checkpoint" ? (row.done ? 1 : 0) : crownOf(row.n); });
  const currentIdx = flat.findIndex((r) => r.unlocked && !r.done);
  const doneCount = flat.filter((r) => r.n.kind !== "checkpoint" && r.done).length;
  const totalSteps = flat.filter((r) => r.n.kind !== "checkpoint").length;
  const totalCrowns = flat.reduce((a, r) => a + (r.crown || 0), 0);
  const maxCrowns = flat.reduce((a, r) => a + crownCap(r.n.kind), 0);
  return { units: data.units, flat, currentIdx, doneCount, totalSteps, totalCrowns, maxCrowns };
}

async function viewPath() {
  const view = $("#view");
  view.innerHTML = "";
  const { units, flat, currentIdx, doneCount, totalSteps, totalCrowns, maxCrowns } = await pathState();

  view.append(el("div", { class: "page-head" }, el("h1", {}, "🗺️ Learning Path"),
    el("p", {}, "Follow the path from the alphabet to academic Russian. Finish each step to light up the next, then practise again to earn up to 👑×5 crowns per skill. Progress reflects your real work across the app.")));

  // overall progress bar + crown total
  const pct = totalSteps ? Math.round((doneCount / totalSteps) * 100) : 0;
  view.append(el("div", { class: "path-progress" },
    el("div", { class: "pp-bar" }, el("i", { style: `width:${pct}%` })),
    el("div", { class: "pp-label" }, `${doneCount} / ${totalSteps} steps · ${pct}%`),
    el("div", { class: "pp-crowns" }, "👑 " + totalCrowns + " / " + maxCrowns)));

  const wrap = el("div", { class: "path-wrap" });
  let gi = -1; // global node index across units
  units.forEach((u) => {
    const unitDone = u.nodes.every((nn) => flat[flat.findIndex((f) => f.n === nn)].done);
    const banner = el("div", { class: "path-unit-banner" + (unitDone ? " done" : ""), style: `--uc:${u.color}` },
      el("div", { class: "pub-title" }, u.title),
      el("div", { class: "pub-sub" }, u.subtitle));
    wrap.append(banner);
    const track = el("div", { class: "path-track" });
    u.nodes.forEach((n, idxInUnit) => {
      gi++;
      const row = flat[gi];
      const isCurrent = gi === currentIdx;
      const state = row.done ? "done" : row.unlocked ? (isCurrent ? "current" : "open") : "locked";
      const gradable = n.kind === "cases" || n.kind === "exam" || n.kind === "flashcards";
      const gilded = gradable && row.crown >= 5;
      // zigzag offset for the winding-path look
      const off = [0, 1, 2, 1, -1, -2, -1][idxInUnit % 7];
      const node = el("button", {
        class: `path-node ${state} kind-${n.kind}` + (gilded ? " gilded" : ""),
        style: `--uc:${u.color}; --off:${off}`,
        title: n.label + (state === "locked" ? " (locked)" : gradable ? ` — crown ${row.crown}/5 (practise to level up)` : ""),
      },
        el("span", { class: "pn-ico" }, row.done ? (n.kind === "checkpoint" ? "🏆" : "✓") : state === "locked" ? "🔒" : NODE_ICON[n.kind]),
        (gradable && row.crown > 0) ? el("span", { class: "pn-crown" }, "👑" + row.crown) : null,
        isCurrent ? el("span", { class: "pn-start" }, "START") : null);
      const label = el("div", { class: "pn-label" }, n.label);
      const cell = el("div", { class: "path-cell", style: `--off:${off}` }, node, label);
      node.addEventListener("click", () => {
        if (state === "locked") { showToast("🔒 Locked", "Finish the step before it first"); return; }
        const r = NODE_ROUTE[n.kind] && NODE_ROUTE[n.kind](n);
        if (r) location.hash = r;
        else showToast("🏆 Checkpoint", row.done ? "Unit complete — great work!" : "Finish this unit's steps to claim it");
      });
      track.append(cell);
    });
    wrap.append(track);
  });
  view.append(wrap);
}

/* ---------------- cases trainer ---------------- */
const Cases = {
  KEY: "ru_cases_v1",
  MISS: "ru_cases_mistakes",
  load() { try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch { return {}; } },
  save(s) { localStorage.setItem(this.KEY, JSON.stringify(s)); },
  record(caseId, ok) {
    const s = this.load();
    const m = (s[caseId] = s[caseId] || { correct: 0, total: 0 });
    m.total++; if (ok) m.correct++;
    this.save(s);
  },
  mastery(caseId) { const m = this.load()[caseId]; return m && m.total ? Math.round((m.correct / m.total) * 100) : null; },
  totalCorrect() { return Object.values(this.load()).reduce((a, m) => a + (m.correct || 0), 0); },
  loadMiss() { try { return JSON.parse(localStorage.getItem(this.MISS)) || []; } catch { return []; } },
  saveMiss(a) { localStorage.setItem(this.MISS, JSON.stringify([...new Set(a)])); },
  addMiss(id) { const a = this.loadMiss(); a.push(id); this.saveMiss(a); },
  clearMiss(id) { this.saveMiss(this.loadMiss().filter((x) => x !== id)); },
};

async function viewCases() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🧩 Cases Trainer"),
    el("p", {}, "The six Russian cases are the heart of the grammar. Drill them in real sentences — choose a case or go Mixed, then pick the correct form.")));
  const data = await loadContent("cases");
  const metas = data.cases || [];
  const drills = data.drills || [];
  const stage = el("div", { class: "quiz-stage", style: "max-width:640px" });
  view.append(stage);

  const metaById = Object.fromEntries(metas.map((m) => [m.id, m]));
  const pills = el("div", { class: "deck-pills" });
  const host = el("div", {});
  stage.append(pills, host);

  function renderPicker() {
    pills.innerHTML = "";
    host.innerHTML = "";
    const mkPill = (label, sub, onClick, cls) => {
      const p = el("button", { class: "deck-pill" + (cls ? " " + cls : "") }, label, sub != null ? el("span", { class: "cnt" }, sub) : null);
      p.addEventListener("click", onClick);
      return p;
    };
    pills.append(mkPill("🎲 Mixed", "all", () => startSession(drills, "Mixed")));
    metas.forEach((m) => {
      const mas = Cases.mastery(m.id);
      pills.append(mkPill(m.name, mas == null ? "—" : mas + "%", () => startSession(drills.filter((d) => d.case === m.id), m.name)));
    });
    const miss = Cases.loadMiss();
    if (miss.length) {
      pills.append(mkPill("⚠️ Review mistakes", String(miss.length), () => {
        const set = new Set(miss);
        startSession(drills.filter((d) => set.has(d.id)), "Review mistakes", true);
      }, "review"));
    }

    // mastery overview
    const grid = el("div", { class: "cases-overview" });
    metas.forEach((m) => {
      const mas = Cases.mastery(m.id);
      grid.append(el("div", { class: "case-stat" },
        el("div", { class: "cs-name" }, m.name),
        el("div", { class: "cs-q" }, m.q),
        el("div", { class: "cs-bar" }, el("i", { style: `width:${mas || 0}%` })),
        el("div", { class: "cs-pct" }, mas == null ? "not started" : mas + "% mastery")));
    });
    host.append(grid);
    host.append(el("p", { class: "search-hint" }, "Tip: 'Review mistakes' replays only the forms you got wrong, until you fix them."));
  }

  function startSession(pool, label, isReview) {
    if (!pool.length) { renderPicker(); return; }
    const queue = shuffle(pool).slice(0, Math.min(12, pool.length));
    const state = { i: 0, score: 0 };

    function render() {
      host.innerHTML = "";
      pills.innerHTML = "";
      const back = el("button", { class: "deck-pill" }, "← Cases");
      back.addEventListener("click", renderPicker);
      pills.append(back);

      if (state.i >= queue.length) {
        host.append(el("div", { class: "quiz-card", style: "text-align:center" },
          el("h2", { style: "font-family:'PT Serif',serif" }, label + " complete"),
          el("p", { style: "font-size:32px;margin:12px 0" }, `${state.score} / ${queue.length}`),
          el("button", { class: "btn primary big", style: "margin-top:8px", onclick: renderPicker }, "Choose another case")));
        renderNav();
        return;
      }
      const d = queue[state.i];
      const meta = metaById[d.case] || {};
      const card = el("div", { class: "quiz-card" });
      card.append(el("div", { class: "quiz-bar" },
        el("span", {}, `${label} · ${state.i + 1}/${queue.length}`), el("span", {}, `Score: ${state.score}`)));
      card.append(el("div", { class: "case-target" }, "Target: ", el("strong", {}, `${meta.name || d.case}`), meta.q ? el("span", { class: "muted" }, "  (" + meta.q + ")") : null));
      card.append(el("div", { class: "case-en gloss-en" }, d.en));
      // sentence with the blank, plus the base lemma to decline
      const sent = el("div", { class: "case-sentence ru", "data-say": d.prompt.replace("___", d.answer) });
      sent.append(document.createTextNode(d.prompt.replace("___", "  _____  ")));
      card.append(sent);
      card.append(el("div", { class: "case-base" }, "from: ", el("strong", {}, d.base)));

      const opts = el("div", { class: "quiz-options" });
      shuffle(d.options).forEach((o) => {
        const btn = el("button", { class: "quiz-opt ru", "data-say": o }, o);
        btn.addEventListener("click", () => {
          if (opts.dataset.done) return;
          opts.dataset.done = "1";
          const correct = o === d.answer;
          Cases.record(d.case, correct);
          btn.classList.add(correct ? "correct" : "wrong");
          [...opts.children].forEach((c) => { if (c.textContent === d.answer) c.classList.add("correct"); });
          if (correct) { state.score++; Gamify.award(3, "Cases drill"); if (isReview) Cases.clearMiss(d.id); }
          else { Cases.addMiss(d.id); }
          speak(d.prompt.replace("___", d.answer));
          card.append(el("div", { class: "note", style: "margin-top:14px" },
            el("div", {}, (correct ? "✓ " : "✗ ") + d.answer + " — " + (d.context || "")),
            el("div", { class: "muted", style: "margin-top:4px" }, d.explain)));
          card.append(el("button", { class: "btn primary", style: "margin-top:14px", onclick: () => { state.i++; render(); } },
            state.i + 1 >= queue.length ? "See results" : "Next →"));
        });
        opts.append(btn);
      });
      card.append(opts);
      host.append(card);
    }
    render();
  }

  renderPicker();
}

/* ---------------- search / dictionary ---------------- */
async function buildSearchIndex() {
  const out = [];
  const seen = new Set();
  const push = (it) => { const k = it.type + ":" + it.ru; if (it.ru && !seen.has(k)) { seen.add(k); out.push(it); } };
  const vocab = await loadContent("vocabulary").catch(() => ({}));
  (vocab.decks || []).forEach((d) => (d.cards || []).forEach((c) =>
    push({ id: "v:" + d.id + ":" + c.ru, ru: c.ru, en: c.en || "", tr: c.tr || "", ar: c.ar || "", type: "word", src: prettyDeck(d.id) })));
  const vb = await loadContent("verbs").catch(() => ({}));
  (vb.verbs || []).forEach((v) =>
    push({ id: "vb:" + v.inf, ru: v.inf, en: v.en || "", ar: v.ar || "", type: "verb", src: "Verb" }));
  for (const sec of ["grammar", "academic", "conversations", "alphabet"]) {
    const data = await loadContent(sec).catch(() => ({}));
    (data.units || []).forEach((u) => (u.blocks || []).forEach((b) => {
      if (b.type === "examples") (b.items || []).forEach((it) =>
        push({ id: "ex:" + it.ru, ru: it.ru, en: it.en || "", ar: it.ar || "", tr: it.tr || "", type: "phrase", src: (u.title || sec).split("—")[0].trim() }));
      if (b.type === "dialogue") (b.lines || []).forEach((l) =>
        push({ id: "dl:" + l.ru, ru: l.ru, en: l.en || "", ar: l.ar || "", tr: l.tr || "", type: "phrase", src: (u.title || sec).split("—")[0].trim() }));
    }));
  }
  return out;
}

function resultRow(it, onRemove) {
  const row = el("div", { class: "search-row" });
  row.append(onRemove
    ? (() => { const b = el("button", { class: "star-btn on", title: "Remove" }, "★"); b.addEventListener("click", onRemove); return b; })()
    : starBtn(it));
  row.append(el("div", { class: "sr-body" },
    el("div", { class: "sr-ru ru", "data-say": it.ru }, it.ru),
    it.tr ? el("div", { class: "sr-tr" }, it.tr) : null,
    it.en ? el("div", { class: "sr-en gloss-en" }, it.en) : null,
    it.ar ? el("div", { class: "sr-ar gloss-ar", dir: "rtl" }, it.ar) : null));
  row.append(el("span", { class: "sr-tag" }, it.src || it.type || "saved"));
  return row;
}

async function viewSearch() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🔍 Search & dictionary"),
    el("p", {}, "Look up any word or phrase across vocabulary, verbs, grammar examples and dialogues. Type Russian or English; tap ☆ to save.")));
  const stage = el("div", { class: "quiz-stage", style: "max-width:720px" });
  view.append(stage);
  const input = el("input", { class: "text-input", placeholder: "Search… дом · house · читать", dir: "auto", autocomplete: "off", style: "font-family:inherit;font-size:17px" });
  stage.append(input);
  const results = el("div", { class: "search-results" });
  stage.append(results);

  const index = await buildSearchIndex();
  const render = (q) => {
    results.innerHTML = "";
    const nq = normRu(q), lq = q.toLowerCase().trim();
    if (!nq && !lq) { results.append(el("div", { class: "search-hint" }, `${index.length} entries indexed. Start typing to search.`)); return; }
    const matches = index.filter((it) =>
      (nq && normRu(it.ru).includes(nq)) ||
      (lq && ((it.en || "").toLowerCase().includes(lq) || (it.tr || "").toLowerCase().includes(lq)))
    ).slice(0, 80);
    if (!matches.length) { results.append(el("div", { class: "fc-empty" }, "No matches. Try a different spelling.")); return; }
    matches.forEach((it) => results.append(resultRow(it)));
  };
  let t;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => render(input.value), 110); });
  render("");
  input.focus();
}

function viewFavorites() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "⭐ Favorites"),
    el("p", {}, "Your saved words and phrases. Tap the Russian to hear it; tap ★ to remove.")));
  const stage = el("div", { class: "quiz-stage", style: "max-width:720px" });
  view.append(stage);
  const list = el("div", { class: "search-results" });
  stage.append(list);
  const render = () => {
    list.innerHTML = "";
    const favs = Favs.load();
    if (!favs.length) {
      list.append(el("div", { class: "fc-empty" }, el("div", { class: "big-emoji" }, "⭐"),
        el("p", {}, "No favorites yet. Tap the ☆ on any word in Search, the Word of the day, or when you reveal a flashcard.")));
      return;
    }
    favs.slice().reverse().forEach((it) => list.append(resultRow(it, () => { Favs.remove(it.id); render(); })));
  };
  render();
}

/* ---------------- AI conversation tutor ---------------- */
const TUTOR_SYSTEM =
  "You are a warm, encouraging Russian language tutor for a learner whose native language is Arabic and who also knows English. " +
  "Keep the conversation going in SIMPLE Russian suited to the learner's level. Reply in this format every time:\n" +
  "1) Your reply in Russian (short, natural).\n2) A line starting 'EN:' with an English translation.\n3) A line starting 'AR:' with an Arabic translation.\n" +
  "If the learner made a mistake, gently correct it on a line starting 'Поправка:' (with the fix in Russian + a short English note). Always end with a simple question to keep the chat going.";

const PROVIDERS = {
  openrouter: {
    kind: "openai",
    label: "OpenRouter — DeepSeek / Qwen / more",
    keyName: "ru_openrouter_key",
    keyPlaceholder: "sk-or-…",
    signup: "openrouter.ai/keys",
    note: "One key unlocks DeepSeek, Qwen and many other models — several are free. Stored only in this browser, sent directly to OpenRouter.",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    dynamic: true,
    fallbackModels: ["deepseek/deepseek-r1:free", "deepseek/deepseek-chat", "qwen/qwen-2.5-72b-instruct"],
    authHeaders: (key) => ({ authorization: "Bearer " + key, "HTTP-Referer": location.origin, "X-Title": "Russian A to Z" }),
  },
  gemini: {
    kind: "gemini",
    label: "Google Gemini — works in the browser ✅",
    keyName: "ru_gemini_key",
    keyPlaceholder: "AIza… (Google AI Studio key)",
    signup: "aistudio.google.com/apikey",
    note: "Free tier, fast, and callable directly from the browser with no proxy — the most reliable option here. Get a key with any Google account at aistudio.google.com/apikey.",
    endpoint: "https://generativelanguage.googleapis.com",
    fallbackModels: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"],
  },
  deepseek: {
    kind: "openai",
    label: "DeepSeek (direct)",
    keyName: "ru_deepseek_key",
    keyPlaceholder: "sk-… (platform.deepseek.com)",
    signup: "platform.deepseek.com → API keys",
    note: "Direct DeepSeek API. Many networks BLOCK direct browser calls (CORS) — if you get 'Failed to fetch', switch to Google Gemini or OpenRouter, which work in the browser.",
    endpoint: "https://api.deepseek.com/chat/completions",
    fallbackModels: ["deepseek-chat", "deepseek-reasoner"],
    authHeaders: (key) => ({ authorization: "Bearer " + key }),
  },
  qwen: {
    kind: "openai",
    label: "Qwen — Alibaba DashScope (direct)",
    keyName: "ru_qwen_key",
    keyPlaceholder: "sk-… (DashScope key)",
    signup: "dashscope.console.aliyun.com",
    note: "Direct Qwen/DashScope API (OpenAI-compatible). Often BLOCKED by the browser (CORS) — if you get 'Failed to fetch', use Google Gemini or OpenRouter instead.",
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    fallbackModels: ["qwen-plus", "qwen-turbo", "qwen-max"],
    authHeaders: (key) => ({ authorization: "Bearer " + key }),
  },
  yandex: {
    kind: "openai",
    label: "YandexGPT (Yandex Cloud)",
    keyName: "ru_yandex_key",
    keyPlaceholder: "Yandex Cloud API key (AQVN…)",
    signup: "yandex.cloud → AI Studio → API key",
    note: "Excellent at Russian. Needs a Yandex Cloud API key AND a folder ID (both from your Yandex Cloud console). Note: Yandex's API may block direct browser calls — if you see a network/CORS error on the live site, tell me and I'll set up a small free proxy. Yandex Cloud signup can be restricted in some regions.",
    endpoint: "https://llm.api.cloud.yandex.net/v1/chat/completions",
    needsFolder: true,
    fallbackModels: ["yandexgpt-lite", "yandexgpt", "yandexgpt-32k"],
    modelOf: (id) => `gpt://${localStorage.getItem("ru_yandex_folder") || ""}/${id}/latest`,
    authHeaders: (key) => ({ authorization: "Bearer " + key, "x-folder-id": localStorage.getItem("ru_yandex_folder") || "" }),
  },
  anthropic: {
    kind: "anthropic",
    label: "Claude (Anthropic)",
    keyName: "ru_anthropic_key",
    keyPlaceholder: "sk-ant-…",
    signup: "console.anthropic.com",
    note: "High quality but paid per message. Stored only in this browser, sent directly to Anthropic.",
    fallbackModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  },
};
const provKey = (p) => localStorage.getItem(PROVIDERS[p].keyName) || "";
const provReady = (p) => !!provKey(p) && (!PROVIDERS[p].needsFolder || !!localStorage.getItem("ru_yandex_folder"));
function curProvider() { return PROVIDERS[localStorage.getItem("ru_tutor_provider")] ? localStorage.getItem("ru_tutor_provider") : "openrouter"; }

async function viewTutor() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🤖 AI Tutor"),
    el("p", {}, "Chat with an AI Russian tutor — choose Google Gemini (works in the browser), OpenRouter (DeepSeek/Qwen), direct DeepSeek/Qwen, YandexGPT or Claude. It replies in simple Russian, gently corrects you, and adds English + Arabic. Uses your own API key, stored only on this device.")));
  const stage = el("div", { class: "quiz-stage", style: "max-width:680px" });
  view.append(stage);

  let provider = curProvider();
  render();

  function render() {
    provider = curProvider();
    if (provReady(provider)) renderChat(); else renderKeyForm();
  }

  function providerPicker(onChange) {
    const sel = el("select", { class: "dropdown" });
    Object.entries(PROVIDERS).forEach(([id, p]) => sel.append(el("option", { value: id }, p.label)));
    sel.value = provider;
    sel.addEventListener("change", () => { localStorage.setItem("ru_tutor_provider", sel.value); onChange(sel.value); });
    return sel;
  }

  function renderKeyForm() {
    stage.innerHTML = "";
    const P = PROVIDERS[provider];
    const card = el("div", { class: "quiz-card" });
    card.append(el("div", { class: "toolbar" }, el("span", { style: "color:var(--muted)" }, "Provider:"), providerPicker(() => render())));
    card.append(el("h2", { style: "font-family:'PT Serif',serif;margin-top:6px" }, "Connect your " + P.label.split("—")[0].trim() + " key"));
    card.append(el("p", { class: "prose" }, "Get a key at " + P.signup + ". " + P.note));
    const input = el("input", { class: "text-input", type: "password", placeholder: P.keyPlaceholder, style: "font-family:monospace;font-size:15px" });
    card.append(input);
    let folderInput = null;
    if (P.needsFolder) {
      folderInput = el("input", { class: "text-input", placeholder: "Folder ID (b1g…)", style: "font-family:monospace;font-size:15px;margin-top:8px", value: localStorage.getItem("ru_yandex_folder") || "" });
      card.append(folderInput);
    }
    const save = el("button", { class: "btn primary", style: "margin-top:12px" }, "Save key & start");
    save.addEventListener("click", () => {
      const v = input.value.trim();
      if (!v) return;
      if (P.needsFolder) {
        const f = (folderInput.value || "").trim();
        if (!f) { folderInput.focus(); return; }
        localStorage.setItem("ru_yandex_folder", f);
      }
      localStorage.setItem(P.keyName, v);
      render();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
    card.append(save);
    stage.append(card);
  }

  function renderChat() {
    stage.innerHTML = "";
    const history = []; // {role, content}
    const toolbar = el("div", { class: "toolbar" });
    const modelSel = el("select", { class: "dropdown" });
    populateModels(modelSel);
    const forget = el("button", { class: "ghost-btn", style: "width:auto;padding:9px 12px" }, "Change key");
    forget.addEventListener("click", () => { localStorage.removeItem(PROVIDERS[provider].keyName); renderKeyForm(); });
    toolbar.append(providerPicker(() => render()), modelSel, forget);
    stage.append(toolbar);

    const log = el("div", { class: "chat-log" });
    stage.append(log);
    const composer = el("div", { class: "composer" });
    const input = el("input", { class: "text-input", placeholder: "Type in Russian or English…", dir: "auto" });
    const send = el("button", { class: "btn primary" }, "Send");
    composer.append(input, send);
    stage.append(composer);

    function bubble(role, node) {
      const b = el("div", { class: "bubble " + role });
      b.append(node);
      log.append(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }
    bubble("bot", el("div", {}, ru("Здравствуйте! Давайте поговорим по-русски. О чём хотите поговорить?", "Здравствуйте! Давайте поговорим по-русски. О чём хотите поговорить?")));

    async function submit() {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      bubble("user", el("div", {}, text));
      history.push({ role: "user", content: text });
      const botContent = el("div", { class: "muted" }, "…");
      bubble("bot", botContent);
      send.disabled = true;
      const paint = (t) => { botContent.className = ""; botContent.innerHTML = ""; botContent.append(renderTutorReply(t)); log.scrollTop = log.scrollHeight; };
      try {
        const reply = await callTutor(provider, modelSel.value, history, paint);
        history.push({ role: "assistant", content: reply });
        paint(reply);
        // auto-speak the Russian line of the reply
        const ruLine = reply.split("\n").find((l) => /[Ѐ-ӿ]/.test(l) && !/^\s*(EN:|AR:|Поправка)/i.test(l));
        if (ruLine) speak(ruLine);
      } catch (e) {
        botContent.className = "";
        botContent.innerHTML = "";
        const msg = String((e && e.message) || e);
        let hint = "";
        if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
          let host = "the provider";
          try { host = new URL(PROVIDERS[provider].endpoint).host; } catch {}
          hint = ` — couldn't reach ${host}. This is a network/CORS block, not your key: this provider's API doesn't allow direct browser calls on your network. Switch the Provider dropdown to “Google Gemini” (works in the browser) or OpenRouter, or try another network.`;
        } else if (/\b401\b|\b403\b|invalid.*key|unauthor/i.test(msg)) hint = " — check that your API key is correct and active.";
        else if (/\b402\b|quota|credit|billing/i.test(msg)) hint = " — your account is out of free quota/credits.";
        else if (/\b429\b|rate/i.test(msg)) hint = " — rate limited; wait a moment and try again.";
        botContent.append(el("div", { class: "bad" }, "Error: " + msg + hint));
      } finally {
        send.disabled = false;
        log.scrollTop = log.scrollHeight;
      }
    }
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    input.focus();
  }

  function renderTutorReply(text) {
    // Make Russian (Cyrillic) lines clickable for audio.
    const wrap = el("div", {});
    text.split("\n").forEach((line) => {
      if (!line.trim()) return;
      const isRu = /[Ѐ-ӿ]/.test(line);
      wrap.append(el("div", isRu ? { class: "ru", "data-say": line } : {}, line));
    });
    return wrap;
  }

  async function populateModels(sel) {
    const P = PROVIDERS[provider];
    const saved = localStorage.getItem("ru_tutor_model_" + provider);
    const setOptions = (ids) => {
      sel.innerHTML = "";
      ids.forEach((id) => sel.append(el("option", { value: id }, id.includes(":free") ? id + "  (free)" : id)));
      if (saved && ids.includes(saved)) sel.value = saved;
    };
    sel.addEventListener("change", () => localStorage.setItem("ru_tutor_model_" + provider, sel.value));
    setOptions(P.fallbackModels);
    if (P.dynamic) {
      // Pull the live model list so DeepSeek/Qwen ids stay current; free models first.
      try {
        const r = await fetch("https://openrouter.ai/api/v1/models");
        if (r.ok) {
          const data = await r.json();
          const ids = (data.data || []).map((m) => m.id).filter((id) => /^(deepseek|qwen)\//.test(id));
          ids.sort((a, b) => (b.includes(":free") - a.includes(":free")) || a.localeCompare(b));
          if (ids.length) setOptions(ids);
        }
      } catch { /* keep fallback list */ }
    }
  }

  function callTutor(prov, model, messages, onToken) {
    const kind = PROVIDERS[prov].kind;
    if (kind === "anthropic") return callAnthropic(model, messages, onToken);
    if (kind === "gemini") return callGemini(model, messages, onToken);
    return callOpenAI(prov, model, messages, onToken);
  }

  // Shared SSE reader: `pick(ev)` returns the text delta for this provider, or null.
  async function streamChat(res, pick, onToken) {
    if (!res.ok || !res.body) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.error?.message) msg = res.status + " " + j.error.message; } catch {}
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        if (ev.error) throw new Error(ev.error.message || "stream error");
        const delta = pick(ev);
        if (delta) { full += delta; if (onToken) onToken(full); }
      }
    }
    return full.trim() || "(no reply)";
  }

  function callAnthropic(model, messages, onToken) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": provKey("anthropic"),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 1024, system: TUTOR_SYSTEM, messages, stream: true }),
    }).then((res) => streamChat(res,
      (ev) => (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") ? ev.delta.text : null, onToken));
  }

  // OpenAI-compatible providers (OpenRouter, Yandex). Yandex maps the model id to a gpt:// URI.
  function callOpenAI(prov, model, messages, onToken) {
    const P = PROVIDERS[prov];
    const sentModel = P.modelOf ? P.modelOf(model) : model;
    return fetch(P.endpoint, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, P.authHeaders(provKey(prov))),
      body: JSON.stringify({
        model: sentModel, stream: true, max_tokens: 1024,
        messages: [{ role: "system", content: TUTOR_SYSTEM }, ...messages],
      }),
    }).then((res) => streamChat(res,
      (ev) => (ev.choices && ev.choices[0] && ev.choices[0].delta) ? ev.choices[0].delta.content : null, onToken));
  }

  // Google Gemini — CORS-enabled, callable directly from the browser. Key goes in
  // the query string (avoids a custom auth header); streams Server-Sent Events.
  function callGemini(model, messages, onToken) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provKey("gemini"))}`;
    const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: TUTOR_SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 1024 },
      }),
    }).then((res) => streamChat(res, (ev) => {
      try { return ev.candidates && ev.candidates[0] && ev.candidates[0].content && ev.candidates[0].content.parts && ev.candidates[0].content.parts[0] && ev.candidates[0].content.parts[0].text || null; }
      catch { return null; }
    }, onToken));
  }
}

/* ---------------- nav + router ---------------- */
function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  const icons = { alphabet: "🔤", grammar: "📐", vocabulary: "📇", conversations: "💬", academic: "🎓" };
  const route = location.hash || "#/";

  const add = (href, ico, label, badge) => {
    const a = el("a", { href, class: route === href ? "active" : "" },
      el("span", { class: "ico" }, ico), el("span", {}, label));
    if (badge) a.append(el("span", { class: "badge" }, String(badge)));
    nav.append(a);
  };

  add("#/", "🏠", "Dashboard");
  add("#/path", "🗺️", "Learning Path");
  add("#/stats", "📊", "Progress");
  add("#/search", "🔍", "Search");
  add("#/favorites", "⭐", "Favorites");
  nav.append(el("div", { class: "nav-sep" }, "Learn"));
  App.sections.forEach((s) => add("#/section/" + s.id, icons[s.id] || "📘", s.title.split("—")[1]?.trim() || s.title));
  nav.append(el("div", { class: "nav-sep" }, "Practice"));
  add("#/flashcards", "🃏", "Flashcards", App.dueBadge || null);
  add("#/practice", "🎯", "Quiz");
  add("#/cases", "🧩", "Cases trainer");
  add("#/verbs", "🔁", "Verb trainer");
  add("#/listening", "🎧", "Listening");
  add("#/dictation", "✍️", "Dictation");
  add("#/pronounce", "🎤", "Pronunciation");
  add("#/exam", "🎓", "Exams A1–C2");
  add("#/tutor", "🤖", "AI Tutor");
}

// Human-readable label for a route hash (used by the dashboard "Continue" button).
function routeLabel(hash) {
  const map = { "#/path": "Learning Path", "#/stats": "Progress", "#/flashcards": "Flashcards", "#/practice": "Quiz", "#/cases": "Cases trainer", "#/verbs": "Verb trainer", "#/listening": "Listening", "#/dictation": "Dictation", "#/pronounce": "Pronunciation", "#/exam": "Exams A1–C2", "#/tutor": "AI Tutor", "#/search": "Search", "#/favorites": "Favorites" };
  if (map[hash]) return map[hash];
  if (hash.startsWith("#/section/")) {
    const id = hash.split("/")[2];
    const s = App.sections.find((x) => x.id === id);
    return s ? (s.title.split("—").pop().trim() || s.title) : id;
  }
  return "where you were";
}

async function router() {
  const hash = location.hash || "#/";
  const view = $("#view");
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (hash === "#/" || hash === "") await viewDashboard();
    else if (hash === "#/path") await viewPath();
    else if (hash === "#/stats") await viewStats();
    else if (hash.startsWith("#/section/")) await viewSection(hash.split("/")[2], hash.split("/")[3]);
    else if (hash === "#/flashcards") await viewFlashcards();
    else if (hash === "#/practice") await viewPractice();
    else if (hash === "#/cases") await viewCases();
    else if (hash === "#/verbs") await viewVerbs();
    else if (hash === "#/listening") await viewListening();
    else if (hash === "#/dictation") await viewDictation();
    else if (hash === "#/pronounce") await viewPronounce();
    else if (hash === "#/exam") await viewExam();
    else if (hash === "#/tutor") await viewTutor();
    else if (hash === "#/search") await viewSearch();
    else if (hash === "#/favorites") viewFavorites();
    else await viewDashboard();
    if (hash && hash !== "#/") localStorage.setItem("ru_last_route", hash);
    App.dueBadge = (await srsStats()).due || null;
  } catch (e) {
    view.innerHTML = `<div class="fc-empty"><div class="big-emoji">⚠️</div><p>Could not load this page.<br><code>${e.message}</code></p></div>`;
  }
  renderNav();
  window.scrollTo(0, 0);
}

/* ---------------- preferences: theme + gloss language ---------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("#theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
}
function applyGloss(gloss) {
  document.body.setAttribute("data-gloss", gloss);
  document.querySelectorAll("#gloss-seg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.gloss === gloss)
  );
}
function initPrefs() {
  const theme = localStorage.getItem("ru_theme") || "dark";
  applyTheme(theme);
  const gloss = localStorage.getItem("ru_gloss") || "both";
  applyGloss(gloss);

  const tBtn = $("#theme-toggle");
  if (tBtn) tBtn.addEventListener("click", () => {
    const next = (localStorage.getItem("ru_theme") || "dark") === "dark" ? "light" : "dark";
    localStorage.setItem("ru_theme", next);
    applyTheme(next);
  });
  document.querySelectorAll("#gloss-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      localStorage.setItem("ru_gloss", b.dataset.gloss);
      applyGloss(b.dataset.gloss);
    })
  );
}
// Mobile off-canvas nav drawer (hamburger). No-op on desktop where the sidebar is static.
function setupNavDrawer() {
  const app = $("#app");
  const toggle = $("#nav-toggle");
  const backdrop = $("#backdrop");
  const nav = $("#nav");
  if (!toggle || !app) return;
  const set = (open) => { app.classList.toggle("nav-open", open); toggle.setAttribute("aria-expanded", open ? "true" : "false"); };
  toggle.addEventListener("click", () => set(!app.classList.contains("nav-open")));
  if (backdrop) backdrop.addEventListener("click", () => set(false));
  if (nav) nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  window.addEventListener("hashchange", () => set(false));
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("service-worker.js").catch(() => {})
    );
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  initPrefs();
  setupNavDrawer();
  registerSW();
  $("#audio-test").addEventListener("click", () => speak("Здравствуйте! Добро пожаловать."));
  // Build the section list (id + title + description) from the content files.
  App.sections = [];
  for (const id of SECTION_IDS) {
    try {
      const d = await loadContent(id);
      App.sections.push({ id, title: d.title || id, description: d.description || "" });
    } catch {
      App.sections.push({ id, title: id, description: "" });
    }
  }
  App.dueBadge = (await srsStats().catch(() => ({ due: 0 }))).due || null;
  renderNav();
  window.addEventListener("hashchange", router);
  await router();
}
boot();
