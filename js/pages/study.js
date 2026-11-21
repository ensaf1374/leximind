// Study: one place for every flashcard session.
//   #/study            hub: today's session, one deck, or one spacing stage
//   #/study/today      everything that is due, across all decks
//   #/study/<deckId>   due cards of one deck (or the whole deck as practice when nothing is due)
//   #/study/box/<1-5>  cards of one spacing stage
import { html, raw, esc, navigate, toast, $, renderRoute, ico } from '../lib/ui.js';
import { S, SETTINGS, save, today, allCards, isDue, logActivity } from '../lib/store.js';
import { rate, preview, progress, LT } from '../lib/srs.js';
import { enrich, aiAvailable } from '../lib/ai.js';
import { speak, listen, sttSupported, similarity } from '../lib/speech.js';
import { openClips } from '../lib/clips.js';

const SESSION_MAX = 30;                 // cards per session; the rest is offered as "Continue"
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const STATUS = { new: 'New', learning: 'Learning', review: 'Review', mastered: 'Mastered' };

let st = null;                          // session state
let keyHandler = null, timer = null, mic = null, micToken = 0;

// ── Card back (also used by the deck page) ──────────────────────────────────
export function cardBack(c, prefix = 'cb') {
  const dl = c.definition.length, sz = dl > 130 ? 's' : dl > 75 ? 'm' : '';
  const loading = aiAvailable() ? 'Loading…' : '';
  const showFa = c.farsi || aiAvailable();
  return html`
    <div class="back-head"><span class="w">${c.word}</span>${c.phonetic ? html`<span class="phon" style="font-size:14px">${c.phonetic}</span>` : ''}${c.type && c.type !== 'word' ? html`<span class="pos">${c.type}</span>` : ''}</div>
    <div class="def ${sz}">${c.definition || 'No definition yet — edit this card in its deck.'}</div>
    <div class="syn" id="${prefix}-syn">${c.synonyms.length ? raw(c.synonyms.slice(0, 5).map(s => `<span class="chip">${esc(s)}</span>`).join('')) : ''}</div>
    <div class="two" style="${c.example && showFa ? '' : 'grid-template-columns:1fr'}">
      ${c.example ? html`<div class="ex">${c.example}</div>` : ''}
      ${showFa ? html`<div class="farsi fa ${c.farsi ? '' : 'loading'}" id="${prefix}-fa" ${raw(c.farsi ? 'lang="fa"' : '')}>${c.farsi || loading}</div>` : ''}
    </div>
    <div class="colloc" id="${prefix}-col" ${c.collocs.length ? '' : 'hidden'}>${raw(c.collocs.slice(0, 3).map(x => `<div class="ci"><b>${esc(x.c)}</b><span class="fa" lang="fa" style="font-size:14px">${esc(x.fa)}</span></div>`).join(''))}</div>
    ${c.context.length ? html`<details class="ctx"><summary>${plural(c.context.length, 'more example')}</summary>${raw(c.context.map(s => `<div>${esc(s)}</div>`).join(''))}</details>` : ''}`;
}
export function refreshBack(c, prefix = 'cb') {
  const fa = $(`#${prefix}-fa`); if (fa && c.farsi) { fa.textContent = c.farsi; fa.lang = 'fa'; fa.classList.remove('loading'); }
  const sy = $(`#${prefix}-syn`); if (sy && c.synonyms.length) sy.innerHTML = c.synonyms.slice(0, 5).map(s => `<span class="chip">${esc(s)}</span>`).join('');
  const co = $(`#${prefix}-col`); if (co && c.collocs.length) { co.hidden = false; co.innerHTML = c.collocs.slice(0, 3).map(x => `<div class="ci"><b>${esc(x.c)}</b><span class="fa" lang="fa" style="font-size:14px">${esc(x.fa)}</span></div>`).join(''); }
}
export const ticks = c => { const p = progress(c); return `<div class="ticks" title="Stage ${p.filled} of ${p.total}">${Array.from({ length: p.total }, (_, i) => `<i class="${i < p.filled ? (p.mastered ? 'mastered' : 'on') : ''}"></i>`).join('')}</div>`; };

