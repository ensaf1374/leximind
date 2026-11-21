// ── Gamification: XP, levels, badges, streak freezes ────────────────────────
import { S, hist, allCards, save } from './store.js';
import { toast } from './ui.js';

export const levelFor = xp => Math.max(1, Math.floor(Math.sqrt((xp || 0) / 60)) + 1);
export const xpForLevel = lvl => (lvl - 1) ** 2 * 60;
export function levelInfo(xp = S.xp) {
  const lvl = levelFor(xp), lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  return { level: lvl, into: xp - lo, need: hi - lo, pct: Math.round(((xp - lo) / (hi - lo)) * 100), title: TITLES[Math.min(TITLES.length - 1, lvl - 1)] };
}
const TITLES = ['Newcomer', 'Word collector', 'Apprentice', 'Reader', 'Speaker', 'Wordsmith', 'Scholar', 'Linguist', 'Polyglot', 'Lexicographer'];

let pending = 0, pendingTimer = null, pendingLabel = '';
export function awardXP(n, label) {
  if (!n) return;
  const before = levelFor(S.xp);
  S.xp = (S.xp || 0) + n; hist().xp = (hist().xp || 0) + n;
  if (label && label !== 'review') { toast(`+${n} XP · ${label}`, 'xp', 2200); }
  else { // batch the small review awards into one toast
    pending += n; pendingLabel = label || '';
    clearTimeout(pendingTimer); pendingTimer = setTimeout(() => { if (pending) toast(`+${pending} XP`, 'xp', 1600); pending = 0; }, 1200);
  }
  const after = levelFor(S.xp);
  if (after > before) { toast(`Level ${after} — ${levelInfo().title}`, 'xp', 4000); document.dispatchEvent(new CustomEvent('lm:levelup', { detail: after })); }
  document.dispatchEvent(new CustomEvent('lm:xp'));
}

export const BADGES = [
  { id: 'first_card', icon: '🌱', name: 'First word', desc: 'Add your first card', test: () => allCards().length >= 1 },
  { id: 'fifty', icon: '📚', name: 'Fifty words', desc: '50 cards in your decks', test: () => allCards().length >= 50 },
  { id: 'two_hundred', icon: '🏛️', name: 'Two hundred', desc: '200 cards in your decks', test: () => allCards().length >= 200 },
  { id: 'first_review', icon: '✅', name: 'First review', desc: 'Rate a card', test: () => totalReviews() >= 1 },
  { id: 'hundred_reviews', icon: '💯', name: 'Century', desc: '100 reviews', test: () => totalReviews() >= 100 },
  { id: 'thousand_reviews', icon: '🔥', name: 'A thousand', desc: '1,000 reviews', test: () => totalReviews() >= 1000 },
  { id: 'streak3', icon: '🕯️', name: 'Three days', desc: '3-day streak', test: () => S.streak >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'One week', desc: '7-day streak', test: () => S.streak >= 7 },
  { id: 'streak30', icon: '🌙', name: 'One month', desc: '30-day streak', test: () => S.streak >= 30 },
  { id: 'mastered10', icon: '🎓', name: 'Ten mastered', desc: 'Master 10 cards', test: () => allCards().filter(c => c.status === 'mastered').length >= 10 },
  { id: 'mastered100', icon: '👑', name: 'Hundred mastered', desc: 'Master 100 cards', test: () => allCards().filter(c => c.status === 'mastered').length >= 100 },
  { id: 'speaker', icon: '🎤', name: 'Out loud', desc: 'Complete 10 speaking attempts', test: () => (S.speaking?.attempts?.length || 0) >= 10 },
  { id: 'clear_voice', icon: '🗣️', name: 'Clear voice', desc: 'Score 90%+ on pronunciation', test: () => (S.speaking?.attempts || []).some(a => a.score >= 90) },
  { id: 'reader', icon: '📖', name: 'Bookworm', desc: 'Save 5 readings', test: () => (S.readings?.length || 0) >= 5 },
  { id: 'goal5', icon: '🎯', name: 'On target', desc: 'Hit your daily goal 5 times', test: () => Object.values(S.history).filter(h => h.reviewed >= S.dailyGoal).length >= 5 },
  { id: 'night_owl', icon: '🦉', name: 'Night owl', desc: 'Review after midnight', test: () => new Date().getHours() < 4 && S.reviewedToday > 0 },
  { id: 'sharer', icon: '🤝', name: 'Generous', desc: 'Publish a deck to the community', test: () => Object.values(S.decks).some(d => d.publishedId) },
  { id: 'level5', icon: '⭐', name: 'Level 5', desc: 'Reach level 5', test: () => levelFor(S.xp) >= 5 },
];
export const totalReviews = () => Object.values(S.history).reduce((a, h) => a + (h.reviewed || 0), 0);

export function checkBadges() {
  let earned = false;
  for (const b of BADGES) {
    if (S.badges.includes(b.id)) continue;
    let ok = false; try { ok = b.test(); } catch {}
    if (ok) { S.badges.push(b.id); earned = true; toast(`Badge earned: ${b.name}`, 'xp', 4500); S.xp += 25; }
  }
  if (earned) save();
  return earned;
}
export function last14() {
  const out = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = keyLocal(d); out.push({ key: k, day: d, reviewed: S.history[keyLocal(d)]?.reviewed || 0, frozen: S.freezeUsed.includes(keyLocal(d)) }); } return out;
}
const keyLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
