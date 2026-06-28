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

/* ---------------- speech ---------------- */
function pickVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  App.voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ru")) || null;
}
if (window.speechSynthesis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!window.speechSynthesis) return;
  const clean = String(text).replace(/[—–-].*$/u, "").trim() || String(text);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "ru-RU";
  u.rate = 0.92;
  if (App.voice) u.voice = App.voice;
  speechSynthesis.speak(u);
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
async function viewSection(section) {
  const data = await loadContent(section);
  const view = $("#view");
  view.innerHTML = "";
  view.append(
    el("div", { class: "page-head" },
      el("h1", {}, data.title || section),
      el("p", {}, data.description || ""))
  );
  const units = data.units || [];
  if (!units.length) {
    view.append(el("div", { class: "fc-empty" }, "No content yet for this section."));
    return;
  }
  units.forEach((u) => view.append(renderUnit(u, section)));
}

async function viewDashboard() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(
    el("div", { class: "page-head" },
      el("h1", {}, "Добро пожаловать! 👋"),
      el("p", {}, "Your path to academic-level Russian — from the alphabet to scholarly writing. Pick up where you left off, or review your flashcards below."))
  );

  const c = await srsStats();
  const prog = Store.loadProg();
  const totalUnits = await countAllUnits();
  const doneUnits = Object.keys(prog.completed || {}).length;
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

async function countAllUnits() {
  let n = 0;
  for (const s of App.sections) {
    const data = await loadContent(s.id).catch(() => ({}));
    n += (data.units || []).length;
  }
  return n;
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
        else state.score++;
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
        if (ok) state.score++;
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
      card.append(input, submit, feedback);
      host.append(card);
      input.focus();
    }
    next();
  }

  renderBrowse();
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
      if (ok) state.score++;
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
    card.append(input, submit, feedback);
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
        if (ok) state.score++;
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

/* ---------------- AI conversation tutor ---------------- */
const TUTOR_SYSTEM =
  "You are a warm, encouraging Russian language tutor for a learner whose native language is Arabic and who also knows English. " +
  "Keep the conversation going in SIMPLE Russian suited to the learner's level. Reply in this format every time:\n" +
  "1) Your reply in Russian (short, natural).\n2) A line starting 'EN:' with an English translation.\n3) A line starting 'AR:' with an Arabic translation.\n" +
  "If the learner made a mistake, gently correct it on a line starting 'Поправка:' (with the fix in Russian + a short English note). Always end with a simple question to keep the chat going.";

const PROVIDERS = {
  openrouter: {
    label: "OpenRouter — DeepSeek / Qwen / more",
    keyName: "ru_openrouter_key",
    keyPlaceholder: "sk-or-…",
    signup: "openrouter.ai/keys",
    note: "One key unlocks DeepSeek, Qwen and many other models — several are free. It is stored only in this browser and sent directly to OpenRouter.",
    fallbackModels: ["deepseek/deepseek-r1:free", "deepseek/deepseek-chat", "qwen/qwen-2.5-72b-instruct"],
  },
  anthropic: {
    label: "Claude (Anthropic)",
    keyName: "ru_anthropic_key",
    keyPlaceholder: "sk-ant-…",
    signup: "console.anthropic.com",
    note: "High quality but paid per message. It is stored only in this browser and sent directly to Anthropic.",
    fallbackModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  },
};
const provKey = (p) => localStorage.getItem(PROVIDERS[p].keyName) || "";
function curProvider() { return PROVIDERS[localStorage.getItem("ru_tutor_provider")] ? localStorage.getItem("ru_tutor_provider") : "openrouter"; }

async function viewTutor() {
  const view = $("#view");
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🤖 AI Tutor"),
    el("p", {}, "Chat with an AI Russian tutor — choose DeepSeek, Qwen or Claude. It replies in simple Russian, gently corrects you, and adds English + Arabic. Uses your own API key, stored only on this device.")));
  const stage = el("div", { class: "quiz-stage", style: "max-width:680px" });
  view.append(stage);

  let provider = curProvider();
  render();

  function render() {
    provider = curProvider();
    if (provKey(provider)) renderChat(); else renderKeyForm();
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
    card.append(el("p", { class: "prose" }, "Get a free key at " + P.signup + ". " + P.note));
    const input = el("input", { class: "text-input", type: "password", placeholder: P.keyPlaceholder, style: "font-family:monospace;font-size:15px" });
    const save = el("button", { class: "btn primary", style: "margin-top:12px" }, "Save key & start");
    save.addEventListener("click", () => {
      const v = input.value.trim();
      if (!v) return;
      localStorage.setItem(P.keyName, v);
      render();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
    card.append(input, save);
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
        botContent.append(el("div", { class: "bad" }, "Error: " + e.message + (String(e.message).includes("401") ? " — check your API key." : "")));
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
    if (provider === "openrouter") {
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
    return prov === "anthropic" ? callAnthropic(model, messages, onToken) : callOpenRouter(model, messages, onToken);
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

  function callOpenRouter(model, messages, onToken) {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + provKey("openrouter"),
        "HTTP-Referer": location.origin,
        "X-Title": "Russian A to Z",
      },
      body: JSON.stringify({
        model, stream: true, max_tokens: 1024,
        messages: [{ role: "system", content: TUTOR_SYSTEM }, ...messages],
      }),
    }).then((res) => streamChat(res,
      (ev) => (ev.choices && ev.choices[0] && ev.choices[0].delta) ? ev.choices[0].delta.content : null, onToken));
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
  nav.append(el("div", { class: "nav-sep" }, "Learn"));
  App.sections.forEach((s) => add("#/section/" + s.id, icons[s.id] || "📘", s.title.split("—")[1]?.trim() || s.title));
  nav.append(el("div", { class: "nav-sep" }, "Practice"));
  add("#/flashcards", "🃏", "Flashcards", App.dueBadge || null);
  add("#/practice", "🎯", "Quiz");
  add("#/verbs", "🔁", "Verb trainer");
  add("#/dictation", "✍️", "Dictation");
  add("#/pronounce", "🎤", "Pronunciation");
  add("#/exam", "🎓", "Exams A1–C2");
  add("#/tutor", "🤖", "AI Tutor");
}

async function router() {
  const hash = location.hash || "#/";
  const view = $("#view");
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (hash === "#/" || hash === "") await viewDashboard();
    else if (hash.startsWith("#/section/")) await viewSection(hash.split("/")[2]);
    else if (hash === "#/flashcards") await viewFlashcards();
    else if (hash === "#/practice") await viewPractice();
    else if (hash === "#/verbs") await viewVerbs();
    else if (hash === "#/dictation") await viewDictation();
    else if (hash === "#/pronounce") await viewPronounce();
    else if (hash === "#/exam") await viewExam();
    else if (hash === "#/tutor") await viewTutor();
    else await viewDashboard();
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
