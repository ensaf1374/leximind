import { html, raw, esc, $, toast } from '../lib/ui.js';
import { S, save, allCards, today, hist } from '../lib/store.js';
import { speak, listen, sttSupported, ttsSupported, similarity, diffWords } from '../lib/speech.js';
import { ask, aiAvailable, parseJSON } from '../lib/ai.js';
import { awardXP, checkBadges } from '../lib/gamify.js';

let mode = 'pronounce', ctl = null, cur = null, keyH = null;

export default {
  render(main) {
    main.innerHTML = html`
      <div class="page-head"><div><h1>Speak &amp; listen</h1><p>Train your mouth and your ears with the words you're already learning.</p></div></div>
      ${!ttsSupported() ? html`<p class="notice bad">This browser can't speak text aloud. Try Chrome, Edge or Safari.</p>` : ''}
      ${!sttSupported() ? html`<p class="notice warn">Speech recognition isn't available here — pronunciation and shadowing need Chrome or Edge. Dictation and the listening quiz still work.</p>` : ''}
      <div class="seg" id="sp-modes">
        <button data-m="pronounce" class="on">Pronounce</button><button data-m="dictation">Dictation</button><button data-m="listen">Listening quiz</button><button data-m="shadow">Shadowing</button>
      </div>
      <div class="row" style="margin:14px 0">
        <label class="field" style="min-width:220px"><span>Deck</span><select id="sp-deck"><option value="">All decks</option>${raw(Object.values(S.decks).map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${d.cards.length})</option>`).join(''))}</select></label>
        <label class="field" style="min-width:160px"><span>Speed</span><select id="sp-rate"><option value="0.7">Slow</option><option value="0.9" selected>Normal</option><option value="1.1">Fast</option></select></label>
      </div>
      <div id="sp-area"></div>
      <div class="panel tight" style="margin-top:16px" id="sp-stats"></div>`;
    main.querySelectorAll('#sp-modes button').forEach(b => b.onclick = () => { mode = b.dataset.m; main.querySelectorAll('#sp-modes button').forEach(x => x.classList.toggle('on', x === b)); nextItem(); });
    $('#sp-deck').onchange = nextItem;
    keyH = e => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return; if (e.key === 'r' && $('#mic')) $('#mic').click(); if (e.key === 'l' && $('#sp-play')) $('#sp-play').click(); };
    document.addEventListener('keydown', keyH);
    nextItem(); drawStats();
  },
  destroy() { ctl?.stop(); document.removeEventListener('keydown', keyH); }
};

const pool = () => { const id = $('#sp-deck')?.value; const cards = id ? (S.decks[id]?.cards || []) : allCards(); return cards.filter(c => c.word); };
const rnd = a => a[Math.floor(Math.random() * a.length)];
const rate = () => parseFloat($('#sp-rate')?.value || 0.9);

function record(a) {
  S.speaking.attempts.push(a); if (S.speaking.attempts.length > 500) S.speaking.attempts.shift();
  hist().spoken = (hist().spoken || 0) + 1;
  awardXP(a.score >= 90 ? 15 : a.score >= 70 ? 10 : 4, a.score >= 90 ? 'Perfect' : null);
  checkBadges(); save(); drawStats();
}
function drawStats() {
  const el = $('#sp-stats'); if (!el) return;
  const at = S.speaking.attempts, t = today(), todayAt = at.filter(a => a.date === t);
  const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x.score, 0) / a.length) : 0;
  el.innerHTML = `<div class="row between"><span class="muted small">Today: <b>${todayAt.length}</b> attempts · avg <b>${avg(todayAt)}%</b></span><span class="muted small">All time: <b>${at.length}</b> attempts · avg <b>${avg(at)}%</b> · best streak of 90%+: <b>${bestRun(at)}</b></span></div>`;
}
const bestRun = at => { let b = 0, r = 0; for (const a of at) { r = a.score >= 90 ? r + 1 : 0; b = Math.max(b, r); } return b; };

function nextItem() {
  ctl?.stop(); const area = $('#sp-area'); if (!area) return;
  const cards = pool();
  if (!cards.length) { area.innerHTML = `<div class="empty"><h3>No words yet</h3><p>Add a deck first, then come back to practise saying the words.</p><a class="btn btn-primary" href="#/library">My decks</a></div>`; return; }
  cur = rnd(cards);
  ({ pronounce, dictation, listen: listenQuiz, shadow })[mode](area, cards);
}

