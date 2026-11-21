// Games: word puzzles built from words picked at random across all decks.
//   #/games            choose a game
//   #/games/match      connect each word to its meaning
//   #/games/crossword  fill the grid letter by letter from the clues (meanings)
//   #/games/search     find the hidden words in a square of letters
import { html, raw, esc, $, ico, toast, navigate } from '../lib/ui.js';
import { allCards, logActivity } from '../lib/store.js';
import { awardXP } from '../lib/gamify.js';
import { speak } from '../lib/speech.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const key = (r, c) => r + ',' + c;

// Every card that can be a puzzle answer: words and collocations (spaces are dropped in the grid), never whole sentences.
function pool(min, max) {
  const seen = new Set(), out = [];
  for (const c of allCards()) {
    const ans = String(c.word || '').toUpperCase().replace(/[^A-Z]/g, ''), clue = (c.definition || c.farsi || '').trim();
    if (c.type === 'sentence' || !clue || ans.length < min || ans.length > max || seen.has(ans)) continue;
    seen.add(ans);
    const parts = c.word.trim().split(/[\s\-]+/).map(w => w.replace(/[^a-zA-Z]/g, '').length).filter(Boolean);
    out.push({ ans, word: c.word.trim(), clue, farsi: c.farsi || '', len: parts.length > 1 ? parts.join(', ') : String(ans.length) });
  }
  return out;
}

let cleanup = null;   // removes listeners of the game on screen

export default {
  render(main, _ctx, [which]) {
    cleanup?.(); cleanup = null;
    if (which === 'crossword') return crossword(main);
    if (which === 'search') return wordSearch(main);
    if (which === 'match') return matchGame(main);
    const n = pool(3, 13).length;
    main.innerHTML = html`
      <div class="page-head"><div><h1>Games</h1><p>Puzzles made from your own words. Each game picks at random from all your decks.</p></div></div>
      ${n < 4 ? html`<div class="empty"><h3>Add a few more words first</h3><p>The games need at least 4 words or collocations that have a meaning. You have ${n}.</p><a class="btn btn-primary" href="#/library">Go to Decks</a></div>` : html`
      <div class="list">
        <a class="item" href="#/games/match"><span class="ic">${ico('link')}</span><div class="t"><b>Matching pairs</b><small style="white-space:normal">Six words, six meanings. Connect each word to its meaning as fast as you can. A round takes about a minute.</small></div>${ico('chevron')}</a>
        <a class="item" href="#/games/crossword"><span class="ic">${ico('grid')}</span><div class="t"><b>Crossword</b><small style="white-space:normal">Read the meaning and fill in the word, letter by letter. Words cross each other, so one answer helps with the next.</small></div>${ico('chevron')}</a>
        <a class="item" href="#/games/search"><span class="ic">${ico('search')}</span><div class="t"><b>Word search</b><small style="white-space:normal">Your words are hidden in a square of letters. Find each one from its meaning.</small></div>${ico('chevron')}</a>
      </div>
      <p class="small muted" style="margin-top:12px">${plural(n, 'word')} and collocations available. Finished games are added to your calendar.</p>`}`;
  },
  destroy() { cleanup?.(); cleanup = null; }
};

const tooFew = main => { main.innerHTML = html`<div class="empty"><h3>Not enough words for this game</h3><p>Add more words or collocations with meanings to your decks, then try again.</p><a class="btn btn-primary" href="#/library">Go to Decks</a></div>`; };
const head = (title, sub) => html`<div class="page-head"><div><a class="small muted" href="#/games">← All games</a><h1 style="margin-top:6px">${title}</h1><p>${sub}</p></div></div>`;

