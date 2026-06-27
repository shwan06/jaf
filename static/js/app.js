/* ======================================================================
   Русский от А до Я — frontend SPA
   Hash router + generic content renderer + SRS flashcards + quizzes.
   ====================================================================== */

const App = {
  sections: [],
  progress: { completed: [], cards: {}, reviews_total: 0 },
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
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};

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
  // strip stress/transliteration noise; speak the Russian as-is
  const clean = String(text).replace(/[—–-].*$/u, "").trim() || String(text);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "ru-RU";
  u.rate = 0.92;
  if (App.voice) u.voice = App.voice;
  speechSynthesis.speak(u);
}
// Delegated click for any .ru element
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
  const done = App.progress.completed.some((c) => c.item === itemKey);
  const toggle = el(
    "button",
    { class: "done-toggle" + (done ? " done" : "") },
    done ? "✓ Completed" : "Mark complete"
  );
  toggle.addEventListener("click", async () => {
    const nowDone = !toggle.classList.contains("done");
    await api("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: itemKey,
        section: sectionId,
        status: nowDone ? "completed" : "open",
      }),
    });
    toggle.classList.toggle("done", nowDone);
    toggle.textContent = nowDone ? "✓ Completed" : "Mark complete";
    await loadProgress();
    renderNav();
  });
  head.append(toggle);
  card.append(head);

  (unit.blocks || []).forEach((b) => card.append(renderBlock(b)));
  return card;
}

/* ---------------- views ---------------- */
async function loadContent(section) {
  if (!App.contentCache[section]) {
    App.contentCache[section] = await api("/api/content/" + section);
  }
  return App.contentCache[section];
}

