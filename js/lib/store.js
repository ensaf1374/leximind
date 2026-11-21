// ── Application state & persistence ─────────────────────────────────────────
// One JSON document per user. Saved to localStorage immediately and to Supabase (debounced) when signed in.
import { toast } from './ui.js';

export const CFG = window.LEXIMIND_CONFIG || {};

export const S = freshState();
export const SETTINGS = loadSettings();

let userId = 'guest';
let cloud = null;           // { save(doc), load() } injected by supa.js when signed in
const listeners = new Set();

export function freshState() {
  return {
    v: 3, decks: {}, history: {}, streak: 0, lastDate: null, reviewedToday: 0, todayIds: [], goalCelebrated: null,
    dailyGoal: CFG.dailyGoalDefault || 20, xp: 0, badges: [], streakFreezes: 0, freezeUsed: [],
    collocSets: [], readings: [], activity: [], videos: [], speaking: { attempts: [] }, grammar: { stats: {}, lessons: {}, mistakes: [], writings: [] }, updatedAt: null,
  };
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

// ── Dates (always local) ────────────────────────────────────────────────────
export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => dateKey(new Date());
export const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return dateKey(d); };
// Date keys are local calendar days. new Date('YYYY-MM-DD') would parse them as UTC and land on the wrong day west of Greenwich.
export const parseKey = k => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

// ── Ids & card factory ──────────────────────────────────────────────────────
let counter = 0;
export const uid = (p = 'c') => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const str = v => (v == null ? '' : String(v)).trim();

export function newCard(f = {}) {
  const t = today();
  const c = {
    id: uid('c'), word: str(f.word || f.phrase || f.collocation), phonetic: str(f.phonetic), type: str(f.type) || 'word',
    definition: str(f.definition || f.meaning), example: str(f.example), farsi: str(f.farsi),
    synonyms: Array.isArray(f.synonyms) ? f.synonyms.map(str).filter(Boolean).slice(0, 8) : [],
    collocs: Array.isArray(f.collocs) ? f.collocs.filter(x => x && x.c).map(x => ({ c: str(x.c), fa: str(x.fa) })) : [],
    context: Array.isArray(f.context || f.contextSentences) ? (f.context || f.contextSentences).map(str).filter(Boolean).slice(0, 3) : [],
    status: 'new', reps: 0, lapses: 0, ef: 2.5, interval: 0, due: t, ticks: { again: 0, hard: 0, good: 0, easy: 0 },
    added: t, lbox: 1, lNext: t, spoken: { tries: 0, best: 0 },
  };
  // keep SRS progress when migrating an existing card
  for (const k of ['id', 'status', 'reps', 'lapses', 'ef', 'interval', 'ticks', 'added', 'lbox', 'lNext', 'spoken']) if (f[k] != null) c[k] = f[k];
  c.due = f.due || f.dueDate || c.due;
  // Progress fields can come from a backup file or another person's deck: force every one to a safe type.
  c.id = typeof c.id === 'string' && /^[\w-]{1,64}$/.test(c.id) ? c.id : uid('c');
  c.status = ['new', 'learning', 'review', 'mastered'].includes(c.status) ? c.status : 'new';
  c.reps = Math.round(num(c.reps, 0, 0, 1e6)); c.lapses = Math.round(num(c.lapses, 0, 0, 1e6));
  c.ef = num(c.ef, 2.5, 1.3, 3.5); c.interval = Math.round(num(c.interval, 0, 0, 36500));
  c.lbox = Math.round(num(c.lbox, 1, 1, 5));
  for (const k of ['due', 'lNext', 'added']) if (!DATE_RE.test(c[k])) c[k] = t;
  const tk = c.ticks && typeof c.ticks === 'object' ? c.ticks : {};
  c.ticks = { again: Math.round(num(tk.again, 0, 0, 1e6)), hard: Math.round(num(tk.hard, 0, 0, 1e6)), good: Math.round(num(tk.good, 0, 0, 1e6)), easy: Math.round(num(tk.easy, 0, 0, 1e6)) };
  const sp = c.spoken && typeof c.spoken === 'object' ? c.spoken : {};
  c.spoken = { tries: Math.round(num(sp.tries, 0, 0, 1e6)), best: Math.round(num(sp.best, 0, 0, 100)) };
  return c;
}
// Only the content of a card (no ids, no progress) — used when copying someone else's deck.
export const cardContent = c => ({ word: c?.word, phonetic: c?.phonetic, type: c?.type, definition: c?.definition, example: c?.example, farsi: c?.farsi, synonyms: c?.synonyms, collocs: c?.collocs, context: c?.context });
export function newDeck(name, opts = {}) {
  return { id: uid('d'), name: str(name) || 'Untitled deck', color: opts.color || pickColor(), level: opts.level || 'intermediate', cards: [], created: today(), description: str(opts.description), publishedId: null };
}
const COLORS = ['#D9962B', '#1B7F8C', '#3D7A4A', '#C0503A', '#6B5B95', '#2F6690'];
const pickColor = () => COLORS[Object.keys(S.decks).length % COLORS.length];
export const allCards = () => Object.values(S.decks).flatMap(d => d.cards);
export const dueCards = () => { const t = today(); return allCards().filter(c => c.due <= t && c.status !== 'new'); };
export const newCardsCount = () => allCards().filter(c => c.status === 'new').length;
export const leitnerDue = () => { const t = today(); return allCards().filter(c => c.lNext <= t); };
// One definition of "due" for Home, the sidebar badge and Review: due in either schedule.
export const isDue = (c, t = today()) => c.lNext <= t || c.due <= t;
// Days until the next card becomes due (null when there are no cards waiting in the future)
export const nextDueIn = () => { const t = today(); let best = null; for (const c of allCards()) { const d = c.due < c.lNext ? c.due : c.lNext; if (d > t && (best === null || d < best)) best = d; } return best === null ? null : daysBetween(t, best); };
export const dueCount = () => { const t = today(); return allCards().filter(c => isDue(c, t)).length; };