// ── Which cards go into a session ───────────────────────────────────────────
// reviews before brand-new words, earliest stage first
const order = (a, b) => (a.status === 'new') - (b.status === 'new') || a.lbox - b.lbox || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
function buildQueue(param, sub) {
  const t = today();
  let pool, title, practice = false, back = 'study';
  if (param === 'today') { pool = allCards().filter(c => isDue(c, t)); title = 'Today'; }
  else if (param === 'new') { pool = allCards().filter(c => c.status === 'new'); title = 'New words'; }
  else if (param === 'box') { const n = Number(sub); const all = allCards().filter(c => c.lbox === n); pool = all.filter(c => isDue(c, t)); if (!pool.length) { pool = all; practice = true; } title = `Stage ${n}`; }
  else {
    const deck = S.decks[param]; if (!deck) return null;
    pool = deck.cards.filter(c => isDue(c, t)); title = deck.name; back = 'library/' + deck.id;
    if (!pool.length) { pool = [...deck.cards]; practice = true; }
  }
  pool = [...pool].sort(order);
  return { queue: pool.slice(0, SESSION_MAX), total: pool.length, title, practice, back };
}

export default {
  focus: false,
  render(main, _ctx, [param, sub]) {
    document.body.classList.remove('focus');
    if (!param) return hub(main);
    const q = buildQueue(param, sub);
    if (!q) { navigate('study'); return; }
    if (!q.queue.length) {
      main.innerHTML = html`<div class="empty"><h3>Nothing to study here yet</h3><p>${param === 'today' ? 'No cards are due right now.' : 'There are no cards in this set.'}</p><a class="btn btn-primary" href="#/study">Back to Study</a></div>`;
      return;
    }
    document.body.classList.add('focus');
    st = { ...q, pos: 0, flipped: false, param, sub, seen: 0, rated: { again: 0, hard: 0, good: 0, easy: 0 }, retries: new Map() };
    keyHandler = e => {
      if (!st || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || document.querySelector('.overlay')) return;
      // a focused button, link or disclosure handles Space itself
      const onControl = !!e.target.closest?.('button,a,summary');
      if (e.code === 'Space') { if (onControl) return; e.preventDefault(); flip(); }
      else if (st.flipped && '1234'.includes(e.key)) doRate(['again', 'hard', 'good', 'easy'][+e.key - 1]);
      else if (e.key.toLowerCase() === 'p' && current()) speak(current().word);
      else if (e.key.toLowerCase() === 'v' && current() && current().type !== 'sentence') { clearInterval(timer); openClips(current().word); }
    };
    document.addEventListener('keydown', keyHandler);
    draw(main);
  },
  destroy() { document.removeEventListener('keydown', keyHandler); clearInterval(timer); micToken++; mic?.stop(); mic = null; st = null; document.body.classList.remove('focus'); }
};

const current = () => st?.queue[st.pos];