async function viewSection(section) {
  const data = await loadContent(section);
  const view = $("#view");
  view.innerHTML = "";
  view.append(
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, data.title || section),
      el("p", {}, data.description || "")
    )
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
    el(
      "div",
      { class: "page-head" },
      el("h1", {}, "Добро пожаловать! 👋"),
      el(
        "p",
        {},
        "Your path to academic-level Russian — from the alphabet to scholarly writing. Pick up where you left off, or review your flashcards below."
      )
    )
  );

  const c = App.progress.cards || {};
  const totalUnits = await countAllUnits();
  const doneUnits = App.progress.completed.length;
  const stats = el(
    "div",
    { class: "stat-grid" },
    statBox(doneUnits + "/" + totalUnits, "Lessons completed", "accent"),
    statBox(c.due || 0, "Cards due today", "red"),
    statBox(c.learning || 0, "Cards in progress", "green"),
    statBox(App.progress.reviews_total || 0, "Total reviews", "")
  );
  view.append(stats);

  // section cards
  const grid = el("div", { class: "section-cards" });
  const icons = { alphabet: "🔤", grammar: "📐", vocabulary: "📇", conversations: "💬", academic: "🎓" };
  for (const s of App.sections) {
    const data = await loadContent(s.id).catch(() => ({ units: [] }));
    const total = (data.units || []).length || (data.decks || []).length;
    const done = App.progress.completed.filter((x) => x.section === s.id).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    grid.append(
      el(
        "a",
        { class: "section-card", href: "#/section/" + s.id },
        el("div", { class: "sc-ico" }, icons[s.id] || "📘"),
        el("h3", {}, s.title),
        el("p", {}, s.description || ""),
        el("div", { class: "progress-bar" }, el("i", { style: `width:${pct}%` })),
        el("div", { class: "sc-meta" }, total ? `${done}/${total} done` : "Open")
      )
    );
  }
  // study tools
  grid.append(
    el(
      "a",
      { class: "section-card", href: "#/flashcards" },
      el("div", { class: "sc-ico" }, "🃏"),
      el("h3", {}, "Flashcards"),
      el("p", {}, "Spaced-repetition review of all vocabulary (SM-2)."),
      el("div", { class: "sc-meta" }, (c.due || 0) + " due now")
    ),
    el(
      "a",
      { class: "section-card", href: "#/practice" },
      el("div", { class: "sc-ico" }, "🎯"),
      el("h3", {}, "Practice quiz"),
      el("p", {}, "Test recall with multiple-choice vocabulary drills."),
      el("div", { class: "sc-meta" }, "Start a round")
    )
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
  view.append(el("div", { class: "page-head" }, el("h1", {}, "🃏 Flashcards"), el("p", {}, "Spaced repetition with the SM-2 algorithm. Rate honestly — the schedule adapts to you.")));
  const decks = await api("/api/srs/decks");
  const stage = el("div", { class: "fc-stage" });
  view.append(stage);

  const state = { deck: "all", queue: [], idx: 0, revealed: false };

  const pills = el("div", { class: "deck-pills" });
  const totalDue = decks.reduce((a, d) => a + (d.due || 0), 0);
  const mkPill = (id, label, due) => {
    const p = el("button", { class: "deck-pill" + (state.deck === id ? " active" : "") }, label, el("span", { class: "cnt" }, String(due)));
    p.addEventListener("click", () => { state.deck = id; startSession(); });
    return p;
  };
  pills.append(mkPill("all", "All decks", totalDue));
  decks.forEach((d) => pills.append(mkPill(d.deck, prettyDeck(d.deck), d.due || 0)));
  stage.append(pills);

  const cardHost = el("div", {});
  stage.append(cardHost);

  async function startSession() {
    [...pills.children].forEach((p, i) => p.classList.toggle("active", (i === 0 && state.deck === "all") || p.textContent.startsWith(prettyDeck(state.deck))));
    state.queue = await api(`/api/srs/due?deck=${encodeURIComponent(state.deck)}&limit=30`);
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
          el("p", {}, state.queue.length ? "You reviewed " + state.queue.length + " card(s). Come back tomorrow for more." : "All caught up in this deck. Try another, or learn new words in the Vocabulary section."),
        )
      );
      loadProgress().then(renderNav);
      return;
    }
    const card = state.queue[state.idx];
    state.revealed = false;
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
    b.addEventListener("click", async () => {
      await api("/api/srs/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id, quality }),
      });
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

  const state = { mode: "ru2en", deck: "all", score: 0, asked: 0, total: 10, current: null };

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

  function pool() {
    return state.deck === "all" ? allCards : allCards.filter((c) => c.deck === state.deck);
  }
  function sample(arr, n, exclude) {
    const out = [];
    const copy = arr.filter((x) => x !== exclude);
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  }

  function newRound() {
    state.score = 0;
    state.asked = 0;
    nextQuestion();
  }

  function nextQuestion() {
    const p = pool();
    if (state.asked >= state.total || p.length < 4) {
      host.innerHTML = "";
      host.append(
        el("div", { class: "quiz-card" },
          el("h2", { style: "font-family:'PT Serif',serif" }, "Round complete"),
          el("p", { style: "font-size:34px;margin:14px 0" }, `${state.score} / ${state.asked}`),
          el("button", { class: "btn primary big" , onclick: newRound }, "Play again")
        )
      );
      return;
    }
    const answer = pool()[Math.floor(Math.random() * pool().length)];
    state.current = answer;
    const distractors = sample(pool(), 3, answer);
    const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
    const prompt = state.mode === "ru2en" ? answer.ru : answer.en;
    const promptIsRu = state.mode === "ru2en";

    host.innerHTML = "";
    const card = el("div", { class: "quiz-card" });
    card.append(el("div", { class: "quiz-bar" },
      el("span", {}, `Question ${state.asked + 1} of ${state.total}`),
      el("span", {}, `Score: ${state.score}`)
    ));
    card.append(el("div", { class: "quiz-q" }, promptIsRu ? "What does this mean?" : "How do you say this?"));
    const promptEl = el("div", { class: "quiz-prompt" + (promptIsRu ? " ru" : "") }, prompt);
    if (promptIsRu) { promptEl.dataset.say = answer.ru; speak(answer.ru); }
    card.append(promptEl);

    const opts = el("div", { class: "quiz-options" });
    options.forEach((o) => {
      const label = state.mode === "ru2en" ? o.en : o.ru;
      const btn = el("button", { class: "quiz-opt" + (state.mode === "en2ru" ? " ru" : "") }, label);
      if (state.mode === "en2ru") btn.dataset.say = o.ru;
      btn.addEventListener("click", () => {
        if (btn.dataset.answered) return;
        [...opts.children].forEach((c) => (c.dataset.answered = "1"));
        const correct = o === answer;
        btn.classList.add(correct ? "correct" : "wrong");
        if (!correct) {
          [...opts.children][options.indexOf(answer)].classList.add("correct");
        } else {
          state.score++;
        }
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
  add("#/flashcards", "🃏", "Flashcards", App.progress.cards?.due || null);
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
  } catch (e) {
    view.innerHTML = `<div class="fc-empty"><div class="big-emoji">⚠️</div><p>Could not load this page.<br><code>${e.message}</code></p></div>`;
  }
  renderNav();
  window.scrollTo(0, 0);
}

async function loadProgress() {
  try { App.progress = await api("/api/progress"); } catch { /* ignore */ }
}

/* ---------------- boot ---------------- */
async function boot() {
  $("#audio-test").addEventListener("click", () => speak("Здравствуйте! Добро пожаловать."));
  App.sections = await api("/api/sections");
  await loadProgress();
  renderNav();
  window.addEventListener("hashchange", router);
  await router();
}
boot();