// ── 1. Pronounce a word ─────────────────────────────────────────────────────
function pronounce(area) {
  const c = cur;
  area.innerHTML = html`<div class="panel" style="text-align:center;display:flex;flex-direction:column;gap:16px;align-items:center">
    <div class="word" style="font-size:52px">${c.word}</div>${c.phonetic ? html`<div class="phon">${c.phonetic}</div>` : ''}
    <div class="muted small" style="max-width:52ch">${c.definition}</div>
    <div class="row"><button class="btn" id="sp-play"><i data-ico="volume"></i> Hear it (L)</button><button class="btn btn-ghost" id="sp-skip">Skip</button></div>
    <button class="mic" id="mic" title="Record (R)" ${sttSupported() ? '' : 'disabled'}><i data-ico="mic"></i></button>
    <div id="sp-result" class="muted small">${sttSupported() ? 'Press the microphone and say the word' : 'Recognition unavailable in this browser'}</div></div>`;
  $('#sp-play').onclick = () => speak(c.word, { rate: rate() });
  $('#sp-skip').onclick = nextItem;
  $('#mic').onclick = () => toggleMic(said => {
    const score = similarity(c.word, said);
    c.spoken.tries++; c.spoken.best = Math.max(c.spoken.best, score);
    record({ word: c.word, said, score, date: today(), mode: 'pronounce' });
    $('#sp-result').innerHTML = `<div class="score" style="color:${col(score)}">${score}%</div><div>You said “${esc(said || '…')}”</div>${score >= 85 ? '<div class="notice good" style="margin-top:8px">Clear pronunciation. Next word in a moment…</div>' : '<div style="margin-top:8px"><button class="btn btn-sm" id="sp-retry">Try again</button></div>'}`;
    if (score >= 85) setTimeout(nextItem, 1400); else { speak(c.word, { rate: 0.75 }); $('#sp-retry')?.addEventListener('click', () => $('#mic').click()); }
    if (aiAvailable() && score < 85 && said) coachTip(c.word, said);
  });
}
async function coachTip(target, said) {
  try {
    const tip = await ask(`A Farsi-speaking English learner tried to say "${target}" and speech recognition heard "${said}". In one short sentence (max 25 words), give one concrete mouth/tongue tip for the sound they most likely missed. Plain text.`, { maxTokens: 80 });
    const r = $('#sp-result'); if (r) r.insertAdjacentHTML('beforeend', `<div class="notice warn" style="margin-top:8px;text-align:left">${esc(tip.trim())}</div>`);
  } catch {}
}
const col = s => s >= 85 ? 'var(--moss)' : s >= 60 ? 'var(--accent-ink)' : 'var(--brick)';

function toggleMic(onDone) {
  const mic = $('#mic'); if (!mic) return;
  if (ctl) { ctl.stop(); return; }
  mic.classList.add('rec'); $('#sp-result').textContent = 'Listening…';
  ctl = listen({ onResult: (f, i) => { $('#sp-result').textContent = (f + ' ' + i).trim() || 'Listening…'; },
    onEnd: said => { ctl = null; mic.classList.remove('rec'); if (!said) { const r = $('#sp-result'); if (r) r.textContent = "Didn't catch anything — check the microphone and try again."; return; } onDone(said); },
    onError: e => { ctl = null; mic.classList.remove('rec'); $('#sp-result').innerHTML = `<span class="notice bad">${esc(e.message)}</span>`; } });
}

// ── 2. Dictation: hear a sentence, type it ─────────────────────────────────
function dictation(area, cards) {
  const withEx = cards.filter(c => c.example); const c = withEx.length ? rnd(withEx) : cur; cur = c;
  const target = c.example || c.word;
  area.innerHTML = html`<div class="panel" style="display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center">
    <p class="muted">Listen and type exactly what you hear. The sentence uses <b>${c.word}</b>.</p>
    <div class="row"><button class="btn btn-primary" id="sp-play"><i data-ico="volume"></i> Play (L)</button><button class="btn" id="sp-slow">Slower</button><button class="btn btn-ghost" id="sp-skip">Skip</button></div>
    <input type="text" id="dict-in" class="big-input" placeholder="Type the sentence…" autocomplete="off" spellcheck="false" style="max-width:640px">
    <div class="row"><button class="btn btn-primary" id="dict-check">Check</button><button class="btn btn-ghost" id="dict-reveal">Reveal</button></div>
    <div id="sp-result" style="max-width:640px"></div></div>`;
  const play = r => speak(target, { rate: r });
  $('#sp-play').onclick = () => play(rate()); $('#sp-slow').onclick = () => play(0.65); $('#sp-skip').onclick = nextItem;
  setTimeout(() => play(rate()), 300);
  let checked = false;
  const check = () => {
    const said = $('#dict-in').value.trim(); if (!said || checked) return;
    checked = true; $('#dict-in').readOnly = true;
    const { parts, score } = diffWords(target, said);
    record({ word: c.word, said, score, date: today(), mode: 'dictation' });
    $('#sp-result').innerHTML = `<div class="score" style="color:${col(score)}">${score}%</div><div class="diff">${parts.map(p => `<span class="${p.state}">${esc(p.w)}</span>`).join(' ')}</div><div class="muted small" style="margin-top:8px">Target: “${esc(target)}”</div>${score >= 90 ? '' : '<div class="notice warn" style="margin-top:8px">Underlined words were missed, struck-out words were extra.</div>'}<div style="margin-top:10px"><button class="btn btn-primary btn-sm" id="dict-next">Next sentence</button></div>`;
    $('#dict-next').onclick = nextItem; $('#dict-check').disabled = true;
  };
  $('#dict-check').onclick = check; $('#dict-in').onkeydown = e => { if (e.key === 'Enter') check(); };
  $('#dict-reveal').onclick = () => { $('#sp-result').innerHTML = `<div class="notice">“${esc(target)}”</div>`; };
  $('#dict-in').focus();
}