// ── Hub ─────────────────────────────────────────────────────────────────────
function hub(main) {
  const t = today(), cards = allCards(), decks = Object.values(S.decks);
  const due = cards.filter(c => isDue(c, t)), fresh = due.filter(c => c.status === 'new').length;
  const todo = due.length, minutes = Math.max(1, Math.round(Math.min(todo, SESSION_MAX) / 4));
  if (!cards.length) {
    main.innerHTML = html`<div class="page-head"><div><h1>Study</h1></div></div>
      <div class="empty"><h3>No cards yet</h3><p>Add a deck first. Every word you add shows up here when it is time to study it.</p><a class="btn btn-primary" href="#/library">Go to Decks</a></div>`;
    return;
  }
  main.innerHTML = html`
    <div class="page-head"><div><h1>Study</h1><p>See a word, recall its meaning, then say how well you knew it. LexiMind decides when to show it again.</p></div></div>

    <section class="today"><div class="today-main">
      ${todo ? html`<div><h2>${plural(todo, 'card')} due today</h2><p>${todo > SESSION_MAX ? `In sessions of ${SESSION_MAX} · about ${minutes} minutes each` : `About ${plural(minutes, 'minute')}`}${fresh ? ` · ${fresh === todo ? 'all new' : `${fresh} new`}` : ''}</p></div><a class="btn btn-primary btn-lg" href="#/study/today">Start session ${ico('arrow')}</a>`
        : html`<div><h2>You’re done for today</h2><p>Nothing is due. You can still practise any deck below; it won’t change your schedule.</p></div>`}
    </div></section>

    <div class="section-title"><h2>Study one deck</h2><a class="link small" href="#/library">Manage decks</a></div>
    <div class="list">${raw(decks.map(d => {
      const dd = d.cards.filter(c => isDue(c, t)).length;
      return `<div class="item"><div class="t"><b>${esc(d.name)}</b><small>${plural(d.cards.length, 'card')} · ${dd ? `${dd} due` : 'nothing due'}</small></div>
        ${d.cards.length ? `<a class="btn btn-sm ${dd ? 'btn-primary' : ''}" href="#/study/${esc(d.id)}">${dd ? 'Study' : 'Practise'}</a>` : `<a class="btn btn-sm" href="#/library/${esc(d.id)}">Add words</a>`}</div>`; }).join(''))}</div>

    <div class="section-title"><h2>How your cards are spaced</h2></div>
    <p class="small muted" style="margin-bottom:10px">Every card sits in one of five stages. A right answer moves it up a stage, so you see it less often. A miss sends it back to stage 1.</p>
    <div class="boxes">${raw([1, 2, 3, 4, 5].map(b => {
      const its = cards.filter(c => c.lbox === b), bd = its.filter(c => isDue(c, t)).length;
      return `<button class="box" data-box="${b}" ${its.length ? '' : 'disabled'} title="${its.length ? `Study stage ${b}` : 'No cards in this stage'}">
        <span class="lbl">Stage ${b}${b === 5 ? ' · mastered' : ''}</span><b>${plural(its.length, 'card')}</b>
        <span class="sub">${LT.sub[b].toLowerCase()}</span>${bd ? `<span class="due">${bd} due</span>` : ''}</button>`; }).join(''))}</div>`;
  main.querySelectorAll('.box').forEach(b => b.onclick = () => navigate('study/box/' + b.dataset.box));
}

// ── Session ─────────────────────────────────────────────────────────────────
const nextIn = n => n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
const MAX_RETRIES = 2;                  // times a missed card can come back within one session
const HELP_FRONT = 'Space to show the answer · P to hear the word';
const helpBack = () => st.practice ? 'Practice only — your answers here don’t change when cards come back. Keys 1–4.' : 'How well did you know it? Each button shows when the card comes back. Keys 1–4.';
const when = (c, r) => st.practice ? '' : nextIn(preview(c, r));

