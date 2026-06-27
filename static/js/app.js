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
        if (it.en) row.append(el("div", { class: "ex-en" }, it.en));
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
        if (l.en) line.append(el("div", { class: "d-en" }, l.en));
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
  if (unit.summary) titleWrap.append(el("p", { class: "summary" }, unit.summary));
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
    back.append(el("div", { class: "fc-back" }, card.back));
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
    else await viewDashboard();
    App.dueBadge = (await srsStats()).due || null;
  } catch (e) {
    view.innerHTML = `<div class="fc-empty"><div class="big-emoji">⚠️</div><p>Could not load this page.<br><code>${e.message}</code></p></div>`;
  }
  renderNav();
  window.scrollTo(0, 0);
}

/* ---------------- boot ---------------- */
async function boot() {
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
