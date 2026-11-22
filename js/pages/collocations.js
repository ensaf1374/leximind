// Generate: AI writes new study material — words, collocations or whole sentences — at a chosen level,
// and the learner adds what they like to a deck. (The file keeps its old name; the page is "#/generate".)
import { html, raw, esc, $, toast, confirmDialog, promptDialog, ico } from '../lib/ui.js';
import { S, save, uid, newCard, recordNewWords, today, logActivity } from '../lib/store.js';
import { ask, parseJSON, aiAvailable, aiHint, LEVELS, inChunks, generateCards } from '../lib/ai.js';
import { speak } from '../lib/speech.js';
import { deckPicker, resolveDeck } from './library.js';
import { openClips } from '../lib/clips.js';
import { awardXP, checkBadges } from '../lib/gamify.js';

const KINDS = {
  words: { label: 'Words', one: 'word', many: 'words', counts: [5, 10, 15, 20, 30], def: 10, byWord: false,
    blurb: 'Single words with meaning, example and Farsi.', topicHint: 'e.g. Job interviews, cooking, the environment' },
  colloc: { label: 'Collocations', one: 'collocation', many: 'collocations', counts: [8, 12, 16, 20], def: 12, byWord: true,
    blurb: 'Words that naturally go together, like “make a decision”.', topicHint: 'e.g. Business meetings, travel, health', wordHint: 'e.g. make, decision, heavy, take' },
  sentence: { label: 'Sentences', one: 'sentence', many: 'sentences', counts: [5, 10, 15, 20], def: 10, byWord: true,
    blurb: 'Complete, natural sentences you can study and say out loud.', topicHint: 'e.g. At the doctor, small talk at work, renting a flat', wordHint: 'e.g. although, get used to, appointment' },
};
let G = { kind: 'words', by: 'topic', level: null, items: [], title: '', itemsKind: 'words' };

// Every result is kept in one shape, whatever its kind (older saved sets used "collocation"/"pattern")
const tidy = it => ({ text: String(it.text ?? it.collocation ?? '').trim(), tag: String(it.tag ?? it.pattern ?? '').trim(), phonetic: String(it.phonetic ?? '').trim(), meaning: String(it.meaning ?? '').trim(), example: String(it.example ?? '').trim(), farsi: String(it.farsi ?? '').trim(), synonyms: Array.isArray(it.synonyms) ? it.synonyms : [] });
const toCard = (kind, it) => kind === 'words' ? { word: it.text, type: it.tag || 'word', phonetic: it.phonetic, definition: it.meaning, example: it.example, farsi: it.farsi, synonyms: it.synonyms }
  : kind === 'sentence' ? { word: it.text, type: 'sentence', definition: it.meaning, farsi: it.farsi }
  : { word: it.text, type: 'collocation', definition: it.meaning, example: it.example, farsi: it.farsi };
const plural = (n, k) => `${n} ${n === 1 ? KINDS[k].one : KINDS[k].many}`;