function draw(main) {
  const c = current(); if (!c) return finish(main);
  const long = /phrase|idiom|sentence|collocation/.test(c.type) || c.word.length > 18;
  const left = st.queue.length - st.pos, pct = Math.round((st.pos / st.queue.length) * 100);
  micToken++; mic?.stop(); mic = null;   // a recording from the previous card must not report into this one
  main.innerHTML = html`
    <div class="study-top">
      <a class="icon-btn" href="#/${st.back}" title="End session" aria-label="End session">${ico('x')}</a>
      <div class="prog"><div class="bar"><i style="width:${pct}%"></i></div><span class="count">${left} left</span></div>
    </div>
    <div class="scene"><div class="card3d ${st.flipped ? 'flipped' : ''}" id="card3d" tabindex="-1" aria-live="polite">
      <div class="face front">
        <div class="corner"><span class="chip ${c.status === 'new' ? 'accent' : ''}">${st.practice ? 'Practice' : STATUS[c.status] || 'New'}</span><span>${st.title}</span></div>
        <div class="word ${long ? 'long' : ''}">${c.word}</div>
        ${c.phonetic && !long ? html`<div class="phon">${c.phonetic}</div>` : ''}
        ${c.type && c.type !== 'word' ? html`<div class="pos">${c.type}</div>` : ''}
        <div class="hint">Try to recall the meaning before you look</div>
        <div class="num" id="timer-num"></div>
      </div>
      <div class="face back">${raw(cardBack(c))}</div>
    </div></div>

    <div class="answer-row" id="answer-row" ${st.flipped ? 'hidden' : ''}><button class="btn btn-primary btn-lg btn-block" id="show">Show answer</button></div>
    <div class="rate" id="rate" ${st.flipped ? '' : 'hidden'}>
      <button class="again" data-r="again">Again<small>${when(c, 'again')}</small></button>
      <button class="hard" data-r="hard">Hard<small>${when(c, 'hard')}</small></button>
      <button class="good" data-r="good">Good<small>${when(c, 'good')}</small></button>
      <button class="easy" data-r="easy">Easy<small>${when(c, 'easy')}</small></button>
    </div>
    <p class="rate-help" id="rate-help">${st.flipped ? helpBack() : HELP_FRONT}</p>

    <div class="tools">
      <button class="btn btn-ghost btn-sm" id="t-say">${ico('volume')} Listen</button>
      ${c.type === 'sentence' ? '' : html`<button class="btn btn-ghost btn-sm" id="t-clips" title="Hear it in real videos (V)">${ico('play')} In videos</button>`}
      ${sttSupported() ? html`<button class="btn btn-ghost btn-sm" id="t-speak">${ico('mic')} Say it</button>` : ''}
      ${aiAvailable() ? html`<button class="btn btn-ghost btn-sm" id="t-more">More examples</button>` : ''}
      ${left > 1 ? html`<button class="btn btn-ghost btn-sm" id="skip">Skip for now</button>` : ''}
    </div>
    <div id="speak-out"></div>`;

  $('#card3d').onclick = e => { if (e.target.closest('button,details,summary,a') || String(getSelection()).length) return; flip(); };
  $('#show').onclick = flip;
  $('#t-say').onclick = () => speak(c.word);
  $('#t-clips')?.addEventListener('click', () => { clearInterval(timer); openClips(c.word); });
  $('#t-speak')?.addEventListener('click', () => sayIt(c));
  $('#t-more')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    const keep = c.context;
    const session = st; let got = false;
    try { c.context = []; await enrich(c); got = c.context.length > 0; if (!got) { c.context = keep; toast('No new examples came back', 'err'); } }
    catch (err) { c.context = keep; toast(err.message, 'err'); }
    // the learner may have moved on (or left) while the request was running
    if (st !== session || current() !== c) return;
    if (got) st.flipped = true;
    draw(main);
  });
  $('#rate').querySelectorAll('button').forEach(b => b.onclick = () => doRate(b.dataset.r));
  $('#skip')?.addEventListener('click', skip);
  startTimer();
  (st.flipped ? $('#card3d') : $('#show'))?.focus({ preventScroll: true });
  if (SETTINGS.autoSpeak && !st.flipped) speak(c.word);
}

