// ── AI access ───────────────────────────────────────────────────────────────
// Default: Supabase Edge Function (shared key, per-user quota, requires sign-in).
// Optional: user's own Anthropic key, sent directly from the browser.
import { CFG, SETTINGS, S, save, newCard } from './store.js';
import { sb, session } from './supa.js';

const TIMEOUT = 60000;
// The shared proxy caps a reply at 3000 tokens. Every request must fit, so large jobs are split into chunks.
export const MAX_OUT = 3000;
export const CHUNK = 8;   // items per request for list generators (cards, exercises)
// Runs `fetchChunk(n, alreadyGot)` until `count` items are collected. Keeps partial results if a later chunk fails.
export async function inChunks(count, size, fetchChunk) {
  const out = [];
  for (let round = 0; out.length < count && round < Math.ceil(count / size) + 1; round++) {
    let got;
    try { got = await fetchChunk(Math.min(size, count - out.length), out); } catch (e) { if (out.length) break; throw e; }
    if (!got.length) break;
    out.push(...got);
  }
  return out.slice(0, count);
}
export let remainingToday = null;

export function aiAvailable() {
  if (SETTINGS.useOwnKey && SETTINGS.ownKey) return 'own';
  if (session && CFG.supabaseUrl) return 'proxy';
  return null;
}
export function aiHint() {
  return aiAvailable() ? '' : (CFG.supabaseUrl ? 'Sign in to use AI features, or add your own API key in Settings.' : 'Add your Anthropic API key in Settings to use AI features.');
}

export async function ask(prompt, { maxTokens = 500, system } = {}) {
  const mode = aiAvailable();
  if (!mode) throw new Error(aiHint());
  if (!navigator.onLine) throw new Error("You're offline — AI features need a connection");
  maxTokens = Math.min(MAX_OUT, Math.max(16, Math.round(maxTokens) || 500));
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    if (mode === 'own') {
      const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
      if (system) body.system = system;
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-api-key': SETTINGS.ownKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 401 ? 'Your API key was rejected' : r.status === 429 ? 'Rate limited — try again in a moment' : d?.error?.message || `HTTP ${r.status}`);
      return (d.content || []).find(b => b.type === 'text')?.text || '';
    }
    const url = `${CFG.supabaseUrl.replace(/\/$/, '')}/functions/v1/${CFG.proxyFunction || 'claude-proxy'}`;
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}`, apikey: CFG.supabaseAnonKey }, body: JSON.stringify({ prompt, system, max_tokens: maxTokens }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `AI service error (${r.status})`);
    if (typeof d.remaining === 'number') { remainingToday = d.remaining; document.dispatchEvent(new CustomEvent('lm:quota', { detail: d.remaining })); }
    return d.text || '';
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The AI request timed out');
    if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) throw new Error(mode === 'own' ? "Can't reach the AI service. Check your connection." : "Can't reach the shared AI service. The Supabase project URL in js/config.js may be wrong, paused or deleted.");
    throw e;
  } finally { clearTimeout(timer); }
}

export function parseJSON(text, expect) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const i = t.search(expect === 'array' ? /\[/ : /[\[{]/); if (i > 0) t = t.slice(i);
  const j = expect === 'array' ? t.lastIndexOf(']') : t.lastIndexOf('}'); if (j > 0) t = t.slice(0, j + 1);
  let v; try { v = JSON.parse(t); } catch { throw new Error('The AI reply was incomplete or not in the expected format — try again'); }
  if (expect === 'array' && !Array.isArray(v)) throw new Error('The model did not return a list');
  if (expect === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) throw new Error('The model did not return an object');
  return v;
}

// ── High-level generators ──────────────────────────────────────────────────
export const LEVELS = ['Beginner (A1-A2)', 'Elementary (A2-B1)', 'Intermediate (B1-B2)', 'Upper-intermediate (B2-C1)', 'Advanced (C1-C2)', 'Academic / IELTS'];

export async function generateCards({ topic, level, count, exclude = [] }) {
  const seen = new Set(exclude.map(w => String(w).toLowerCase()));
  return inChunks(count, CHUNK, async (n, got) => {
    const skip = [...got.map(c => c.word), ...exclude].slice(0, 100);
    const ex = skip.length ? ` Do NOT include these words: ${skip.join(', ')}.` : '';
    const text = await ask(`Generate ${n} English flashcards for ${level} learners about "${topic}".${ex}