// ── Settings (device-level, not synced) ─────────────────────────────────────
function loadSettings() {
  const d = { theme: null, ownKey: '', useOwnKey: false, voice: '', rate: 0.9, readingFont: 'sans', timer: 0, autoSpeak: false, dailyGoal: null };
  try { Object.assign(d, JSON.parse(localStorage.getItem('lm:settings') || '{}')); } catch {}
  return d;
}
export function saveSettings() { localStorage.setItem('lm:settings', JSON.stringify(SETTINGS)); }

// ── Persistence ─────────────────────────────────────────────────────────────
const key = () => `lm:data:${userId}`;
export function setUser(id, cloudAdapter) { userId = id || 'guest'; cloud = cloudAdapter || null; }
export function currentUserId() { return userId; }

export function loadLocal(id = userId) {
  try { return JSON.parse(localStorage.getItem(`lm:data:${id}`) || 'null'); } catch { return null; }
}
export function replaceState(doc) {
  const fresh = freshState();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, fresh, sanitize(doc || {}));
  for (const d of Object.values(S.decks)) d.cards = (d.cards || []).map(newCard);
  rollover();
  emit();
}
function sanitize(doc) {
  const out = {};
  for (const k of Object.keys(freshState())) if (k in doc) out[k] = doc[k];
  if (out.decks && typeof out.decks !== 'object') out.decks = {};
  return out;
}
export function snapshot() { return { ...S, updatedAt: new Date().toISOString() }; }

let saveTimer = null;
export function save({ immediate = false } = {}) {
  S.updatedAt = new Date().toISOString();
  try { localStorage.setItem(key(), JSON.stringify(S)); } catch (e) { toast('Storage is full — export a backup and delete old decks', 'err'); }
  emit();
  if (!cloud) return;
  clearTimeout(saveTimer);
  if (immediate) return cloud.save(snapshot());
  saveTimer = setTimeout(() => cloud.save(snapshot()), 1500);
}
export function flushSave() { if (cloud && saveTimer) { clearTimeout(saveTimer); saveTimer = null; return cloud.save(snapshot()); } }

// Day rollover: reset daily counters, apply streak freeze if a day was missed
export function rollover() {
  const t = today();
  if (S.lastDate === t) return;
  if (S.lastDate) {
    const gap = daysBetween(S.lastDate, t);
    if (gap > 1) {
      if (!Array.isArray(S.freezeUsed)) S.freezeUsed = [];
      // days between the last review and today that are not already covered by a freeze (so reloading never charges twice)
      const need = [];
      for (let i = 1; i < gap; i++) { const d = parseKey(S.lastDate); d.setDate(d.getDate() + i); const k = dateKey(d); if (!S.freezeUsed.includes(k)) need.push(k); }
      if (need.length && S.streakFreezes >= need.length) { S.streakFreezes -= need.length; S.freezeUsed.push(...need); if (S.freezeUsed.length > 60) S.freezeUsed = S.freezeUsed.slice(-60); }
      else if (need.length) S.streak = 0;
    }
  }
  S.reviewedToday = 0; S.todayIds = []; S.goalCelebrated = null;
}

// ── History ─────────────────────────────────────────────────────────────────
export function hist(k = today()) { return S.history[k] || (S.history[k] = { reviewed: 0, newWords: [], ratings: {}, xp: 0, spoken: 0 }); }
// Calendar entries: what was done on which day (study sessions, readings, generated sets, games, notes).
// With merge on, repeating the same thing on the same day updates the entry instead of adding another.
export function logActivity({ kind, title, detail = '', date, merge = true }) {
  if (!Array.isArray(S.activity)) S.activity = [];
  const d = date || today(), t = String(title || '').trim(); if (!t) return;
  const old = merge && S.activity.find(a => a.date === d && a.kind === kind && a.title === t);
  if (old) old.detail = String(detail || ''); else S.activity.push({ id: uid('a'), date: d, kind: String(kind), title: t, detail: String(detail || '') });
  if (S.activity.length > 1500) S.activity = S.activity.slice(-1500);
  save();
}
export function recordNewWords(words) { const h = hist(); words.forEach(w => w && h.newWords.push(String(w))); }

// ── Backup ──────────────────────────────────────────────────────────────────
export function makeBackup() { return { app: 'LexiMind', version: 3, exportedAt: new Date().toISOString(), data: snapshot() }; }
export function validateBackup(obj) {
  const doc = obj?.data || obj?.S; // accept old backups too
  if (!doc || typeof doc !== 'object' || !doc.decks || typeof doc.decks !== 'object') throw new Error('This is not a LexiMind backup file');
  let cards = 0;
  for (const d of Object.values(doc.decks)) { if (!d || typeof d.name !== 'string' || !Array.isArray(d.cards)) throw new Error('Corrupt deck in backup'); cards += d.cards.length; }
  return { doc, decks: Object.keys(doc.decks).length, cards };
}
export function downloadFile(content, type, name) {
  const parts = type === 'text/csv' ? ['\ufeff', content] : [content];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 80); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
