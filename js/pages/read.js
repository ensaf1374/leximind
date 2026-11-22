// Read: passages to read and listen to, with every word one tap away.
// A passage comes from one of three places: AI writes it on a topic, AI writes it around the learner's own
// words, or the learner pastes any text (that last one needs no AI at all).
import { html, raw, esc, $, toast, confirmDialog, promptDialog, ico } from '../lib/ui.js';
import { S, save, uid, newCard, recordNewWords, SETTINGS, saveSettings, allCards, isDue, today, logActivity } from '../lib/store.js';
import { ask, parseJSON, lookupWord, aiAvailable, aiHint, LEVELS } from '../lib/ai.js';
import { speak, stopSpeaking } from '../lib/speech.js';
import { deckPicker, resolveDeck } from './library.js';
import { awardXP, checkBadges } from '../lib/gamify.js';
import { openClips } from '../lib/clips.js';

let R = null;                 // the reading on screen
let mode = 'topic';           // topic | words | paste
let curTab = 'vocab';
let rate = 0.9;               // listening speed
let playing = false, paused = false, veiled = false;
const cache = new Map();      // AI look-ups made in this visit
const TOPICS = ['A job interview', 'Planning a trip', 'Health and exercise', 'Persian New Year', 'Technology at work', 'A news story about the weather'];
const STYLES = { article: 'general-interest article', news: 'news report in journalistic style', story: 'short narrative story', academic: 'academic passage in IELTS reading style', dialogue: 'natural dialogue between two people (use speaker names)' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ── Matching words in a text to cards in the decks ──────────────────────────
const norm = w => String(w || '').toLowerCase().replace(/[^a-z'\-]/g, '').replace(/^['-]+|['-]+$/g, '');
// the word itself plus simple base forms: "decisions" → decision, "hoped" → hope, "easily" → easy …
function forms(w) {
  const f = [w]; const add = x => { if (x.length > 2 && !f.includes(x)) f.push(x); };
  if (w.endsWith("'s")) add(w.slice(0, -2));
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s')) add(w.slice(0, -1));
  if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); }
  if (w.endsWith('ily')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ly')) add(w.slice(0, -2));
  return f;
}
export function deckIndex() {
  const m = new Map();
  for (const d of Object.values(S.decks)) for (const c of d.cards) { const k = norm(c.word); if (k && !/\s/.test(c.word.trim()) && !m.has(k)) m.set(k, { card: c, deck: d }); }
  return m;
}
const findIn = (map, w) => { for (const f of forms(norm(w))) if (map.has(f)) return map.get(f); return null; };
const listFind = (list, w) => { const fs = forms(norm(w)); return (list || []).find(x => x && fs.includes(norm(x.word))) || null; };
// words worth meeting again: due first, then the ones missed most often
function pickWords(n = 8) {
  const t = today();
  return allCards().filter(c => c.word && c.definition && c.lbox < 5)
    .sort((a, b) => (isDue(b, t) - isDue(a, t)) || b.lapses - a.lapses || a.lbox - b.lbox).slice(0, n);
}
const persist = () => { if (R && S.readings.includes(R)) save(); };
const fullText = r => r.paragraphs.join('\n\n');
const calTitle = r => r.title + (r.part ? ` — part ${r.part}` : '');

// ── Page ────────────────────────────────────────────────────────────────────
export default {
  render(main) {
    const ai = !!aiAvailable(), mine = pickWords();
    main.innerHTML = html`
      <div class="page-head"><div><h1>Read</h1><p>Read and listen at your level. Tap any word for its meaning, and save the ones you want to keep.</p></div></div>
      <div class="panel" style="margin-bottom:16px">
        <div class="seg" id="rd-mode">${raw([['topic', 'Write one for me'], ['words', 'Use my words'], ['paste', 'Paste my own text']].map(([k, l]) => `<button data-m="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join(''))}</div>
        <div id="rd-form" style="margin-top:14px"></div>
      </div>
      <div id="rd-out"></div>
      <div class="section-title"><h2>Saved readings</h2><span class="muted small">${S.readings.length} saved</span></div>
      <div id="rd-saved"></div>`;
    main.querySelectorAll('#rd-mode button').forEach(b => b.onclick = () => { mode = b.dataset.m; main.querySelectorAll('#rd-mode button').forEach(x => x.classList.toggle('on', x === b)); drawForm(ai, mine); });
    drawForm(ai, mine); drawSaved();
    if (R) drawReading();
  },
  destroy() { stopAudio(); closePopups(); }
};
const closePopups = () => document.querySelectorAll('.popup').forEach(p => p.remove());

function drawForm(ai, mine) {
  const el = $('#rd-form'); if (!el) return;
  const options = html`<div class="grid grid-3" style="margin-top:12px">
      <label class="field"><span>Level</span><select id="rd-level">${raw(LEVELS.map(l => `<option ${l.startsWith('Intermediate') ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <label class="field"><span>Style</span><select id="rd-style"><option value="article">Article</option><option value="news">News report</option><option value="story">Short story</option><option value="academic">Academic / IELTS</option><option value="dialogue">Dialogue</option></select></label>
      <label class="field"><span>Length</span><select id="rd-len"><option value="3">Short (3 paragraphs)</option><option value="4" selected>Standard (4)</option><option value="6">Long (6)</option></select></label>
    </div>`;
  const needAi = ai ? '' : html`<p class="notice warn" style="margin-top:12px">${aiHint()} You can still paste your own text.</p>`;
  if (mode === 'paste') {
    el.innerHTML = html`
      <label class="field"><span>Title (optional)</span><input type="text" id="rd-ptitle" placeholder="e.g. Email from my manager"></label>
      <label class="field" style="margin-top:12px"><span>Your text</span><textarea id="rd-ptext" style="min-height:150px" placeholder="Paste an article, an email, a page from your textbook…"></textarea></label>
      <div class="row between" style="margin-top:12px"><span class="small muted">Works without AI: you can read, listen and look up words that are already in your decks.</span><button class="btn btn-primary" id="rd-open">Open text</button></div>`;
    $('#rd-open').onclick = openPasted;
  } else if (mode === 'words') {
    el.innerHTML = mine.length ? html`
      <p class="small muted" style="margin-bottom:8px">The passage will use these words from your decks — the ones that are due or that you miss most:</p>
      <div class="row" style="gap:6px">${raw(mine.map(c => `<span class="chip accent">${esc(c.word)}</span>`).join(''))}</div>
      <label class="field" style="margin-top:12px"><span>Topic (optional)</span><input type="text" id="rd-topic" placeholder="Leave empty and a fitting topic is chosen for you"></label>
      ${options}${needAi}
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" id="rd-gen" ${ai ? '' : 'disabled'}>Write passage</button></div>`
      : html`<div class="empty" style="padding:24px"><p>You have no words to practise yet. Add a deck first, then come back.</p><a class="btn btn-primary" href="#/library">Go to Decks</a></div>`;
    if (mine.length) $('#rd-gen').onclick = () => generate(mine);
  } else {
    el.innerHTML = html`
      <label class="field"><span>Topic</span><input type="text" id="rd-topic" placeholder="What would you like to read about?"></label>
      <div class="row" style="gap:6px;margin-top:8px">${raw(TOPICS.map(t => `<button class="chip pick" data-topic="${esc(t)}">${esc(t)}</button>`).join(''))}</div>
      ${options}${needAi}
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-primary" id="rd-gen" ${ai ? '' : 'disabled'}>Write passage</button></div>`;
    el.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { $('#rd-topic').value = b.dataset.topic; $('#rd-topic').focus(); });
    $('#rd-gen').onclick = () => generate(null);
    $('#rd-topic').onkeydown = e => { if (e.key === 'Enter') generate(null); };
  }
}

// ── Creating a reading ──────────────────────────────────────────────────────
function openPasted() {
  const text = $('#rd-ptext').value.trim();
  if (text.split(/\s+/).length < 5) { toast('Paste at least a sentence or two', 'err'); $('#rd-ptext').focus(); return; }
  if (text.length > 12000) { toast('That text is too long — keep it under 12,000 characters', 'err'); return; }
  const paragraphs = text.split(/\n\s*\n|\r\n\s*\r\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const title = $('#rd-ptitle').value.trim() || paragraphs[0].split(/\s+/).slice(0, 7).join(' ') + '…';
  R = { id: uid('r'), title, level: 'My text', style: 'pasted', source: 'paste', paragraphs, vocab: [], quiz: [], glossary: [], created: new Date().toISOString() };
  logActivity({ kind: 'reading', title: R.title, detail: 'My own text' });
  curTab = 'vocab'; drawReading(); $('#rd-out').scrollIntoView({ behavior: 'smooth' });
}

async function generate(words, prev) {
  const level = prev ? prev.level : $('#rd-level').value, style = prev ? prev.style : $('#rd-style').value, n = prev ? Math.min(6, prev.paragraphs.length) : $('#rd-len').value;
  const topic = prev ? prev.topic || prev.title : ($('#rd-topic')?.value.trim() || '');
  if (!prev && !words && !topic) { $('#rd-topic').focus(); return; }
  const btn = prev ? $('#rd-next') : $('#rd-gen'); const label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Writing…';
  const targets = (words || []).map(c => c.word);
  const subject = prev ? `Continue this text as part ${(prev.part || 1) + 1}, with the same characters, tone and level. Do not repeat or summarise the earlier part. Earlier part ended like this:\n"""${fullText(prev).slice(-1500)}"""`
    : `Write a ${STYLES[style] || STYLES.article} ${topic ? `about "${topic}"` : 'on a topic that fits the required words naturally'} for ${level} English learners.`;
  try {
    const d = parseJSON(await ask(`${subject}
Exactly ${n} paragraphs of 4-6 sentences. Use vocabulary appropriate to ${level}.
${targets.length ? `Use each of these words naturally at least once, with its usual meaning: ${targets.map(w => JSON.stringify(w)).join(', ')}.` : ''}
Return ONLY JSON: {"title":"short title","paragraphs":["...","..."],"vocab":[{"word":"...","phonetic":"IPA","type":"...","definition":"...","example":"...","farsi":"..."}]}
vocab: 6-8 words from the passage worth learning${targets.length ? ' (other than the required words)' : ''}. No markdown.`, { maxTokens: 2300 }), 'object');
    const paras = (Array.isArray(d.paragraphs) ? d.paragraphs : []).map(p => String(p).trim()).filter(Boolean);
    if (!paras.length) throw new Error('The passage came back empty — try again');
    const base = prev ? prev.baseTitle || prev.title : String(d.title || topic || 'Reading');
    R = { id: uid('r'), title: base, baseTitle: base, topic: topic || base, level, style, source: 'ai', paragraphs: paras, targets: targets.map(norm), vocab: Array.isArray(d.vocab) ? d.vocab.filter(v => v && v.word) : [], quiz: [], glossary: [], created: new Date().toISOString() };
    if (prev) { R.seriesId = prev.seriesId || prev.id; R.part = (prev.part || 1) + 1; }
    logActivity({ kind: 'reading', title: calTitle(R), detail: R.level });
    curTab = 'vocab'; awardXP(10, 'New reading'); drawReading(); $('#rd-out').scrollIntoView({ behavior: 'smooth' });
    extras(R);   // quiz and word help arrive a moment later, in a second small request
  } catch (e) { toast(e.message, 'err', 5000); }
  if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
}

// Second request: comprehension quiz + a glossary of the harder words, so most taps answer instantly
async function extras(r) {
  if (!aiAvailable() || r.extras === 'loading') return;
  r.extras = 'loading'; if (R === r && curTab === 'quiz') tab('quiz');
  try {
    const d = parseJSON(await ask(`Here is an English passage for ${r.level === 'My text' ? 'intermediate' : r.level} learners whose first language is Farsi:
"""${fullText(r).slice(0, 5000)}"""
Return ONLY JSON: {"quiz":[{"q":"...","options":["...","...","...","..."],"answer":0,"why":"one sentence"}],"glossary":[{"word":"base form, lowercase","type":"noun/verb/...","definition":"short and simple","farsi":"..."}]}
quiz: 5 comprehension questions (2 factual, 2 inference, 1 main idea); answer is a 0-based index.
glossary: the 12 hardest single words in the passage${r.vocab.length ? `, not counting: ${r.vocab.map(v => v.word).join(', ')}` : ''}. No markdown.`, { maxTokens: 2600 }), 'object');
    r.quiz = Array.isArray(d.quiz) ? d.quiz.filter(q => q && q.q && Array.isArray(q.options)) : [];
    r.glossary = Array.isArray(d.glossary) ? d.glossary.filter(g => g && g.word) : [];
    r.extras = 'done';
  } catch (e) { r.extras = 'failed'; if (R === r && curTab === 'quiz') toast(e.message, 'err'); }
  if (S.readings.includes(r)) save();
  if (R === r && $('#rd-tabs')) { $('#rd-tabs [data-t="quiz"]').textContent = quizLabel(); if (curTab === 'quiz') tab('quiz'); }
}
const quizLabel = () => R.quizResult ? `Quiz (${R.quizResult.score}/${R.quizResult.total})` : 'Quiz';

// ── The reading ─────────────────────────────────────────────────────────────
export function paragraphHTML(p, pi, idx, targets, seen) {
  const sents = p.match(/[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g) || [p];
  return sents.map((s, si) => `<span class="sent" data-s="${pi}-${si}">${s.split(/(\s+)/).map(tok => {
    if (!tok) return ''; if (/^\s+$/.test(tok)) return ' ';
    const clean = tok.replace(/[^a-zA-Z'’\-]/g, '').replace(/’/g, "'").replace(/^['-]+|['-]+$/g, '');
    if (clean.length < 2) return esc(tok);
    const hit = findIn(idx, clean), isTarget = forms(norm(clean)).some(f => targets.has(f));
    if (hit) seen.set(hit.card.id, hit.card);
    return `<span class="rw${isTarget ? ' target' : hit && hit.card.lbox < 5 ? ' mine' : ''}" data-w="${esc(clean)}">${esc(tok)}</span>`;
  }).join('')}</span>`).join('');
}

function drawReading() {
  const out = $('#rd-out'); if (!out || !R) return;
  R.vocab ||= []; R.quiz ||= []; R.glossary ||= [];
  stopAudio(true); veiled = false;
  const saved = S.readings.includes(R), ai = !!aiAvailable();
  const idx = deckIndex(), targets = new Set(R.targets || []), seen = new Map();
  const body = R.paragraphs.map((p, i) => `<p data-p="${i}">${paragraphHTML(p, i, idx, targets, seen)}</p>${ai || R.fa?.[i] ? `<div class="para-tools"><button class="link small" data-fa="${i}">${R.fa?.[i] ? 'Show Farsi' : 'Translate to Farsi'}</button></div><div class="para-fa fa" lang="fa" id="fa-${i}" hidden></div>` : ''}`).join('');
  const mastered = [...seen.values()].filter(c => c.lbox >= 5).length;
  out.innerHTML = html`
    <div class="row between" style="margin-bottom:10px;align-items:flex-start">
      <div><h2 style="font-size:20px">${R.title}</h2><div class="row small muted" style="gap:6px;margin-top:4px"><span class="chip">${R.level}</span>${R.part ? html`<span class="chip">Part ${R.part}</span>` : ''}</div></div>
      <button class="btn btn-sm ${saved ? '' : 'btn-primary'}" id="rd-save" ${saved ? 'disabled' : ''}>${saved ? 'Saved' : 'Save reading'}</button>
    </div>
    <div class="read-bar">
      <button class="btn btn-sm" id="rd-listen">${ico('volume')} Listen</button>
      <button class="btn btn-sm" id="rd-pause" hidden>Pause</button>
      <button class="btn btn-sm" id="rd-stop" hidden>Stop</button>
      <select id="rd-rate" aria-label="Listening speed" style="width:auto;padding:5px 8px;font-size:13px"><option value="0.7">Slow</option><option value="0.9">Normal</option><option value="1.1">Fast</option></select>
      <button class="btn btn-sm btn-ghost" id="rd-veil" title="Hide the text and train your ear first">Listen first</button>
      <button class="btn btn-sm btn-ghost" id="rd-font" style="margin-left:auto">${SETTINGS.readingFont === 'serif' ? 'Sans font' : 'Serif font'}</button>
    </div>
    <article class="reading ${SETTINGS.readingFont === 'serif' ? 'serif' : ''}" id="rd-text">${raw(body)}</article>
    <p class="muted small" style="margin-top:8px">${seen.size ? `${plural(seen.size, 'word')} from your decks ${seen.size === 1 ? 'appears' : 'appear'} here${mastered ? ` (${mastered} mastered)` : ''} — underlined. ` : ''}Tap a word to look it up${ai ? '; select a phrase to translate it' : ''}.</p>
    ${ai && R.source !== 'paste' ? html`<div style="margin-top:12px"><button class="btn btn-sm" id="rd-next">Write the next part</button></div>` : ''}
    <div class="subtabs"><div class="seg" id="rd-tabs"><button data-t="vocab">Key words${R.vocab.length ? ` (${R.vocab.length})` : ''}</button><button data-t="quiz">${quizLabel()}</button><button data-t="phrases">Phrases</button><button data-t="write">Write about it</button></div></div>
    <div id="rd-tab"></div>`;
  $('#rd-rate').value = String(rate);
  $('#rd-text').querySelectorAll('.rw').forEach(w => w.onclick = e => lookup(e, w));
  $('#rd-text').addEventListener('mouseup', onSelect);
  $('#rd-text').querySelectorAll('[data-fa]').forEach(b => b.onclick = () => farsi(b));
  $('#rd-listen').onclick = () => readAloud(0);
  $('#rd-pause').onclick = togglePause;
  $('#rd-stop').onclick = () => stopAudio();
  $('#rd-rate').onchange = e => { rate = parseFloat(e.target.value) || 0.9; if (playing) { const at = currentPara; stopAudio(true); readAloud(at); } };
  $('#rd-veil').onclick = () => { setVeil(!veiled); if (veiled && !playing) readAloud(0); };
  $('#rd-font').onclick = () => { SETTINGS.readingFont = SETTINGS.readingFont === 'serif' ? 'sans' : 'serif'; saveSettings(); drawReading(); };
  $('#rd-save').onclick = () => { if (S.readings.includes(R)) return; S.readings.unshift(R); if (S.readings.length > 50) S.readings.pop(); save(); checkBadges(); toast('Saved', 'ok'); drawReading(); drawSaved(); };
  $('#rd-next')?.addEventListener('click', () => generate(R.targets?.length ? pickWords() : null, R));
  $('#rd-tabs').querySelectorAll('button').forEach(b => b.onclick = () => tab(b.dataset.t));
  tab(curTab);
}

// ── Listening ───────────────────────────────────────────────────────────────
let currentPara = 0, audioRun = 0;   // audioRun: a stopped read-aloud must not continue when its last utterance ends
function setVeil(on) {
  veiled = on; const t = $('#rd-text'), b = $('#rd-veil'); if (!t || !b) return;
  t.classList.toggle('veil', on); b.textContent = on ? 'Show text' : 'Listen first';
}
function audioButtons() {
  const l = $('#rd-listen'); if (!l) return;
  l.hidden = playing; $('#rd-pause').hidden = !playing; $('#rd-stop').hidden = !playing; $('#rd-pause').textContent = paused ? 'Resume' : 'Pause';
}
function stopAudio(quiet) {
  playing = false; paused = false; audioRun++; stopSpeaking();
  document.querySelectorAll('#rd-text .say').forEach(x => x.classList.remove('say'));
  if (!quiet) { audioButtons(); if (veiled) setVeil(false); }
}
function togglePause() {
  if (!playing || !('speechSynthesis' in window)) return;
  paused = !paused; if (paused) speechSynthesis.pause(); else speechSynthesis.resume();
  audioButtons();
}
function readAloud(from) {
  const ps = [...document.querySelectorAll('#rd-text p')]; if (!ps.length) return;
  const run = ++audioRun; playing = true; paused = false; audioButtons();
  let i = from;
  const next = () => {
    if (run !== audioRun || !playing || !$('#rd-text')) return;
    if (i >= ps.length) { stopAudio(); return; }
    currentPara = i; const p = ps[i++], text = p.textContent, spans = [...p.querySelectorAll('.rw')];
    let pos = 0; const starts = spans.map(s => { const at = text.indexOf(s.textContent, pos); pos = at < 0 ? pos : at + s.textContent.length; return at; });
    speak(text, { rate, onBoundary: ev => { if (ev.name && ev.name !== 'word') return; spans.forEach(s => s.classList.remove('say')); let k = 0; while (k + 1 < starts.length && starts[k + 1] <= ev.charIndex) k++; spans[k]?.classList.add('say'); }, onEnd: () => { spans.forEach(s => s.classList.remove('say')); next(); } });
  };
  next();
}

// ── Farsi for one paragraph ─────────────────────────────────────────────────
async function farsi(btn) {
  const i = +btn.dataset.fa, box = $(`#fa-${i}`); if (!box) return;
  if (!box.hidden) { box.hidden = true; btn.textContent = 'Show Farsi'; return; }
  if (!R.fa?.[i]) {
    const r = R; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { const t = (await ask(`Translate this English paragraph into natural, fluent Farsi. Return only the translation.\n"""${r.paragraphs[i]}"""`, { maxTokens: 900 })).trim(); (r.fa ||= {})[i] = t; if (S.readings.includes(r)) save(); }
    catch (e) { toast(e.message, 'err'); }
    if (!btn.isConnected || R !== r) return;
    btn.disabled = false;
    if (!R.fa?.[i]) { btn.textContent = 'Translate to Farsi'; return; }
  }
  box.textContent = R.fa[i]; box.hidden = false; btn.textContent = 'Hide Farsi';
}

// ── Tabs under the passage ──────────────────────────────────────────────────
function tab(t) {
  curTab = t; const el = $('#rd-tab'); if (!el || !R) return;
  $('#rd-tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  const ai = !!aiAvailable();
  if (t === 'vocab') {
    if (!R.vocab.length) { el.innerHTML = `<p class="muted small">${R.source === 'paste' ? 'Tap any word in the text to look it up and add it to a deck.' : 'No key words for this passage.'}</p>`; return; }
    const idx = deckIndex();
    el.innerHTML = `<div class="row between" style="margin-bottom:10px"><div class="row"><span class="small muted">Add to</span>${deckPicker('rd-deck')}</div><button class="btn btn-sm" id="rd-addall">Add all</button></div>
      <div class="wl">${R.vocab.map((v, i) => { const have = findIn(idx, v.word); return `<div class="wi"><div class="t"><b>${esc(v.word)}</b> <span class="phon" style="font-size:13px">${esc(v.phonetic || '')}</span> ${v.type ? `<span class="chip">${esc(v.type)}</span>` : ''}<small>${esc(v.definition || '')}${v.farsi ? ` · <span lang="fa" class="fa" style="display:inline">${esc(v.farsi)}</span>` : ''}</small></div><button class="btn btn-sm" data-add="${i}" ${have ? 'disabled' : ''}>${have ? 'In your decks' : 'Add'}</button></div>`; }).join('')}</div>`;
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => { const d = await resolveDeck(); if (!d) return; if (addTo(d, R.vocab[+b.dataset.add])) { b.textContent = 'Added'; b.disabled = true; } });
    $('#rd-addall').onclick = async () => { const d = await resolveDeck(); if (!d) return; let n = 0; R.vocab.forEach((v, i) => { const b = el.querySelector(`[data-add="${i}"]`); if (b && !b.disabled && addTo(d, v, true)) { n++; b.textContent = 'Added'; b.disabled = true; } }); toast(n ? `Added ${plural(n, 'word')} to ${d.name}` : 'Those words are already in your decks', n ? 'ok' : ''); };
  } else if (t === 'quiz') {
    if (!R.quiz.length) {
      el.innerHTML = R.extras === 'loading' ? '<p class="muted small"><span class="spin"></span> Writing questions about this passage…</p>'
        : ai ? `<p class="muted small" style="margin-bottom:10px">${R.extras === 'failed' ? 'The questions could not be written.' : 'No questions yet for this text.'}</p><button class="btn btn-sm btn-primary" id="rd-mkquiz">Write a quiz for this text</button>`
        : `<p class="muted small">${esc(aiHint())} A quiz needs AI.</p>`;
      $('#rd-mkquiz')?.addEventListener('click', () => { R.extras = null; extras(R); });
      return;
    }
    let score = 0, answered = 0; const r = R;
    el.innerHTML = `<p class="muted small" id="q-score">${R.quizResult ? `Last time: ${R.quizResult.score} of ${R.quizResult.total}. ` : ''}Answer all ${R.quiz.length} questions.</p>` + R.quiz.map((q, qi) => `<div class="quiz-q"><h4>${qi + 1}. ${esc(q.q)}</h4><div class="opts">${(q.options || []).map((o, oi) => `<button class="opt" data-q="${qi}" data-o="${oi}">${esc(String(o).replace(/^[A-D][.)]\s*/, ''))}</button>`).join('')}</div><div class="expl" id="ex-${qi}">${esc(q.why || '')}</div></div>`).join('');
    el.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const qi = +b.dataset.q, ok = +b.dataset.o === +r.quiz[qi].answer;
      el.querySelectorAll(`[data-q="${qi}"]`).forEach(x => { x.disabled = true; if (+x.dataset.o === +r.quiz[qi].answer) x.classList.add('ok'); });
      if (!ok) b.classList.add('no'); else { score++; awardXP(8, null); }
      answered++; $(`#ex-${qi}`).style.display = 'block';
      $('#q-score').textContent = `${score} of ${answered} correct so far.`;
      if (answered === r.quiz.length) {   // remember the result with the reading
        r.quizResult = { score, total: r.quiz.length, date: today() };
        logActivity({ kind: 'reading', title: calTitle(r), detail: `quiz ${score}/${r.quiz.length}` });
        $('#q-score').textContent = `Finished: ${score} of ${r.quiz.length} correct.`;
        if (S.readings.includes(r)) { save(); drawSaved(); }
        if (R === r) $('#rd-tabs [data-t="quiz"]').textContent = quizLabel();
      }
    });
  } else if (t === 'phrases') {
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn btn-sm btn-primary" id="rd-phr" ${ai ? '' : 'disabled'}>Find useful phrases</button><span class="small muted">${ai ? 'Collocations and fixed expressions from this passage' : esc(aiHint())}</span></div><div id="rd-phr-out">${R.phrases ? phrasesHTML() : ''}</div>`;
    if (R.phrases) wirePhrases();
    $('#rd-phr').onclick = async e => {
      const b = e.currentTarget, r = R; b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try { r.phrases = parseJSON(await ask(`From this text extract 8 useful phrases, collocations or fixed expressions:\n"${fullText(r).slice(0, 2500)}"\nReturn ONLY a JSON array: [{"phrase":"...","type":"collocation|idiom|fixed expression|linking phrase","meaning":"...","farsi":"...","example":"a new example sentence"}]. No markdown.`, { maxTokens: 1400 }), 'array').filter(p => p && p.phrase); if (S.readings.includes(r)) save(); }
      catch (err) { toast(err.message, 'err'); }
      if (R === r && curTab === 'phrases') tab('phrases');
    };
  } else {
    const s = R.summary;
    el.innerHTML = `<p class="muted small" style="margin-bottom:8px">In two or three sentences, say what this passage is about. Writing it in your own words is what makes the new vocabulary stick.</p>
      <textarea id="rd-sum" style="min-height:90px" placeholder="This passage is about…">${esc(s?.text || '')}</textarea>
      <div class="row between" style="margin-top:10px"><span class="small muted">${ai ? '' : esc(aiHint())}</span><button class="btn btn-sm btn-primary" id="rd-sumgo" ${ai ? '' : 'disabled'}>Check my summary</button></div>
      <div id="rd-sumout" style="margin-top:12px">${s?.corrected ? summaryHTML(s) : ''}</div>`;
    $('#rd-sumgo').onclick = async e => {
      const text = $('#rd-sum').value.trim(), b = e.currentTarget, r = R;
      if (text.split(/\s+/).length < 5) { toast('Write at least one full sentence', 'err'); return; }
      b.disabled = true; b.innerHTML = '<span class="spin"></span> Checking…';
      try {
        const d = parseJSON(await ask(`A Farsi-speaking English learner read this passage:\n"""${fullText(r).slice(0, 3500)}"""\nand wrote this summary:\n"""${text.slice(0, 1200)}"""\nReturn ONLY JSON: {"corrected":"their summary with grammar and word choice fixed, same meaning and length","accurate":true,"feedback":"two short sentences in simple English: what is good, and the one thing to fix","farsi":"یک جمله بازخورد به فارسی"}\n"accurate" is false if the summary does not match what the passage says. No markdown.`, { maxTokens: 800 }), 'object');
        r.summary = { text, corrected: String(d.corrected || text), accurate: d.accurate !== false, feedback: String(d.feedback || ''), farsi: String(d.farsi || '') };
        awardXP(10, 'Summary checked'); if (S.readings.includes(r)) save();
      } catch (err) { toast(err.message, 'err'); }
      if (R === r && curTab === 'write') tab('write');
    };
  }
}
const summaryHTML = s => `<div class="panel tight"><div class="lbl">Corrected</div><p style="margin-bottom:10px">${esc(s.corrected)}</p>${s.accurate ? '' : '<p class="notice warn" style="margin-bottom:10px">This doesn’t quite match what the passage says — read it once more.</p>'}${s.feedback ? `<p class="small muted">${esc(s.feedback)}</p>` : ''}${s.farsi ? `<p lang="fa" class="fa small" style="font-size:14px">${esc(s.farsi)}</p>` : ''}</div>`;
const phrasesHTML = () => `<div class="row" style="margin-bottom:10px"><span class="small muted">Add to</span>${deckPicker('rd-pdeck')}</div><div class="wl">${R.phrases.map((p, i) => `<div class="wi"><div class="t"><b>${esc(p.phrase)}</b> ${p.type ? `<span class="chip">${esc(p.type)}</span>` : ''}<small>${esc(p.meaning || '')}${p.farsi ? ` · <span lang="fa" class="fa" style="display:inline">${esc(p.farsi)}</span>` : ''}</small></div><button class="btn btn-sm" data-padd="${i}">Add</button></div>`).join('')}</div>`;
function wirePhrases() { document.querySelectorAll('[data-padd]').forEach(b => b.onclick = async () => { const d = await resolveDeck(); if (!d) return; const p = R.phrases[+b.dataset.padd]; if (addTo(d, { word: p.phrase, type: p.type || 'phrase', definition: p.meaning, example: p.example, farsi: p.farsi })) { b.textContent = 'Added'; b.disabled = true; } }); }
function addTo(deck, data, quiet) {
  const w = String(data.word || '').trim().toLowerCase(); if (!w) return false;
  if (deck.cards.some(c => c.word.toLowerCase() === w)) { if (!quiet) toast(`“${data.word}” is already in ${deck.name}`, 'err'); return false; }
  deck.cards.push(newCard(data)); recordNewWords([data.word]); awardXP(3, null); save(); checkBadges(); if (!quiet) toast(`Added “${data.word}” to ${deck.name}`, 'ok'); return true;
}

// ── Word popup: your own card first, then this passage's word list, then AI ──
// ctx = where the word was tapped: { title, vocab, glossary, pause() }. The Read page passes its reading.
export function lookup(e, span, ctx = R) {
  e.stopPropagation(); closePopups();
  const word = span.dataset.w, sentence = span.closest('.sent')?.textContent.trim() || '';
  document.querySelectorAll('.rw.hi').forEach(x => x.classList.remove('hi')); span.classList.add('hi');
  const quiet = () => { if (ctx?.pause) ctx.pause(); else stopAudio(); };
  const pop = document.createElement('div'); pop.className = 'popup';
  pop.innerHTML = `<div class="ph"><div><div class="w">${esc(word)}</div><div class="row small" id="pp-meta" style="margin-top:4px;gap:6px"></div></div><div class="row" style="gap:2px;flex-wrap:nowrap"><button class="icon-btn" id="pp-say" title="Hear the word" aria-label="Hear the word">${ico('volume')}</button><button class="icon-btn" id="pp-clips" title="Hear it in real videos" aria-label="Hear it in real videos">${ico('play')}</button><button class="icon-btn" id="pp-x" title="Close" aria-label="Close">${ico('x')}</button></div></div>
    <div class="pb" id="pp-body"></div>
    <div class="pf" id="pp-foot"></div>`;
  document.body.append(pop);
  const r = span.getBoundingClientRect(), pw = Math.min(420, innerWidth * .94), ph = Math.min(560, innerHeight * .85);
  let left = r.left, top = r.bottom + 8; if (left + pw + 8 > innerWidth) left = innerWidth - pw - 8; if (top + ph > innerHeight) top = Math.max(8, r.top - ph - 8);
  pop.style.left = Math.max(4, left) + 'px'; pop.style.top = Math.max(4, top) + 'px';
  pop.querySelector('#pp-x').onclick = () => pop.remove(); pop.querySelector('#pp-say').onclick = () => { quiet(); speak(word, { rate }); };
  pop.querySelector('#pp-clips').onclick = () => { quiet(); openClips(word); };
  drag(pop);
  const body = pop.querySelector('#pp-body'), foot = pop.querySelector('#pp-foot');
  const hear = sentence ? `<button class="btn btn-sm btn-ghost" id="pp-sent">${ico('volume')} Hear sentence</button>` : '<span></span>';
  const wireHear = () => pop.querySelector('#pp-sent')?.addEventListener('click', () => { quiet(); speak(sentence, { rate }); });
  const show = (d, own) => {
    pop.querySelector('.w').textContent = d.word || word;
    pop.querySelector('#pp-meta').innerHTML = `${d.phonetic ? `<span class="phon" style="font-size:13px">${esc(d.phonetic)}</span>` : ''}${d.type ? `<span class="chip">${esc(d.type)}</span>` : ''}`;
    body.innerHTML = `<div><div class="lbl">Meaning</div><div>${esc(d.definition || '—')}</div></div>
      ${d.farsi ? `<div><div class="lbl">Farsi</div><div lang="fa" class="fa" style="font-size:16px">${esc(d.farsi)}</div></div>` : ''}
      ${d.example ? `<div><div class="lbl">Example</div><div class="ex" style="font-size:13.5px">${esc(d.example)}</div></div>` : ''}
      ${Array.isArray(d.collocs) && d.collocs.length ? `<div><div class="lbl">Often used with</div><div class="row" style="gap:6px">${d.collocs.map(x => `<span class="chip">${esc(x.c)}</span>`).join('')}</div></div>` : ''}`;
    if (own) { foot.innerHTML = `${hear}<span class="chip moss">In ${esc(own.deck.name)} · stage ${own.card.lbox}</span>`; wireHear(); return; }
    foot.innerHTML = `${hear}<div class="row" style="gap:6px;flex-wrap:nowrap">${deckPicker('pp-deck')}<button class="btn btn-primary btn-sm" id="pp-add">Add</button></div>`; wireHear();
    const add = pop.querySelector('#pp-add');
    add.onclick = async () => { const deck = await resolveDeck(); if (!deck) return; if (addTo(deck, { ...d, word: d.word || word })) { add.textContent = 'Added'; add.disabled = true; span.classList.add('mine'); } };
  };
  const own = findIn(deckIndex(), word);
  if (own) return show({ ...own.card }, own);
  const local = listFind(ctx?.vocab, word) || listFind(ctx?.glossary, word) || cache.get(norm(word));
  if (local) return show(local);
  if (!aiAvailable()) {   // no AI: the learner can still save the word with their own note
    body.innerHTML = `<p class="small muted">This word isn’t in your decks. Add it with your own note, or turn on AI in Settings for automatic meanings.</p>
      <label class="field"><span>Meaning</span><input type="text" id="pp-def" placeholder="What does it mean?"></label>
      <label class="field"><span>Farsi (optional)</span><input type="text" id="pp-fa" lang="fa" class="fa"></label>`;
    foot.innerHTML = `${hear}<div class="row" style="gap:6px;flex-wrap:nowrap">${deckPicker('pp-deck')}<button class="btn btn-primary btn-sm" id="pp-add">Add</button></div>`; wireHear();
    pop.querySelector('#pp-add').onclick = async () => {
      const def = pop.querySelector('#pp-def').value.trim(); if (!def) { pop.querySelector('#pp-def').focus(); return; }
      const deck = await resolveDeck(); if (!deck) return;
      if (addTo(deck, { word: norm(word), definition: def, farsi: pop.querySelector('#pp-fa').value, example: sentence })) { span.classList.add('mine'); pop.remove(); }
    };
    return;
  }
  body.innerHTML = '<p class="small muted"><span class="spin"></span> Looking up…</p>'; foot.innerHTML = hear; wireHear();
  lookupWord(word, ctx?.title || 'general English').then(d => { cache.set(norm(word), d); if (pop.isConnected) show(d); })
    .catch(err => { if (pop.isConnected) body.innerHTML = `<p class="notice bad">${esc(err.message)}</p>`; });
}
function drag(pop) {
  const h = pop.querySelector('.ph'); let ox, oy, on = false;
  h.onpointerdown = e => { if (e.target.closest('button') || innerWidth <= 820) return; on = true; const r = pop.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; h.setPointerCapture(e.pointerId); };
  h.onpointermove = e => { if (!on) return; pop.style.left = Math.max(0, Math.min(innerWidth - pop.offsetWidth, e.clientX - ox)) + 'px'; pop.style.top = Math.max(0, Math.min(innerHeight - pop.offsetHeight, e.clientY - oy)) + 'px'; };
  h.onpointerup = () => { on = false; };
}
let selTimer;
function onSelect() {
  clearTimeout(selTimer); selTimer = setTimeout(async () => {
    const sel = getSelection(); const text = sel?.toString().trim(); if (!text || text.split(/\s+/).length < 2 || text.length > 500 || !aiAvailable()) return;
    closePopups(); const r = sel.getRangeAt(0).getBoundingClientRect();
    const pop = document.createElement('div'); pop.className = 'popup'; pop.style.width = '340px';
    pop.innerHTML = `<div class="ph"><div class="small" style="font-weight:600">Selected phrase</div><button class="icon-btn" id="sp-x" aria-label="Close">${ico('x')}</button></div><div class="pb"><div class="small" style="line-height:1.6">“${esc(text.length > 160 ? text.slice(0, 160) + '…' : text)}”</div><div><div class="lbl">Farsi</div><div lang="fa" class="fa" id="sp-fa" style="font-size:15px"><span class="spin"></span></div></div><div><div class="lbl">Explanation</div><div class="small" id="sp-ex"></div></div></div>`;
    document.body.append(pop); pop.style.left = Math.max(8, Math.min(innerWidth - 348, r.left)) + 'px'; pop.style.top = Math.min(innerHeight - 300, r.bottom + 8) + 'px';
    pop.querySelector('#sp-x').onclick = () => pop.remove(); drag(pop);
    try { const d = parseJSON(await ask(`For this English phrase: "${text}"\nReturn ONLY JSON: {"farsi":"ترجمه دقیق و روان به فارسی","explanation":"2 short sentences in simple English about meaning and tone"}. No markdown.`, { maxTokens: 350 }), 'object'); pop.querySelector('#sp-fa').textContent = d.farsi || '—'; pop.querySelector('#sp-ex').textContent = d.explanation || ''; } catch (e) { pop.querySelector('#sp-fa').textContent = e.message; }
  }, 300);
}
document.addEventListener('pointerdown', e => { const t = e.target; if (!t?.closest || (!t.closest('.popup') && !t.closest('.overlay') && !t.classList.contains('rw'))) closePopups(); });

// ── Saved readings ──────────────────────────────────────────────────────────
function drawSaved() {
  const el = $('#rd-saved'); if (!el) return;
  if (!S.readings.length) { el.innerHTML = '<div class="empty" style="padding:24px"><p>Readings you save appear here, with your quiz result, so you can come back to them.</p></div>'; return; }
  el.innerHTML = `<div class="wl">${S.readings.map((r, i) => `<div class="wi"><div class="t"><b>${esc(r.title)}${r.part ? ` — part ${Number(r.part) || ''}` : ''}</b><small>${esc(r.level || '')} · ${new Date(r.created).toLocaleDateString()} · ${plural((r.paragraphs || []).length, 'paragraph')}${r.quizResult ? ` · quiz ${Number(r.quizResult.score) || 0}/${Number(r.quizResult.total) || 0}` : ''}</small></div><div class="acts"><button class="btn btn-sm" data-open="${i}">Open</button><button class="icon-btn" data-ren="${i}" title="Rename" aria-label="Rename">${ico('edit')}</button><button class="icon-btn danger" data-del="${i}" title="Delete" aria-label="Delete">${ico('trash')}</button></div></div>`).join('')}</div>`;
  el.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const r = S.readings[+b.dataset.ren]; const n = await promptDialog('Rename reading', { label: 'Title', value: r.title, okLabel: 'Rename' }); if (n && n !== r.title) { r.title = n.slice(0, 120); save(); toast('Renamed', 'ok'); drawSaved(); if (R === r) drawReading(); } });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { R = S.readings[+b.dataset.open]; curTab = 'vocab'; drawReading(); $('#rd-out').scrollIntoView({ behavior: 'smooth' }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const r = S.readings[+b.dataset.del]; if (await confirmDialog('Delete reading?', `“${r.title}” will be removed.`, { danger: true, okLabel: 'Delete' })) { S.readings = S.readings.filter(x => x !== r); save(); drawSaved(); if (R === r) drawReading(); } });
}