Return ONLY a JSON array. Each object: word, phonetic (IPA), type (noun/verb/adjective/adverb/phrase/idiom), definition (clear, one sentence), example (natural sentence), farsi (Farsi translation, Farsi script, 1-4 words), synonyms (array of 3-4).
No markdown, ONLY the JSON array.`, { maxTokens: 300 * n + 300 });
    const fresh = parseJSON(text, 'array').map(newCard).filter(c => c.word && c.definition && !seen.has(c.word.toLowerCase()));
    const uniq = []; for (const c of fresh) { const k = c.word.toLowerCase(); if (!seen.has(k)) { seen.add(k); uniq.push(c); } }
    return uniq;
  });
}
export async function lookupWord(word, context = 'general English') {
  const text = await ask(`For the English word or phrase "${word}" used in a text about "${context}", return ONLY JSON (no markdown):
{"word":"${word}","phonetic":"IPA","type":"noun/verb/adjective/...","definition":"clear 1-2 sentence definition","farsi":"معنی کامل به فارسی با یک توضیح کوتاه","example":"a natural example sentence","synonyms":["...","...","..."],"collocs":[{"c":"common collocation","fa":"ترجمه"},{"c":"...","fa":"..."},{"c":"...","fa":"..."}]}`, { maxTokens: 600 });
  return parseJSON(text, 'object');
}
export async function cardsForWords(words) {
  const text = await ask(`Generate English flashcards for these exact words/phrases: ${words.map(w => JSON.stringify(w)).join(', ')}.
Return ONLY a JSON array with exactly ${words.length} objects in the same order. Each: word (exactly as given), phonetic (IPA or "" for phrases), type, definition, example, farsi (Farsi script), synonyms (2-4). No markdown.`, { maxTokens: 260 * words.length + 200 });
  const arr = parseJSON(text, 'array');
  return words.map((w, i) => { const src = arr[i] && String(arr[i].word || '').toLowerCase() === w.toLowerCase() ? arr[i] : arr.find(x => String(x?.word || '').toLowerCase() === w.toLowerCase()) || {}; return newCard({ ...src, word: w }); });
}
// One request fills in whatever a card is missing (farsi / synonyms / collocations / context)
const inflight = new Set();
export async function enrich(card) {
  const need = { farsi: !card.farsi, synonyms: !card.synonyms?.length, collocs: !card.collocs?.length, context: !card.context?.length };
  if (!Object.values(need).some(Boolean) || !aiAvailable() || inflight.has(card.id)) return false;
  inflight.add(card.id);
  try {
    const wants = [];
    if (need.farsi) wants.push('"farsi": Farsi translation (Farsi script, 1-4 words)');
    if (need.synonyms) wants.push('"synonyms": array of 4 English synonyms');
    if (need.collocs) wants.push('"collocs": array of 3 objects {"c": natural collocation, "fa": its Farsi translation}');
    if (need.context) wants.push('"context": array of 3 varied example sentences (formal, casual, narrative)');
    const d = parseJSON(await ask(`For the English ${card.type} "${card.word}" (meaning: ${card.definition}), return ONLY a JSON object with: ${wants.join('; ')}. No markdown.`, { maxTokens: 550 }), 'object');
    if (need.farsi && d.farsi) card.farsi = String(d.farsi).trim();
    if (need.synonyms && Array.isArray(d.synonyms)) card.synonyms = d.synonyms.map(String).slice(0, 6);
    if (need.collocs && Array.isArray(d.collocs)) card.collocs = d.collocs.filter(x => x && x.c).map(x => ({ c: String(x.c), fa: String(x.fa || '') })).slice(0, 4);
    if (need.context && Array.isArray(d.context)) card.context = d.context.map(String).slice(0, 3);
    save();
    return true;
  } finally { inflight.delete(card.id); }
}
export async function enrichBatch(cards) {
  const todo = cards.filter(c => !c.context?.length || !c.farsi);
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    try {
      const map = parseJSON(await ask(`For each English word below, give a Farsi translation (Farsi script) and exactly 3 varied example sentences (formal, casual, narrative).
Words: ${batch.map(c => `${JSON.stringify(c.word)} (${c.type}: ${c.definition})`).join('; ')}
Return ONLY a JSON object mapping each word exactly as given to {"farsi":"...","context":["...","...","..."]}. No markdown.`, { maxTokens: 220 * batch.length + 200 }), 'object');
      for (const c of batch) {
        const k = Object.keys(map).find(k => k.toLowerCase() === c.word.toLowerCase()); if (!k) continue;
        if (!c.farsi && map[k].farsi) c.farsi = String(map[k].farsi);
        if (!c.context?.length && Array.isArray(map[k].context)) c.context = map[k].context.map(String).slice(0, 3);
      }
      save();
    } catch (e) { console.warn('enrichBatch', e.message); }
  }
}