export default {
  render(main) {
    const K = KINDS[G.kind], ai = !!aiAvailable();
    if (!K.byWord) G.by = 'topic';
    main.innerHTML = html`
      <div class="page-head"><div><h1>Generate</h1><p>Let AI write new material at your level, then add what you want to a deck.</p></div></div>
      <div class="panel" style="margin-bottom:16px">
        <div class="row between">
          <div class="seg" id="ge-kind">${raw(Object.entries(KINDS).map(([k, v]) => `<button data-k="${k}" class="${G.kind === k ? 'on' : ''}">${v.label}</button>`).join(''))}</div>
          ${K.byWord ? html`<div class="seg" id="ge-by"><button data-b="topic" class="${G.by === 'topic' ? 'on' : ''}">About a topic</button><button data-b="word" class="${G.by === 'word' ? 'on' : ''}">Using a word</button></div>` : ''}
        </div>
        <p class="small muted" style="margin-top:10px">${K.blurb}</p>
        <div class="grid grid-4" style="margin-top:12px">
          <label class="field" style="grid-column:span 2"><span>${G.by === 'topic' ? 'Topic' : 'Word or phrase'}</span><input type="text" id="ge-in" placeholder="${G.by === 'topic' ? K.topicHint : K.wordHint}"></label>
          <label class="field"><span>Level</span><select id="ge-level">${raw(LEVELS.map(l => `<option ${(G.level ? l === G.level : l.startsWith('Intermediate')) ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
          <label class="field"><span>How many ${K.many}</span><select id="ge-n">${raw(K.counts.map(n => `<option ${n === K.def ? 'selected' : ''}>${n}</option>`).join(''))}</select></label>
        </div>
        <div class="row between" style="margin-top:12px"><span class="small muted">${ai ? '' : aiHint()}</span><button class="btn btn-primary" id="ge-go" ${ai ? '' : 'disabled'}>Generate ${K.many}</button></div>
      </div>
      <div id="ge-out"></div>
      <div class="section-title"><h2>Saved sets</h2><span class="muted small">${S.collocSets.length} saved</span></div>
      <div id="ge-saved"></div>`;
    const keep = () => { G.level = $('#ge-level').value; };
    main.querySelectorAll('#ge-kind button').forEach(b => b.onclick = () => { keep(); G.kind = b.dataset.k; this.render(main); });
    main.querySelectorAll('#ge-by button').forEach(b => b.onclick = () => { keep(); G.by = b.dataset.b; this.render(main); });
    $('#ge-go').onclick = gen; $('#ge-in').onkeydown = e => { if (e.key === 'Enter') gen(); };
    drawSaved(); if (G.items.length) drawOut();
  }
};

async function gen() {
  const input = $('#ge-in').value.trim(); if (!input) { $('#ge-in').focus(); return; }
  const kind = G.kind, by = G.by, level = $('#ge-level').value, total = +$('#ge-n').value || KINDS[kind].def;
  G.level = level;
  const btn = $('#ge-go'), label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Writing…';
  try {
    let items;
    if (kind === 'words') {
      items = (await generateCards({ topic: input, level, count: total })).map(c => tidy({ text: c.word, tag: c.type, phonetic: c.phonetic, meaning: c.definition, example: c.example, farsi: c.farsi, synonyms: c.synonyms }));
    } else {
      const seen = new Set();
      const what = n => kind === 'colloc'
        ? (by === 'topic' ? `Generate ${n} useful, high-frequency English collocations about "${input}" for ${level} learners. Vary the grammatical patterns (verb+noun, adjective+noun, noun+noun, adverb+adjective, verb+preposition).`
          : `Generate ${n} of the most natural, common English collocations with the word "${input}" for ${level} learners, covering the patterns the word appears in, most common first.`)
        : (by === 'topic' ? `Write ${n} natural English sentences that a person would really say or write about "${input}", for ${level} learners. Vary the grammar (statements, questions, negatives, different tenses) and keep each sentence between 6 and 18 words.`
          : `Write ${n} natural English sentences that each use "${input}" correctly, for ${level} learners. Show its different meanings and patterns, vary the grammar, and keep each sentence between 6 and 18 words.`);
      const shape = kind === 'colloc'
        ? `Each object: "text" (the collocation), "tag" (its pattern, e.g. "verb + noun"), "meaning" (short, simple English), "example" (one natural sentence), "farsi" (Farsi translation in Farsi script).`
        : `Each object: "text" (the sentence), "tag" (the most useful word or phrase in it), "meaning" (the same idea in simpler English), "farsi" (natural Farsi translation in Farsi script).`;
      items = await inChunks(total, 8, async (n, got) => {
        const arr = parseJSON(await ask(`${what(n)}${got.length ? `\nDo NOT repeat any of these: ${got.map(x => x.text).join(' | ').slice(0, 1500)}` : ''}
Return ONLY a JSON array. ${shape} No markdown.`, { maxTokens: 230 * n + 250 }), 'array').map(tidy).filter(x => x.text);
        return arr.filter(x => { const k = x.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      });
    }
    if (!items.length) throw new Error('Nothing came back — try a different topic');
    G.items = items; G.itemsKind = kind; G.title = `${input} — ${level}`; awardXP(5, null); drawOut();
    $('#ge-out')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message, 'err', 5000); }
  if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
}

function drawOut() {
  const out = $('#ge-out'); if (!out) return;
  const kind = G.itemsKind, big = kind === 'sentence';
  out.innerHTML = html`<div class="row between" style="margin-bottom:12px">
      <div><h2>${G.title}</h2><p class="small muted">${plural(G.items.length, kind)}</p></div>
      <div class="row"><span class="small muted">Add to</span>${raw(deckPicker('ge-deck'))}<button class="btn btn-sm btn-primary" id="ge-addall">Add all</button><button class="btn btn-sm" id="ge-save">Save set</button><button class="btn btn-sm" id="ge-cal" title="Mark this set as studied today">${ico('calendar')} Add to calendar</button></div>
    </div>
    <div class="wl">${raw(G.items.map((it, i) => `<div class="wi" style="align-items:flex-start">
      <div class="t">
        <b style="${big ? 'font-size:15.5px;font-weight:550;line-height:1.5;display:block' : ''}">${esc(it.text)}</b>${!big && it.phonetic ? ` <span class="phon" style="font-size:13px">${esc(it.phonetic)}</span>` : ''}${it.tag ? ` <span class="chip" ${big ? 'style="margin-top:4px"' : ''}>${esc(it.tag)}</span>` : ''}
        ${it.meaning ? `<div class="small muted" style="margin-top:3px">${esc(it.meaning)}</div>` : ''}
        ${it.example ? `<div class="small" style="margin-top:3px">${esc(it.example)}</div>` : ''}
        ${it.farsi ? `<div lang="fa" class="fa" style="font-size:14.5px;margin-top:2px">${esc(it.farsi)}</div>` : ''}
      </div>
      <div class="acts" style="align-items:center"><button class="icon-btn" data-say="${i}" title="Listen" aria-label="Listen">${ico('volume')}</button>${big ? '' : `<button class="icon-btn" data-clip="${i}" title="Hear it in real videos" aria-label="Hear it in real videos">${ico('play')}</button>`}<button class="btn btn-sm" data-add="${i}">Add</button><button class="icon-btn danger" data-drop="${i}" title="Remove from this list" aria-label="Remove from this list">${ico('x')}</button></div></div>`).join(''))}</div>`;
  out.querySelectorAll('[data-say]').forEach(b => b.onclick = () => { const it = G.items[+b.dataset.say]; speak(big || !it.example ? it.text : `${it.text}. ${it.example}`); });
  out.querySelectorAll('[data-clip]').forEach(b => b.onclick = () => openClips(G.items[+b.dataset.clip].text));
  out.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => { G.items.splice(+b.dataset.drop, 1); if (G.items.length) drawOut(); else out.innerHTML = ''; });
  out.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => { const d = await resolveDeck(); if (!d) return; if (addOne(d, kind, G.items[+b.dataset.add])) { b.textContent = 'Added'; b.disabled = true; } });
  $('#ge-addall').onclick = async () => {
    const d = await resolveDeck(); if (!d) return; let n = 0;
    G.items.forEach((it, i) => { const b = out.querySelector(`[data-add="${i}"]`); if (b?.disabled) return; if (addOne(d, kind, it, true)) n++; if (b) { b.textContent = 'Added'; b.disabled = true; } });
    toast(n ? `Added ${plural(n, kind)} to ${d.name}` : `Those are already in ${d.name}`, n ? 'ok' : '');
  };
  // "I studied this": puts the set on today's calendar (pressing it twice does not add it twice)
  $('#ge-cal').onclick = e => { logActivity({ kind: 'generate', title: G.title, detail: plural(G.items.length, kind) }); e.currentTarget.innerHTML = `${ico('check')} In your calendar`; e.currentTarget.disabled = true; toast('Added to today in your calendar', 'ok'); };
  $('#ge-save').onclick = () => { S.collocSets.unshift({ id: uid('cs'), kind, title: G.title, date: today(), items: G.items }); if (S.collocSets.length > 40) S.collocSets.pop(); save(); toast('Set saved', 'ok'); drawSaved(); };
}
function addOne(deck, kind, it, quiet) {
  if (deck.cards.some(c => c.word.toLowerCase() === it.text.toLowerCase())) { if (!quiet) toast(`Already in ${deck.name}`, 'err'); return false; }
  deck.cards.push(newCard(toCard(kind, it))); recordNewWords([it.text]); awardXP(2, null); save(); checkBadges();
  if (!quiet) toast(`Added to ${deck.name}`, 'ok'); return true;
}
function drawSaved() {
  const el = $('#ge-saved'); if (!el) return;
  if (!S.collocSets.length) { el.innerHTML = '<div class="empty" style="padding:24px"><p>Generate a set and save it to come back to it later.</p></div>'; return; }
  el.innerHTML = `<div class="wl">${S.collocSets.map((s, i) => { const k = KINDS[s.kind] ? s.kind : 'colloc'; return `<div class="wi"><div class="t"><b>${esc(s.title)}</b><small>${plural((s.items || []).length, k)} · ${esc(s.date)}</small></div><div class="acts"><button class="btn btn-sm" data-open="${i}">Open</button><button class="icon-btn" data-ren="${i}" title="Rename" aria-label="Rename">${ico('edit')}</button><button class="icon-btn danger" data-del="${i}" title="Delete" aria-label="Delete">${ico('trash')}</button></div></div>`; }).join('')}</div>`;
  el.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => { const s = S.collocSets[+b.dataset.ren]; const n = await promptDialog('Rename set', { label: 'Name', value: s.title, okLabel: 'Rename' }); if (n && n !== s.title) { s.title = n.slice(0, 120); save(); toast('Renamed', 'ok'); drawSaved(); } });
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const s = S.collocSets[+b.dataset.open]; G.items = (s.items || []).map(tidy).filter(x => x.text); G.itemsKind = KINDS[s.kind] ? s.kind : 'colloc'; G.title = s.title; drawOut(); $('#ge-out').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const s = S.collocSets[+b.dataset.del]; if (await confirmDialog('Delete set?', `“${s.title}” will be removed.`, { danger: true, okLabel: 'Delete' })) { S.collocSets = S.collocSets.filter(x => x !== s); save(); drawSaved(); } });
}