function startTimer() {
  clearInterval(timer); const el = $('#timer-num'); if (!el) return;
  if (!SETTINGS.timer || st.flipped) { el.textContent = ''; return; }
  let left = SETTINGS.timer; el.textContent = `${left}s`;
  timer = setInterval(() => { left--; el.textContent = `${left}s`; if (left <= 0) { clearInterval(timer); if (st && !st.flipped) flip(); } }, 1000);
}
function flip() {
  if (!st || !$('#card3d')) return;
  st.flipped = !st.flipped; clearInterval(timer);
  $('#card3d').classList.toggle('flipped', st.flipped);
  $('#rate').hidden = !st.flipped; $('#answer-row').hidden = st.flipped;
  $('#rate-help').textContent = st.flipped ? helpBack() : HELP_FRONT;
  (st.flipped ? $('#card3d') : $('#show'))?.focus({ preventScroll: true });
  const c = current();
  if (st.flipped) enrich(c).then(ok => ok && st && current() === c && refreshBack(c)).catch(() => {});
}
function doRate(r) {
  const c = current(); if (!c || !st.flipped) return;
  if (!st.practice) rate(c, r);          // practising ahead never changes the schedule
  st.rated[r]++; st.seen++;
  if (r === 'again') {                   // comes back a few cards later, but not forever: it stays due for the next session
    const n = st.retries.get(c.id) || 0;
    if (n < MAX_RETRIES) { st.retries.set(c.id, n + 1); st.queue.splice(Math.min(st.pos + 4, st.queue.length), 0, c); }
  }
  st.pos++; st.flipped = false;
  draw($('#main'));
}
function skip() {
  if (!st || st.queue.length - st.pos < 2) return;
  st.queue.push(st.queue.splice(st.pos, 1)[0]); st.flipped = false;
  draw($('#main'));
}
function finish(main) {
  const r = st.rated, total = st.seen, ok = r.good + r.easy + r.hard, acc = total ? Math.round(ok / total * 100) : 0;
  const more = st.practice ? 0 : (buildQueue(st.param, st.sub)?.total || 0);
  const goalLeft = Math.max(0, S.dailyGoal - S.reviewedToday);
  if (total) logActivity({ kind: 'study', title: st.practice ? `Practice: ${st.title}` : st.title === 'Today' ? 'Today’s session' : st.title, detail: `${total} answers · ${acc}% remembered`, merge: false });
  clearInterval(timer);
  document.removeEventListener('keydown', keyHandler);
  main.innerHTML = html`<div class="panel done-card">
    <div class="done-ico">${ico('check')}</div>
    <h2 id="done-title" tabindex="-1">${st.practice ? 'Practice complete' : 'Session complete'}</h2>
    <p class="muted" style="margin-top:6px">${st.practice ? 'This was extra practice, so your schedule is unchanged.' : goalLeft ? `${plural(goalLeft, 'more card')} to reach today’s goal of ${S.dailyGoal}.` : `You’ve reached today’s goal of ${S.dailyGoal} cards.`}</p>
    <div class="summary"><div><b>${total}</b>answers</div><div><b>${acc}%</b>remembered</div><div><b>${r.again}</b>to repeat</div></div>
    <div class="row" style="justify-content:center">
      ${more ? html`<button class="btn btn-primary" id="again-btn">Continue · ${more} more due</button>` : ''}
      <a class="btn ${more ? '' : 'btn-primary'}" href="#/home">Done</a>
      ${more ? '' : html`<a class="btn" href="#/study">Study something else</a>`}
    </div>
  </div>`;
  // the address does not change, so re-render the page directly instead of navigating
  $('#again-btn')?.addEventListener('click', () => renderRoute());
  $('#done-title')?.focus({ preventScroll: true });
}

// Pronunciation check inside a session
function sayIt(c) {
  const out = $('#speak-out'), btn = $('#t-speak'); if (!out || !btn) return;
  if (mic) { mic.stop(); return; }
  out.innerHTML = `<p class="notice" style="margin-top:12px;text-align:center"><span class="spin"></span> Listening… say <b>${esc(c.word)}</b></p>`;
  btn.classList.add('rec');
  const tk = ++micToken;
  mic = listen({
    onEnd: said => {
      if (tk !== micToken) return;
      mic = null; btn.classList.remove('rec');
      if (!$('#speak-out')) return;
      if (!said) { out.innerHTML = `<p class="notice warn" style="margin-top:12px">Didn’t catch anything — check the microphone and try again.</p>`; return; }
      const score = similarity(c.word, said);
      c.spoken.tries++; c.spoken.best = Math.max(c.spoken.best, score);
      S.speaking.attempts.push({ word: c.word, said, score, date: today() }); if (S.speaking.attempts.length > 500) S.speaking.attempts.shift();
      save();
      out.innerHTML = `<p class="notice ${score >= 80 ? 'good' : 'warn'}" style="margin-top:12px;text-align:center"><b>${score}% match.</b> You said “${esc(said)}”. ${score >= 80 ? 'Clear.' : 'Listen once more and try again.'}</p>`;
      if (score < 80) speak(c.word);
    },
    onError: e => { if (tk !== micToken) return; mic = null; btn.classList.remove('rec'); if ($('#speak-out')) out.innerHTML = `<p class="notice bad" style="margin-top:12px">${esc(e.message)}</p>`; },
  });
}
