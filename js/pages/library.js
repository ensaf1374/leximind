import { html, raw, esc, $, toast, modal, confirmDialog, promptDialog, navigate, el } from '../lib/ui.js';
import { S, save, newDeck, newCard, recordNewWords, today, downloadFile } from '../lib/store.js';
import { generateCards, cardsForWords, enrichBatch, aiAvailable, aiHint, LEVELS, lookupWord } from '../lib/ai.js';
import { progress } from '../lib/srs.js';
import { ticks } from './study.js';
import { awardXP, checkBadges } from '../lib/gamify.js';
import * as supa from '../lib/supa.js';
import { speak } from '../lib/speech.js';
import { openClips } from '../lib/clips.js';

// ── Shared deck picker used by Read / Collocations / popups ─────────────────
// Wherever a page has an "Add" button, the destination deck is always visible on a button next to it
// ("Deck: Everyday English"). The first Add asks which deck — or lets you create one — and remembers the answer.
let lastDeck = (() => { try { return localStorage.getItem('lm:lastDeck'); } catch { return null; } })();
const chosen = () => S.decks[lastDeck] || null;
const pickerLabel = () => `${esc(chosen() ? `Deck: ${chosen().name}` : 'Choose a deck')}<i data-ico="chevron" aria-hidden="true"></i>`;
export function deckPicker(id) {
  return `<button type="button" class="btn btn-sm deck-pick" id="${id}" data-deckpick title="Choose where new cards are added">${pickerLabel()}</button>`;
}
function setDeck(d) {
  lastDeck = d.id; try { localStorage.setItem('lm:lastDeck', d.id); } catch {}
  document.querySelectorAll('[data-deckpick]').forEach(b => { b.innerHTML = pickerLabel(); });
}
// Dialog: pick one of your decks, or type a name to create a new one. Resolves to the deck, or null if cancelled.
export function chooseDeck() {
  return new Promise(res => {
    let result = null;
    const decks = Object.values(S.decks), body = el('div', { class: 'stack' });
    body.innerHTML = `${decks.length ? `<div class="list" style="max-height:260px;overflow:auto">${decks.map(d => `<button type="button" class="item click" data-id="${esc(d.id)}" style="width:100%;text-align:left"><div class="t"><b>${esc(d.name)}</b><small>${d.cards.length} card${d.cards.length === 1 ? '' : 's'}</small></div>${d.id === lastDeck ? '<span class="chip accent">current</span>' : ''}</button>`).join('')}</div>` : '<p class="small muted">You have no decks yet. Create your first one:</p>'}
      <label class="field"><span>${decks.length ? 'Or create a new deck' : 'Deck name'}</span><div class="row" style="flex-wrap:nowrap"><input type="text" id="cd-name" placeholder="e.g. Words from reading"><button type="button" class="btn btn-primary" id="cd-create">Create</button></div></label>`;
    const m = modal({ title: 'Add to which deck?', body, actions: [{ label: 'Cancel' }], onClose: () => res(result) });
    const done = d => { setDeck(d); result = d; m.close(); };
    body.querySelectorAll('[data-id]').forEach(b => b.onclick = () => done(S.decks[b.dataset.id]));
    const create = () => { const name = body.querySelector('#cd-name').value.trim(); if (!name) { body.querySelector('#cd-name').focus(); return; } const d = newDeck(name); S.decks[d.id] = d; save(); toast(`Deck “${d.name}” created`, 'ok'); done(d); };
    body.querySelector('#cd-create').onclick = create;
    body.querySelector('#cd-name').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
  });
}
// Used by every Add button: the remembered deck, or ask.
export async function resolveDeck() { return chosen() || chooseDeck(); }
document.addEventListener('click', e => { if (e.target.closest?.('[data-deckpick]')) chooseDeck(); });