// ═══ Matching pairs ═════════════════════════════════════════════════════════
// Words on the left, their meanings (or Farsi) on the right, in a different order. Pick one from each side.
let matchMode = 'meaning';   // what the right-hand side shows: 'meaning' or 'farsi'
function matchGame(main) {
  const all = pool(2, 40), withFa = all.filter(w => w.farsi.trim());
  if (all.length < 4) return tooFew(main);
  // Farsi mode needs at least four different translations, otherwise a pair could have two right answers
  const faOk = new Set(withFa.map(w => w.farsi.trim().toLowerCase())).size >= 4;
  if (!faOk) matchMode = 'meaning';
  const other = w => matchMode === 'farsi' ? w.farsi.trim() : w.clue;
  // six words whose right-hand texts are all different, so every pair has exactly one answer
  const seen = new Set(), words = [];
  for (const w of shuffle(matchMode === 'farsi' ? withFa : all)) { const t = other(w).toLowerCase(); if (seen.has(t)) continue; seen.add(t); words.push(w); if (words.length === 6) break; }
  const left = shuffle(words.map((_, i) => i)); let right = shuffle(words.map((_, i) => i));
  if (words.length > 1 && right.every((v, i) => v === left[i])) right = [...right.slice(1), right[0]];   // never line the answers up
  let selL = null, selR = null, matched = 0, mistakes = 0, busy = false, done = false; const missed = new Set(), t0 = Date.now();
  const clock = () => { const s = Math.floor((Date.now() - t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  main.innerHTML = html`${head('Matching pairs', 'Tap a word, then tap what it means.')}
    <div class="row between" style="margin-bottom:14px">
      ${faOk ? html`<div class="seg" id="mt-mode"><button data-m="meaning" class="${matchMode === 'meaning' ? 'on' : ''}">English meaning</button><button data-m="farsi" class="${matchMode === 'farsi' ? 'on' : ''}">Farsi</button></div>` : html`<span></span>`}
      <span class="small muted" id="mt-status" aria-live="polite"></span>
    </div>
    <div class="match" id="mt-grid">${raw(left.map((li, row) => { const ri = right[row];
      return `<button class="mt l" data-side="l" data-i="${li}">${esc(words[li].word)}</button><button class="mt r${matchMode === 'farsi' ? ' fa' : ''}" data-side="r" data-i="${ri}" ${matchMode === 'farsi' ? 'lang="fa"' : ''}>${esc(other(words[ri]))}</button>`; }).join(''))}</div>
    <div id="mt-done" style="margin-top:16px"></div>`;
  const grid = $('#mt-grid'), status = () => { const el = $('#mt-status'); if (el) el.textContent = `${matched} of ${words.length} matched · ${plural(mistakes, 'mistake')} · ${clock()}`; };
  const tick = setInterval(() => { if (!done) status(); }, 1000); cleanup = () => clearInterval(tick);
  status();

  const finish = () => {
    done = true; clearInterval(tick); status();
    const time = clock(); awardXP(Math.max(5, words.length * 3 - mistakes), 'Pairs matched');
    logActivity({ kind: 'game', title: 'Matching pairs', detail: `${plural(words.length, 'pair')} · ${plural(mistakes, 'mistake')} · ${time}`, merge: false });
    const again = [...missed].map(i => words[i]);
    $('#mt-done').innerHTML = `<div class="notice good"><b>${mistakes ? 'All matched.' : 'Perfect round.'}</b> ${plural(words.length, 'pair')} in ${time}${mistakes ? ` with ${plural(mistakes, 'mistake')}` : ''}. Added to your calendar.</div>
      ${again.length ? `<div class="panel tight" style="margin-top:10px"><div class="lbl">Worth another look</div>${again.map(w => `<div class="kv"><b>${esc(w.word)}</b><span class="small muted" style="text-align:right">${esc(w.clue)}</span></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="mt-again">Next round</button><a class="btn" href="#/games">All games</a></div>`;
    $('#mt-again').onclick = () => matchGame(main); $('#mt-again').focus();
  };
  grid.addEventListener('click', e => {
    const b = e.target.closest('.mt'); if (!b || busy || done || b.disabled) return;
    const side = b.dataset.side, prev = side === 'l' ? selL : selR;
    prev?.classList.remove('sel');
    if (prev === b) { if (side === 'l') selL = null; else selR = null; return; }   // tap again to unselect
    b.classList.add('sel'); if (side === 'l') selL = b; else selR = b;
    if (!selL || !selR) return;
    const a = selL, c = selR; selL = selR = null; a.classList.remove('sel'); c.classList.remove('sel');
    if (a.dataset.i === c.dataset.i) {
      a.classList.add('ok'); c.classList.add('ok'); a.disabled = c.disabled = true; matched++; status(); speak(words[+a.dataset.i].word);
      if (matched === words.length) finish();
    } else {
      mistakes++; missed.add(+a.dataset.i); status(); busy = true; a.classList.add('no'); c.classList.add('no');
      setTimeout(() => { a.classList.remove('no'); c.classList.remove('no'); busy = false; }, 450);
    }
  });
  main.querySelectorAll('#mt-mode button').forEach(b => b.onclick = () => { if (matchMode === b.dataset.m) return; matchMode = b.dataset.m; clearInterval(tick); matchGame(main); });
}

// ═══ Crossword ══════════════════════════════════════════════════════════════
// Greedy builder: place the first word, then attach each next word where it crosses a letter already on the
// grid. Several random attempts are made and the one that fits the most words wins.
function buildCrossword(words, want = 8, maxSize = 13) {
  let best = null;
  for (let attempt = 0; attempt < 60 && (!best || best.placed.length < want); attempt++) {
    const cands = shuffle(words).slice(0, 26); if (attempt % 2 === 0) cands.sort((a, b) => b.ans.length - a.ans.length);
    const grid = new Map(), placed = [];
    const box = () => { let r0 = 1e9, r1 = -1e9, c0 = 1e9, c1 = -1e9; for (const k of grid.keys()) { const [r, c] = k.split(',').map(Number); r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); } return { r0, r1, c0, c1 }; };
    const put = (w, r, c, dir) => { for (let i = 0; i < w.ans.length; i++) grid.set(key(r + (dir ? i : 0), c + (dir ? 0 : i)), w.ans[i]); placed.push({ ...w, r, c, dir }); };
    // dir 0 = across, 1 = down. Returns the number of crossings, or -1 when the word cannot go there.
    const fits = (ans, r, c, dir) => {
      const dr = dir ? 1 : 0, dc = dir ? 0 : 1; let cross = 0, prevFilled = false;
      if (grid.has(key(r - dr, c - dc)) || grid.has(key(r + dr * ans.length, c + dc * ans.length))) return -1;
      for (let i = 0; i < ans.length; i++) {
        const rr = r + dr * i, cc = c + dc * i, g = grid.get(key(rr, cc));
        if (g) { if (g !== ans[i] || prevFilled) return -1; cross++; prevFilled = true; }
        else { if (grid.has(key(rr + dc, cc + dr)) || grid.has(key(rr - dc, cc - dr))) return -1; prevFilled = false; }
      }
      if (cross === 0) return -1;
      const b = box(), r1 = r + dr * (ans.length - 1), c1 = c + dc * (ans.length - 1);
      if (Math.max(b.r1, r1) - Math.min(b.r0, r) + 1 > maxSize || Math.max(b.c1, c1) - Math.min(b.c0, c) + 1 > maxSize) return -1;
      return cross;
    };
    put(cands[0], 0, 0, 0);
    for (const w of cands.slice(1)) {
      if (placed.length >= want) break;
      const opts = [];
      for (const p of placed) for (let i = 0; i < w.ans.length; i++) for (let j = 0; j < p.ans.length; j++) {
        if (w.ans[i] !== p.ans[j]) continue;
        const dir = p.dir ? 0 : 1, r = p.dir ? p.r + j : p.r - i, c = p.dir ? p.c - i : p.c + j, s = fits(w.ans, r, c, dir);
        if (s > 0) opts.push({ r, c, dir, s });
      }
      if (!opts.length) continue;
      const top = Math.max(...opts.map(o => o.s)), pick = shuffle(opts.filter(o => o.s === top))[0];
      put(w, pick.r, pick.c, pick.dir);
    }
    if (!best || placed.length > best.placed.length) best = { placed, grid };
  }
  if (!best || best.placed.length < 3) return null;
  // move to a 0-based box and number the starting squares in reading order
  let r0 = 1e9, c0 = 1e9, r1 = -1e9, c1 = -1e9;
  for (const k of best.grid.keys()) { const [r, c] = k.split(',').map(Number); r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c); }
  const ws = best.placed.map(p => ({ ...p, r: p.r - r0, c: p.c - c0 })).sort((a, b) => a.r - b.r || a.c - b.c || a.dir - b.dir);
  let n = 0; const nums = new Map();
  for (const w of ws) { const k = key(w.r, w.c); if (!nums.has(k)) nums.set(k, ++n); w.num = nums.get(k); }
  const letters = new Map(); for (const [k, v] of best.grid) { const [r, c] = k.split(',').map(Number); letters.set(key(r - r0, c - c0), v); }
  return { words: ws, letters, nums, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

function crossword(main) {
  const words = pool(3, 13);
  const P = words.length >= 4 ? buildCrossword(words) : null;
  if (!P) return tooFew(main);
  const cellsOf = w => Array.from({ length: w.ans.length }, (_, i) => key(w.r + (w.dir ? i : 0), w.c + (w.dir ? 0 : i)));
  P.words.forEach(w => { w.cells = cellsOf(w); w.revealed = false; });
  let active = 0, done = false, hintsUsed = 0;   // active = index into P.words

  let cells = '';
  for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) {
    const k = key(r, c);
    cells += P.letters.has(k) ? `<div class="cw-cell" data-k="${k}">${P.nums.has(k) ? `<span class="num">${P.nums.get(k)}</span>` : ''}<input type="text" inputmode="text" maxlength="2" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" data-k="${k}" aria-label="Row ${r + 1}, column ${c + 1}"></div>` : '<div class="cw-blank"></div>';
  }
  const clueList = dir => P.words.map((w, i) => w.dir === dir ? `<button class="clue" data-w="${i}"><b>${w.num}</b><span>${esc(w.clue)} <small>(${w.len})</small></span></button>` : '').join('');
  main.innerHTML = html`${head('Crossword', 'Read each meaning and type the word, one letter per square.')}
    <div class="notice cw-now" id="cw-now" aria-live="polite"></div>
    <div class="cw">
      <div><div class="cw-grid" id="cw-grid" style="--cols:${P.cols}">${raw(cells)}</div>
        <div class="row" style="margin-top:14px"><button class="btn btn-sm btn-primary" id="cw-check">Check</button><button class="btn btn-sm" id="cw-letter" title="Reveals one letter of the highlighted word">Reveal a letter (3 left)</button><button class="btn btn-sm" id="cw-reveal">Reveal this word</button><button class="btn btn-sm btn-ghost" id="cw-new">New puzzle</button></div>
        <div id="cw-done" style="margin-top:14px"></div></div>
      <div class="cw-clues"><h3>Across</h3>${raw(clueList(0))}<h3 style="margin-top:14px">Down</h3>${raw(clueList(1))}</div>
    </div>`;
  const grid = $('#cw-grid'), input = k => grid.querySelector(`input[data-k="${k}"]`);
  const paint = () => {
    const w = P.words[active], set = new Set(w.cells);
    grid.querySelectorAll('.cw-cell').forEach(el => el.classList.toggle('on', set.has(el.dataset.k)));
    main.querySelectorAll('.clue').forEach(b => b.classList.toggle('on', +b.dataset.w === active));
    $('#cw-now').innerHTML = `<b>${w.num} ${w.dir ? 'Down' : 'Across'}</b> · ${esc(w.clue)} <span class="muted">(${w.len})</span>`;
  };
  const go = (wi, pos) => { active = wi; const w = P.words[wi]; const k = w.cells[Math.max(0, Math.min(w.cells.length - 1, pos))]; lastK = k; paint(); input(k)?.focus(); };
  const firstEmpty = w => { const i = w.cells.findIndex(k => !input(k).value); return i < 0 ? 0 : i; };
  const wordsAt = k => P.words.map((w, i) => w.cells.includes(k) ? i : -1).filter(i => i >= 0);
  const finish = () => {
    if (done) return; done = true;
    const own = P.words.filter(w => !w.revealed).length;
    grid.querySelectorAll('input').forEach(i => { i.readOnly = true; }); grid.classList.add('solved');
    if (own) awardXP(own * 5, 'Crossword solved');
    logActivity({ kind: 'game', title: 'Crossword', detail: `${plural(P.words.length, 'word')}${own < P.words.length ? ` · ${P.words.length - own} revealed` : ''}${hintsUsed ? ` · ${plural(hintsUsed, 'letter hint')}` : ''}`, merge: false });
    $('#cw-done').innerHTML = `<div class="notice good"><b>Solved.</b> ${plural(P.words.length, 'word')}: ${P.words.map(w => esc(w.word)).join(', ')}. It has been added to your calendar.</div>`;
  };
  const solved = () => [...P.letters].every(([k, v]) => input(k).value === v);

  grid.addEventListener('focusin', e => { const k = e.target.dataset?.k; if (!k) return; if (!P.words[active].cells.includes(k)) { const ws = wordsAt(k); active = ws.find(i => P.words[i].dir === P.words[active].dir) ?? ws[0]; } paint(); });
  grid.addEventListener('pointerdown', e => { const inp = e.target.closest('.cw-cell')?.querySelector('input'); if (!inp || document.activeElement !== inp) return; const ws = wordsAt(inp.dataset.k); if (ws.length > 1) { active = ws.find(i => i !== active) ?? active; paint(); } });
  grid.addEventListener('input', e => {
    const inp = e.target; if (!inp.dataset?.k || done) return;
    const ch = (inp.value.match(/[a-zA-Z]/g) || []).pop(); inp.value = ch ? ch.toUpperCase() : '';
    inp.parentElement.classList.remove('bad');
    if (!ch) return;
    const w = P.words[active], pos = w.cells.indexOf(inp.dataset.k);
    if (solved()) return finish();
    if (pos >= 0 && pos < w.cells.length - 1) input(w.cells[pos + 1]).focus();
  });
  grid.addEventListener('keydown', e => {
    const inp = e.target, k = inp.dataset?.k; if (!k) return;
    const [r, c] = k.split(',').map(Number), w = P.words[active], pos = w.cells.indexOf(k);
    const move = (dr, dc) => { const t = input(key(r + dr, c + dc)); if (t) { e.preventDefault(); t.focus(); } };
    if (e.key === 'Backspace' && !inp.value && pos > 0) { e.preventDefault(); const p = input(w.cells[pos - 1]); if (!done) { p.value = ''; p.parentElement.classList.remove('bad'); } p.focus(); }
    else if (e.key === 'ArrowRight') move(0, 1); else if (e.key === 'ArrowLeft') move(0, -1); else if (e.key === 'ArrowDown') move(1, 0); else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'Enter') { e.preventDefault(); const nx = (active + 1) % P.words.length; go(nx, firstEmpty(P.words[nx])); }
  });
  main.querySelectorAll('.clue').forEach(b => b.onclick = () => { const i = +b.dataset.w; go(i, firstEmpty(P.words[i])); });
  $('#cw-check').onclick = () => {
    let wrong = 0, empty = 0;
    for (const [k, v] of P.letters) { const i = input(k); if (!i.value) empty++; else if (i.value !== v) { wrong++; i.parentElement.classList.add('bad'); } }
    toast(wrong ? `${plural(wrong, 'letter')} to fix — marked in red` : empty ? `All correct so far. ${plural(empty, 'square')} left.` : 'All correct', wrong ? 'err' : 'ok');
    if (!wrong && !empty) finish();
  };
  // Three letter hints per puzzle. Each fills one square of the highlighted word: the square you are on if it is
  // empty or wrong, otherwise the first square of that word that still needs a letter.
  let lettersLeft = 3, lastK = null;
  const track = e => { const k = e.target.closest?.('.cw-cell')?.dataset.k; if (k) lastK = k; };
  grid.addEventListener('focusin', track); grid.addEventListener('pointerdown', track);
  $('#cw-letter').onclick = () => {
    if (done || lettersLeft <= 0) return;
    const w = P.words[active], need = k => input(k).value !== P.letters.get(k);
    const here = lastK;   // the square that had the cursor before this button took the focus
    const k = here && w.cells.includes(here) && need(here) ? here : w.cells.find(need);
    if (!k) { toast('This word is already complete — pick another clue', ''); return; }
    const el = input(k); el.value = P.letters.get(k); el.parentElement.classList.remove('bad'); el.parentElement.classList.add('given');
    lettersLeft--; hintsUsed++;
    const b = $('#cw-letter'); b.textContent = lettersLeft ? `Reveal a letter (${lettersLeft} left)` : 'No letter hints left'; b.disabled = !lettersLeft;
    if (solved()) return finish();
    const next = w.cells.find(need); input(next || k).focus();
  };
  $('#cw-reveal').onclick = () => { if (done) return; const w = P.words[active]; w.revealed = true; w.cells.forEach((k, i) => { const el = input(k); el.value = w.ans[i]; el.parentElement.classList.remove('bad'); }); speak(w.word); if (solved()) finish(); };
  $('#cw-new').onclick = () => crossword(main);
  go(0, 0);
}

// ═══ Word search ════════════════════════════════════════════════════════════
const FILL = 'EEEEEAAAAIIIOOOTTTNNNSSSRRRLLDDCUMHGPBFYWKV';
function buildSearch(words, want = 8) {
  const chosen = shuffle(words).slice(0, want).sort((a, b) => b.ans.length - a.ans.length);
  const N = Math.max(10, Math.min(12, chosen[0].ans.length + 2)), g = Array.from({ length: N }, () => Array(N).fill(''));
  const dirs = [[0, 1], [1, 0], [1, 1], [-1, 1]], placed = [];
  for (const w of chosen) {
    for (let t = 0; t < 300; t++) {
      const [dr, dc] = dirs[Math.floor(Math.random() * dirs.length)], L = w.ans.length;
      const r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N), er = r + dr * (L - 1), ec = c + dc * (L - 1);
      if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      let ok = true; for (let i = 0; i < L && ok; i++) { const x = g[r + dr * i][c + dc * i]; if (x && x !== w.ans[i]) ok = false; }
      if (!ok) continue;
      const cells = []; for (let i = 0; i < L; i++) { g[r + dr * i][c + dc * i] = w.ans[i]; cells.push(key(r + dr * i, c + dc * i)); }
      placed.push({ ...w, cells, found: false }); break;
    }
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!g[r][c]) g[r][c] = FILL[Math.floor(Math.random() * FILL.length)];
  return placed.length >= 3 ? { N, g, words: placed } : null;
}

function wordSearch(main) {
  const words = pool(3, 10);
  const P = words.length >= 4 ? buildSearch(words) : null;
  if (!P) return tooFew(main);
  let showWords = false, anchor = null, dragging = false, done = false, hints = 0;
  let cells = ''; for (let r = 0; r < P.N; r++) for (let c = 0; c < P.N; c++) cells += `<div class="ws-cell" data-k="${key(r, c)}">${P.g[r][c]}</div>`;
  main.innerHTML = html`${head('Word search', 'Find each word in the square. Drag across its letters, or tap the first letter and then the last.')}
    <div class="cw">
      <div><div class="ws-grid" id="ws-grid" style="--cols:${P.N}">${raw(cells)}</div>
        <div class="row" style="margin-top:14px"><button class="btn btn-sm" id="ws-hint">Hint</button><button class="btn btn-sm btn-ghost" id="ws-new">New puzzle</button></div>
        <div id="ws-done" style="margin-top:14px"></div></div>
      <div class="cw-clues"><div class="row between" style="margin-bottom:8px"><h3 style="margin:0" id="ws-count"></h3><label class="row small muted" style="gap:6px"><input type="checkbox" id="ws-show"> Show the words</label></div><div id="ws-list"></div></div>
    </div>`;
  const grid = $('#ws-grid'), cell = k => grid.querySelector(`[data-k="${k}"]`);
  const drawList = () => {
    const left = P.words.filter(w => !w.found).length;
    $('#ws-count').textContent = left ? `${left} of ${P.words.length} to find` : 'All found';
    $('#ws-list').innerHTML = P.words.map(w => `<div class="clue ${w.found ? 'found' : ''}"><b>${w.found ? '✓' : w.ans.length}</b><span>${w.found || showWords ? `<strong>${esc(w.word)}</strong> — ` : ''}${esc(w.clue)}${w.found || showWords ? '' : ` <small>(${w.len} letters)</small>`}</span></div>`).join('');
  };
  // the straight line of squares from a to b, or null when they are not in line
  const line = (a, b) => {
    const [r0, c0] = a.split(',').map(Number), [r1, c1] = b.split(',').map(Number), dr = r1 - r0, dc = c1 - c0, n = Math.max(Math.abs(dr), Math.abs(dc));
    if (!n || !(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
    return Array.from({ length: n + 1 }, (_, i) => key(r0 + Math.sign(dr) * i, c0 + Math.sign(dc) * i));
  };
  const clearPreview = () => grid.querySelectorAll('.pick').forEach(x => x.classList.remove('pick'));
  const preview = ks => { clearPreview(); ks.forEach(k => cell(k)?.classList.add('pick')); };
  const finish = () => {
    done = true; awardXP(Math.max(5, (P.words.length - hints) * 4), 'Word search solved');
    logActivity({ kind: 'game', title: 'Word search', detail: `${plural(P.words.length, 'word')}${hints ? ` · ${plural(hints, 'hint')}` : ''}`, merge: false });
    $('#ws-done').innerHTML = `<div class="notice good"><b>All found.</b> It has been added to your calendar.</div>`;
  };
  const attempt = (a, b) => {
    const ks = line(a, b); clearPreview(); anchor = null;
    if (!ks) return;
    const s = ks.map(k => cell(k).textContent).join(''), rev = [...s].reverse().join('');
    const w = P.words.find(x => !x.found && (x.ans === s || x.ans === rev));
    if (!w) { ks.forEach(k => cell(k).classList.add('miss')); setTimeout(() => grid.querySelectorAll('.miss').forEach(x => x.classList.remove('miss')), 350); return; }
    w.found = true; ks.forEach(k => cell(k).classList.add('found')); speak(w.word); drawList();
    if (P.words.every(x => x.found)) finish();
  };
  const at = e => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ws-cell')?.dataset.k || null;
  grid.addEventListener('pointerdown', e => {
    const k = e.target.closest('.ws-cell')?.dataset.k; if (!k || done) return; e.preventDefault();
    if (anchor && anchor !== k) return attempt(anchor, k);       // second tap
    anchor = k; dragging = true; preview([k]);
  });
  const move = e => { if (!dragging || !anchor) return; const k = at(e); if (k) preview(line(anchor, k) || [anchor]); };
  const up = e => { if (!dragging) return; dragging = false; const k = at(e); if (anchor && k && k !== anchor) attempt(anchor, k); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
  $('#ws-show').onchange = e => { showWords = e.target.checked; drawList(); };
  $('#ws-hint').onclick = () => { const w = P.words.find(x => !x.found); if (!w || done) return; hints++; const el = cell(w.cells[0]); el.classList.add('hint'); setTimeout(() => el.classList.remove('hint'), 1600); toast(`“${w.clue.slice(0, 60)}” starts at the flashing square`); };
  $('#ws-new').onclick = () => { cleanup?.(); cleanup = null; wordSearch(main); };
  drawList();
}