// ── 3. Listening quiz: hear a word, pick the meaning ───────────────────────
function listenQuiz(area, cards) {
  if (cards.length < 4) { area.innerHTML = `<div class="empty"><h3>Need at least 4 cards</h3><p>Add a few more words to this deck for a multiple-choice quiz.</p></div>`; return; }
  const c = cur; const others = cards.filter(x => x.id !== c.id).sort(() => Math.random() - .5).slice(0, 3);
  const opts = [c, ...others].sort(() => Math.random() - .5);
  area.innerHTML = html`<div class="panel" style="display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center">
    <p class="muted">Which word did you hear?</p>
    <div class="row"><button class="btn btn-primary" id="sp-play"><i data-ico="volume"></i> Play (L)</button><button class="btn btn-ghost" id="sp-skip">Skip</button></div>
    <div class="opts" style="width:100%;max-width:640px">${raw(opts.map(o => `<button class="opt" data-id="${esc(o.id)}"><b>${esc(o.word)}</b><span class="muted"> — ${esc(o.definition)}</span></button>`).join(''))}</div>
    <div id="sp-result"></div></div>`;
  $('#sp-play').onclick = () => speak(c.word, { rate: rate() }); $('#sp-skip').onclick = nextItem;
  setTimeout(() => speak(c.word, { rate: rate() }), 300);
  area.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    area.querySelectorAll('.opt').forEach(x => { x.disabled = true; if (x.dataset.id === c.id) x.classList.add('ok'); });
    const right = b.dataset.id === c.id; if (!right) b.classList.add('no');
    record({ word: c.word, said: right ? c.word : '', score: right ? 100 : 0, date: today(), mode: 'listen' });
    $('#sp-result').innerHTML = `<div class="notice ${right ? 'good' : 'bad'}">${right ? 'Correct.' : `It was “${esc(c.word)}”.`} ${c.farsi ? `<span lang="fa" class="fa" style="display:inline;color:inherit">${esc(c.farsi)}</span>` : ''}</div><button class="btn btn-sm" id="ql-next" style="margin-top:10px">Next</button>`;
    $('#ql-next').onclick = nextItem;
  });
}

// ── 4. Shadowing: repeat a sentence right after the speaker ─────────────────
async function shadow(area) {
  const c = cur;
  area.innerHTML = html`<div class="panel" style="display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center">
    <p class="muted">Listen, then repeat the whole sentence with the same rhythm.</p>
    <div class="word long" id="sh-sent" style="font-weight:400">${c.example || html`<span class="spin"></span>`}</div>
    <div class="row"><button class="btn btn-primary" id="sp-play"><i data-ico="volume"></i> Play (L)</button><button class="btn" id="sh-hide">Hide text</button><button class="btn btn-ghost" id="sp-skip">Skip</button></div>
    <button class="mic" id="mic" title="Record (R)" ${sttSupported() ? '' : 'disabled'}><i data-ico="mic"></i></button>
    <div id="sp-result" class="muted small">Play it, then press the mic and repeat</div></div>`;
  let sentence = c.example;
  if (!sentence && aiAvailable()) { try { sentence = (await ask(`Write one natural English sentence (10-16 words) using "${c.word}" (${c.definition}). Return only the sentence.`, { maxTokens: 60 })).trim().replace(/^["']|["']$/g, ''); c.example = sentence; save(); } catch {} }
  if (!sentence) sentence = c.word;
  const s = $('#sh-sent'); if (s) s.textContent = sentence;
  $('#sp-play').onclick = () => speak(sentence, { rate: rate() }); $('#sp-skip').onclick = nextItem;
  $('#sh-hide').onclick = e => { const hidden = s.dataset.hidden === '1'; s.textContent = hidden ? sentence : '• • • listen and repeat • • •'; s.dataset.hidden = hidden ? '0' : '1'; e.target.textContent = hidden ? 'Hide text' : 'Show text'; };
  $('#mic').onclick = () => toggleMic(said => {
    const { parts, score } = diffWords(sentence, said);
    record({ word: c.word, said, score, date: today(), mode: 'shadow' });
    $('#sp-result').innerHTML = `<div class="score" style="color:${col(score)}">${score}%</div><div class="diff">${parts.map(p => `<span class="${p.state}">${esc(p.w)}</span>`).join(' ')}</div><div style="margin-top:10px"><button class="btn btn-sm" id="sh-again">Try again</button> <button class="btn btn-primary btn-sm" id="sh-next">Next</button></div>`;
    $('#sh-again').onclick = () => $('#mic').click(); $('#sh-next').onclick = nextItem;
  });
}