export function openNewDeck() {
  const body = el('div', { class: 'stack' });
  body.innerHTML = `
    <label class="field"><span>Topic or name</span><input type="text" id="nd-topic" placeholder="e.g. Business English, Airport vocabulary, Words from my textbook"></label>
    <div class="grid grid-2"><label class="field"><span>Level</span><select id="nd-level">${LEVELS.map(l => `<option ${l.startsWith('Intermediate') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Cards to generate</span><select id="nd-n"><option>5</option><option selected>10</option><option>15</option><option>20</option><option>30</option></select></label></div>
    ${aiAvailable() ? '' : `<p class="notice warn">${esc(aiHint())} You can still create an empty deck and add words by hand.</p>`}
    <p class="small muted" id="nd-status"></p>`;
  const m = modal({ title: 'New deck', body, actions: [
    { label: 'Cancel' },
    { label: 'Empty deck', onClick: () => { const name = body.querySelector('#nd-topic').value.trim() || 'New deck'; const d = newDeck(name, { level: body.querySelector('#nd-level').value }); S.decks[d.id] = d; save(); checkBadges(); toast(`Deck “${d.name}” created`, 'ok'); navigate('library/' + d.id); } },
    { label: 'Generate with AI', cls: 'btn-primary', onClick: async (close, box) => {
      if (!aiAvailable()) { toast(aiHint(), 'err'); return false; }
      const topic = body.querySelector('#nd-topic').value.trim(); if (!topic) { body.querySelector('#nd-topic').focus(); return false; }
      const btn = box.querySelector('.acts .btn-primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Writing cards…'; body.querySelector('#nd-status').textContent = 'This takes 10–20 seconds.';
      try {
        const level = body.querySelector('#nd-level').value, n = +body.querySelector('#nd-n').value;
        const cards = await generateCards({ topic, level, count: n });
        if (!cards.length) throw new Error('No usable cards were returned');
        const d = newDeck(`${topic}`, { level }); d.cards = cards; S.decks[d.id] = d; recordNewWords(cards.map(c => c.word)); awardXP(20, 'New deck'); save(); checkBadges();
        toast(`${cards.length} cards created`, 'ok'); enrichBatch(cards); navigate('library/' + d.id); return true;
      } catch (e) { toast(e.message, 'err', 5000); btn.disabled = false; btn.textContent = 'Generate with AI'; body.querySelector('#nd-status').textContent = ''; return false; }
    } } ] });
  return m;
}

export default {
  render(main, _ctx, [deckId]) {
    if (deckId && S.decks[deckId]) return deckView(main, S.decks[deckId]);
    const decks = Object.values(S.decks);
    main.innerHTML = html`
      <div class="page-head"><div><h1>My decks</h1><p>${decks.length ? `${decks.reduce((a, d) => a + d.cards.length, 0)} cards across ${decks.length} deck${decks.length === 1 ? '' : 's'}.` : 'Decks hold your cards. Make one with AI, by hand, or borrow one from the community.'}</p></div>
      <div class="row"><a class="btn" href="#/community">Browse community</a><button class="btn btn-primary" id="lb-new">+ New deck</button></div></div>
      ${decks.length ? html`<div class="deck-list">${raw(decks.map(d => { const due = d.cards.filter(c => c.due <= today() && c.status !== 'new').length, m = d.cards.filter(c => c.status === 'mastered').length;
        return `<div class="deck" data-id="${esc(d.id)}" role="button" tabindex="0">${due ? `<span class="chip accent due-pill">${due} due</span>` : ''}<h3>${esc(d.name)}</h3><div class="meta">${d.cards.length} cards · ${m} mastered · ${esc(d.level || '')}${d.publishedId ? ' · shared' : ''}</div><div class="bar"><i style="width:${d.cards.length ? Math.round(m / d.cards.length * 100) : 0}%"></i></div><div class="actions"><a class="btn btn-sm btn-primary" href="#/study/${esc(d.id)}" data-stop>Study</a><a class="btn btn-sm" href="#/library/${esc(d.id)}" data-stop>Open</a><span style="flex:1"></span><button class="icon-btn" data-stop data-ren="${esc(d.id)}" title="Rename deck" aria-label="Rename deck"><i data-ico="edit"></i></button><button class="icon-btn danger" data-stop data-rm="${esc(d.id)}" title="Delete deck" aria-label="Delete deck"><i data-ico="trash"></i></button></div></div>`; }).join(''))}</div>`
      : html`<div class="empty"><h3>No decks yet</h3><p>Create one and let AI write the first cards, or start from a community deck.</p><button class="btn btn-primary" id="lb-new2">+ New deck</button></div>`}`;
    main.querySelectorAll('#lb-new,#lb-new2').forEach(b => b.onclick = openNewDeck);
    main.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const d = S.decks[b.dataset.ren]; if (d && await renameDeck(d)) this.render(main, _ctx, []); });
    main.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { const d = S.decks[b.dataset.rm]; if (d && await deleteDeck(d)) this.render(main, _ctx, []); });
    main.querySelectorAll('.deck').forEach(d => { d.onclick = e => { if (e.target.closest('[data-stop]')) return; navigate('library/' + d.dataset.id); }; d.onkeydown = e => { if (e.key === 'Enter') navigate('library/' + d.dataset.id); }; });
  }
};

async function renameDeck(d) {
  const n = await promptDialog('Rename deck', { label: 'Deck name', value: d.name, okLabel: 'Rename' });
  if (!n || n === d.name) return false;
  d.name = n.slice(0, 80); save(); toast('Deck renamed', 'ok'); return true;
}
async function deleteDeck(d) {
  if (!await confirmDialog('Delete deck?', `“${d.name}” and its ${d.cards.length} cards will be deleted permanently.${d.publishedId ? ' The copy shared with the community stays until you unpublish it.' : ''}`, { danger: true, okLabel: 'Delete deck' })) return false;
  delete S.decks[d.id]; save(); toast('Deck deleted', 'ok'); return true;
}

function deckView(main, d) {
  let filter = 'all', sort = 'added', q = '';
  const draw = () => {
    const t = today(); let cards = [...d.cards];
    if (filter !== 'all') cards = cards.filter(c => filter === 'due' ? (c.due <= t && c.status !== 'new') : c.status === filter);
    if (q) cards = cards.filter(c => c.word.toLowerCase().includes(q) || c.definition.toLowerCase().includes(q) || (c.farsi || '').includes(q));
    cards.sort((a, b) => sort === 'alpha' ? a.word.localeCompare(b.word) : sort === 'due' ? a.due.localeCompare(b.due) : sort === 'hard' ? b.lapses - a.lapses : (b.added || '').localeCompare(a.added || ''));
    const m = d.cards.filter(c => c.status === 'mastered').length, due = d.cards.filter(c => c.due <= t && c.status !== 'new').length;
    main.innerHTML = html`
      <div class="page-head"><div><a class="small muted" href="#/library">← My decks</a><h1 style="margin-top:6px">${d.name} <button class="icon-btn" id="dk-ren" title="Rename deck" aria-label="Rename deck" style="vertical-align:middle"><i data-ico="edit"></i></button></h1><p>${d.cards.length} cards · ${m} mastered · ${due} due today${d.description ? ` · ${d.description}` : ''}</p></div>
        <div class="row"><a class="btn btn-primary" href="#/study/${d.id}">Study</a><button class="btn" id="dk-add">+ Add word</button><button class="btn" id="dk-import">Import list</button><button class="btn" id="dk-more" ${aiAvailable() ? '' : 'disabled'}>Generate more</button><button class="btn" id="dk-menu" title="More actions" aria-label="More actions"><i data-ico="dots"></i></button></div></div>
      <div class="bar" style="margin-bottom:16px"><i style="width:${d.cards.length ? Math.round(m / d.cards.length * 100) : 0}%"></i></div>
      <div class="row between" style="margin-bottom:12px"><input type="search" id="dk-q" placeholder="Search words, meanings, Farsi…" value="${q}" style="max-width:320px">
        <div class="row"><select id="dk-filter" style="width:auto"><option value="all">All</option><option value="due">Due</option><option value="new">New</option><option value="learning">Learning</option><option value="review">Review</option><option value="mastered">Mastered</option></select>
        <select id="dk-sort" style="width:auto"><option value="added">Newest</option><option value="alpha">A–Z</option><option value="due">Due date</option><option value="hard">Hardest first</option></select></div></div>
      ${cards.length ? html`<div class="wl">${raw(cards.map(c => `<div class="wi ${c.due <= t && c.status !== 'new' ? 'due' : ''}"><div class="t"><b>${esc(c.word)}</b> <span class="phon" style="font-size:13px">${esc(c.phonetic)}</span> <span class="chip" style="padding:0 8px">${esc(c.status)}</span>${c.lbox ? `<span class="chip accent" style="padding:0 8px;margin-left:4px">stage ${c.lbox}</span>` : ''}<small>${esc(c.definition)}${c.farsi ? ` · <span lang="fa" class="fa" style="display:inline">${esc(c.farsi)}</span>` : ''}</small><div class="row" style="margin-top:4px">${ticks(c)}<span class="small muted">${c.reps} reviews · next ${c.due}</span></div></div><div class="acts"><button class="icon-btn" data-say="${esc(c.id)}" title="Pronounce" aria-label="Pronounce"><i data-ico="volume"></i></button>${c.type === 'sentence' ? '' : `<button class="icon-btn" data-clip="${esc(c.id)}" title="Hear it in real videos" aria-label="Hear it in real videos"><i data-ico="play"></i></button>`}<button class="icon-btn" data-edit="${esc(c.id)}" title="Edit"><i data-ico="edit"></i></button><button class="icon-btn danger" data-del="${esc(c.id)}" title="Delete"><i data-ico="trash"></i></button></div></div>`).join(''))}</div>`
      : html`<div class="empty"><h3>${d.cards.length ? 'No cards match' : 'This deck is empty'}</h3><p>${d.cards.length ? 'Try a different filter.' : 'Add a word, paste a list, or let AI generate cards.'}</p></div>`}`;
    $('#dk-filter').value = filter; $('#dk-sort').value = sort;
    $('#dk-filter').onchange = e => { filter = e.target.value; draw(); }; $('#dk-sort').onchange = e => { sort = e.target.value; draw(); };
    $('#dk-q').oninput = e => { q = e.target.value.toLowerCase(); draw(); $('#dk-q').focus(); $('#dk-q').setSelectionRange(q.length, q.length); };
    main.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(d.cards.find(c => c.id === b.dataset.say)?.word));
    main.querySelectorAll('[data-clip]').forEach(b => b.onclick = () => openClips(d.cards.find(c => c.id === b.dataset.clip)?.word));
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editCard(d, d.cards.find(c => c.id === b.dataset.edit), draw));
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const c = d.cards.find(x => x.id === b.dataset.del); if (await confirmDialog('Delete word?', `“${c.word}” and its progress will be removed.`, { danger: true, okLabel: 'Delete' })) { d.cards = d.cards.filter(x => x !== c); save(); draw(); } });
    $('#dk-add').onclick = () => addWord(d, draw); $('#dk-import').onclick = () => importList(d, draw); $('#dk-more').onclick = () => generateMore(d, draw);
    $('#dk-menu').onclick = () => deckMenu(d, draw);
    $('#dk-ren').onclick = async () => { if (await renameDeck(d)) draw(); };
  };
  draw();
}

export function editCard(d, c, done) {
  const body = el('div', { class: 'stack' });
  body.innerHTML = `<div class="grid grid-2"><label class="field"><span>Word</span><input id="ew-word" type="text" value="${esc(c.word)}"></label><label class="field"><span>Phonetic</span><input id="ew-ph" type="text" value="${esc(c.phonetic)}"></label></div>
    <label class="field"><span>Type</span><select id="ew-type">${['noun', 'verb', 'adjective', 'adverb', 'phrase', 'idiom', 'collocation', 'word'].map(t => `<option ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="field"><span>Definition</span><textarea id="ew-def">${esc(c.definition)}</textarea></label>
    <label class="field"><span>Example</span><textarea id="ew-ex" style="min-height:60px">${esc(c.example)}</textarea></label>
    <label class="field"><span>Farsi</span><input id="ew-fa" type="text" lang="fa" class="fa" value="${esc(c.farsi)}"></label>
    <label class="field"><span>Synonyms (comma separated)</span><input id="ew-syn" type="text" value="${esc(c.synonyms.join(', '))}"></label>`;
  modal({ title: 'Edit card', body, actions: [{ label: 'Cancel' }, { label: 'Save changes', cls: 'btn-primary', onClick: () => {
    const w = body.querySelector('#ew-word').value.trim(); if (!w) return false;
    if (w.toLowerCase() !== c.word.toLowerCase()) { c.collocs = []; c.context = []; }
    c.word = w; c.phonetic = body.querySelector('#ew-ph').value.trim(); c.type = body.querySelector('#ew-type').value; c.definition = body.querySelector('#ew-def').value.trim() || c.definition; c.example = body.querySelector('#ew-ex').value.trim(); c.farsi = body.querySelector('#ew-fa').value.trim(); c.synonyms = body.querySelector('#ew-syn').value.split(',').map(s => s.trim()).filter(Boolean);
    save(); toast('Card updated', 'ok'); done(); } }] });
}

function addWord(d, done) {
  const body = el('div', { class: 'stack' });
  body.innerHTML = `<label class="field"><span>Word or phrase</span><input id="aw-word" type="text" class="big-input" style="text-align:left" placeholder="e.g. resilient, break the ice, take into account"></label>
    <div id="aw-preview"></div>
    <details><summary class="small muted" style="cursor:pointer">Fill in by hand instead</summary><div class="stack" style="margin-top:10px">
      <label class="field"><span>Definition</span><textarea id="aw-def" style="min-height:60px"></textarea></label>
      <label class="field"><span>Example</span><input id="aw-ex" type="text"></label>
      <div class="grid grid-2"><label class="field"><span>Type</span><select id="aw-type">${['noun', 'verb', 'adjective', 'adverb', 'phrase', 'idiom'].map(t => `<option>${t}</option>`).join('')}</select></label><label class="field"><span>Farsi</span><input id="aw-fa" type="text" lang="fa" class="fa"></label></div></div></details>`;
  const m = modal({ title: `Add to ${d.name}`, body, actions: [
    { label: 'Cancel' },
    { label: 'Add by hand', onClick: () => { const w = body.querySelector('#aw-word').value.trim(), def = body.querySelector('#aw-def').value.trim(); if (!w || !def) { toast('Word and definition are required', 'err'); return false; } push(newCard({ word: w, definition: def, example: body.querySelector('#aw-ex').value, type: body.querySelector('#aw-type').value, farsi: body.querySelector('#aw-fa').value })); } },
    { label: 'Look up & add', cls: 'btn-primary', onClick: async (close, box) => {
      const w = body.querySelector('#aw-word').value.trim(); if (!w) return false;
      if (!aiAvailable()) { toast(aiHint(), 'err'); return false; }
      const btn = box.querySelector('.acts .btn-primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      try { const data = await lookupWord(w, d.name); const c = newCard({ ...data, word: data.word || w }); if (!c.definition) throw new Error('No definition came back'); push(c); return true; }
      catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Look up & add'; return false; }
    } } ] });
  function push(c) { if (d.cards.some(x => x.word.toLowerCase() === c.word.toLowerCase())) { toast(`“${c.word}” is already in this deck`, 'err'); return; } d.cards.push(c); recordNewWords([c.word]); awardXP(3, null); save(); checkBadges(); toast(`Added “${c.word}”`, 'ok'); done(); }
  body.querySelector('#aw-word').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.box.querySelector('.acts .btn-primary').click(); } });
}

function importList(d, done) {
  const body = el('div', { class: 'stack' });
  body.innerHTML = `<p class="small muted">One word per line, or comma separated. Up to 40 at a time. ${aiAvailable() ? 'AI writes the definition, example and Farsi for each.' : 'Without AI, words are added with an empty definition you can edit later.'}</p>
    <textarea id="im-words" style="min-height:160px" placeholder="perseverance&#10;eloquent&#10;take for granted"></textarea>
    <div id="im-prog" class="small muted"></div>`;
  modal({ title: 'Import words', body, actions: [{ label: 'Cancel' }, { label: 'Import', cls: 'btn-primary', onClick: async (close, box) => {
    const have = new Set(d.cards.map(c => c.word.toLowerCase()));
    let words = [...new Set(body.querySelector('#im-words').value.split(/[\n,;]+/).map(w => w.trim()).filter(Boolean))];
    const dup = words.filter(w => have.has(w.toLowerCase())).length; words = words.filter(w => !have.has(w.toLowerCase())).slice(0, 40);
    if (!words.length) { toast(dup ? 'All of those are already in the deck' : 'Enter some words first', 'err'); return false; }
    const btn = box.querySelector('.acts .btn-primary'); btn.disabled = true;
    const added = [];
    if (aiAvailable()) {
      for (let i = 0; i < words.length; i += 6) {
        const batch = words.slice(i, i + 6); body.querySelector('#im-prog').textContent = `Writing cards ${i + 1}–${Math.min(i + 6, words.length)} of ${words.length}…`;
        try { added.push(...await cardsForWords(batch)); } catch { added.push(...batch.map(w => newCard({ word: w, definition: '' }))); }
      }
    } else added.push(...words.map(w => newCard({ word: w })));
    d.cards.push(...added); recordNewWords(added.map(c => c.word)); awardXP(added.length * 2, `${added.length} words imported`); save(); checkBadges();
    const pending = added.filter(c => !c.definition).length;
    toast(`Imported ${added.length} words${dup ? ` · ${dup} skipped (already there)` : ''}${pending ? ` · ${pending} need a definition` : ''}`, pending ? 'err' : 'ok', 5000);
    enrichBatch(added); done();
  } }] });
}

function generateMore(d, done) {
  const body = el('div', { class: 'stack' });
  body.innerHTML = `<label class="field"><span>Topic for the new words</span><input id="gm-topic" type="text" value="${esc(d.name)}"></label><div class="grid grid-2"><label class="field"><span>Level</span><select id="gm-level">${LEVELS.map(l => `<option ${(d.level || '').startsWith(l.split(' ')[0]) ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="field"><span>How many</span><select id="gm-n"><option>5</option><option selected>10</option><option>15</option><option>20</option></select></label></div><p class="small muted">Words already in the deck are skipped automatically.</p>`;
  modal({ title: 'Generate more cards', body, actions: [{ label: 'Cancel' }, { label: 'Generate', cls: 'btn-primary', onClick: async (close, box) => {
    const btn = box.querySelector('.acts .btn-primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { const have = new Set(d.cards.map(c => c.word.toLowerCase())); const cards = (await generateCards({ topic: body.querySelector('#gm-topic').value.trim() || d.name, level: body.querySelector('#gm-level').value, count: +body.querySelector('#gm-n').value, exclude: d.cards.map(c => c.word) })).filter(c => !have.has(c.word.toLowerCase()));
      if (!cards.length) throw new Error('No new words came back — try a more specific topic'); d.cards.push(...cards); recordNewWords(cards.map(c => c.word)); awardXP(10, null); save(); toast(`Added ${cards.length} cards`, 'ok'); enrichBatch(cards); done(); return true; }
    catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Generate'; return false; }
  } }] });
}

function deckMenu(d, done) {
  const body = el('div', { class: 'stack' });
  const canShare = supa.configured();
  body.innerHTML = `<div class="kv"><span>Rename deck</span><button class="btn btn-sm" id="mn-rename">Rename</button></div>
    <div class="kv"><span>Export</span><div class="row"><button class="btn btn-sm" id="mn-csv">CSV</button><button class="btn btn-sm" id="mn-anki">Anki (TSV)</button><button class="btn btn-sm" id="mn-json">JSON</button></div></div>
    <div class="kv"><span>${d.publishedId ? 'Shared with the community' : 'Share with the community'}</span><div class="row">${canShare ? `<button class="btn btn-sm ${d.publishedId ? '' : 'btn-primary'}" id="mn-pub">${d.publishedId ? 'Update' : 'Publish'}</button>${d.publishedId ? '<button class="btn btn-sm btn-danger" id="mn-unpub">Unpublish</button>' : ''}` : '<span class="small muted">Needs cloud setup</span>'}</div></div>
    <div class="kv"><span>Reset all progress in this deck</span><button class="btn btn-sm btn-danger" id="mn-reset">Reset</button></div>
    <div class="kv"><span>Delete deck</span><button class="btn btn-sm btn-danger" id="mn-del">Delete</button></div>`;
  const m = modal({ title: d.name, body, actions: [{ label: 'Close' }] });
  body.querySelector('#mn-rename').onclick = async () => { const n = await promptDialog('Rename deck', { value: d.name, okLabel: 'Rename' }); if (n) { d.name = n; save(); done(); m.close(); } };
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  body.querySelector('#mn-csv').onclick = () => downloadFile('Word,Phonetic,Type,Definition,Example,Farsi,Synonyms,Status,Reviews\n' + d.cards.map(c => [c.word, c.phonetic, c.type, c.definition, c.example, c.farsi, c.synonyms.join('; '), c.status, c.reps].map(q).join(',')).join('\n'), 'text/csv', d.name + '.csv');
  body.querySelector('#mn-anki').onclick = () => downloadFile(d.cards.map(c => [c.word + (c.phonetic ? `<br><i>${c.phonetic}</i>` : ''), `${c.definition}${c.example ? `<br><i>${c.example}</i>` : ''}${c.farsi ? `<br><span dir="rtl">${c.farsi}</span>` : ''}`, d.name.replace(/\s+/g, '_')].map(v => String(v).replace(/\t/g, ' ')).join('\t')).join('\n'), 'text/tab-separated-values', d.name + '.txt');
  body.querySelector('#mn-json').onclick = () => downloadFile(JSON.stringify(d, null, 2), 'application/json', d.name + '.json');
  body.querySelector('#mn-pub')?.addEventListener('click', () => { m.close(); publishDialog(d, done); });
  body.querySelector('#mn-unpub')?.addEventListener('click', async () => { try { await supa.unpublishDeck(d); toast('Removed from the community', 'ok'); m.close(); done(); } catch (e) { toast(e.message, 'err'); } });
  body.querySelector('#mn-reset').onclick = async () => { if (await confirmDialog('Reset progress?', 'Every card in this deck goes back to “new”. The words stay.', { danger: true, okLabel: 'Reset' })) { d.cards = d.cards.map(c => newCard({ ...c, status: undefined, reps: undefined, lapses: undefined, ef: undefined, interval: undefined, due: undefined, dueDate: undefined, ticks: undefined, lbox: undefined, lNext: undefined })); save(); m.close(); done(); } };
  body.querySelector('#mn-del').onclick = async () => { if (await confirmDialog('Delete deck?', `“${d.name}” and its ${d.cards.length} cards will be deleted permanently.`, { danger: true, okLabel: 'Delete deck' })) { delete S.decks[d.id]; save(); m.close(); toast('Deck deleted', 'ok'); navigate('library'); } };
}
function publishDialog(d, done) {
  if (!supa.user()) { toast('Sign in to share decks', 'err'); return; }
  const body = el('div', { class: 'stack' });
  body.innerHTML = `<p class="small muted">Everyone can browse and copy shared decks. Only the cards (words, meanings, examples, Farsi) are shared — never your progress.</p>
    <label class="field"><span>Description</span><textarea id="pb-desc" placeholder="Who is this deck for? Where do the words come from?">${esc(d.description || '')}</textarea></label>
    <label class="field"><span>Tags (comma separated)</span><input id="pb-tags" type="text" placeholder="business, ielts, travel"></label>`;
  modal({ title: d.publishedId ? 'Update shared deck' : 'Publish deck', body, actions: [{ label: 'Cancel' }, { label: d.publishedId ? 'Update' : 'Publish', cls: 'btn-primary', onClick: async (close, box) => {
    const btn = box.querySelector('.acts .btn-primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { d.description = body.querySelector('#pb-desc').value.trim(); await supa.publishDeck(d, { description: d.description, tags: body.querySelector('#pb-tags').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) }); awardXP(30, 'Deck shared'); checkBadges(); toast('Published to the community', 'ok'); done(); return true; }
    catch (e) { toast(e.message, 'err', 5000); btn.disabled = false; btn.textContent = 'Publish'; return false; }
  } }] });
}
