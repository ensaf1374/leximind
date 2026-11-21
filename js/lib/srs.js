// ── Spaced repetition ───────────────────────────────────────────────────────
import { S, today, daysFromNow, daysBetween, hist, save, allCards, dateKey, parseKey, rollover, isDue } from './store.js';
import { awardXP, checkBadges } from './gamify.js';

export const MASTERY = { again: 12, hard: 8, good: 4, easy: 2 };

export function dominant(c) {
  const t = c.ticks;
  if (t.again > 2 && t.again > t.good + t.easy) return 'again';
  if (t.hard > t.good + t.easy) return 'hard';
  if (t.easy > t.good) return 'easy';
  return 'good';
}
// Progress of a card = its spacing stage (1-5). Stage 5 is "mastered" everywhere in the app.
export function progress(c) {
  return { total: 5, filled: c.lbox, dominant: dominant(c), mastered: c.lbox >= 5 };
}
const t = c => c.ticks.good + c.ticks.easy;

// SM-2 part only: interval, ease, due date, status. No Leitner move, no history.
export function applySrs(card, r) {
  card.reps++; card.ticks[r]++;
  if (r === 'again') {
    card.lapses++; card.interval = 0; card.ef = Math.max(1.3, card.ef - 0.2); card.status = 'learning'; card.due = today();
  } else {
    let next;
    if (r === 'hard') { card.ef = Math.max(1.3, card.ef - 0.15); next = card.interval < 1 ? 1 : card.interval < 3 ? 2 : Math.round(card.interval * 1.2); }
    else if (r === 'good') { next = card.interval < 1 ? 1 : card.interval < 3 ? 3 : card.interval < 7 ? 7 : Math.round(card.interval * card.ef); }
    else { card.ef = Math.min(3.5, card.ef + 0.15); next = card.interval < 1 ? 3 : card.interval < 7 ? 7 : Math.round(card.interval * card.ef * 1.3); }
    card.interval = next; card.due = daysFromNow(next);
    card.status = card.reps >= 2 ? 'review' : 'learning';
  }
  return card;
}
// The whole effect of one answer on a card's schedule (both the interval and the stage). No history, no saving.
export function schedule(card, r) {
  const wasLeitnerDue = card.lNext <= today();
  applySrs(card, r);
  if (r === 'again') setBox(card, 1);
  else if (wasLeitnerDue) { if (r === 'hard') card.lNext = daysFromNow(1); else setBox(card, card.lbox + 1); }
  card.status = r === 'again' ? 'learning' : card.lbox >= 5 ? 'mastered' : card.reps >= 2 ? 'review' : 'learning';
  return card;
}
// In how many days the card would come back after this answer (0 = today). Uses the same code as the real rating.
export function preview(card, r) {
  const c = schedule(JSON.parse(JSON.stringify(card)), r);
  return Math.max(0, daysBetween(today(), c.due < c.lNext ? c.due : c.lNext));
}
// Rating from the Study page. Mutates the card, moves its Leitner box the same way Review would, updates history/streak/xp, saves.
export function rate(card, r) {
  schedule(card, r);
  recordReview(r, card.id);
  return card;
}

// Single place where a review is counted
export function recordReview(r, cardId) {
  rollover(); // the app may have been left open past midnight: start today's counters from zero
  const k = today(), h = hist(k);
  h.reviewed++; h.ratings[r] = (h.ratings[r] || 0) + 1;
  if (S.lastDate !== k) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = dateKey(y);
    S.streak = (S.lastDate === yesterday || S.freezeUsed.includes(yesterday)) ? (S.streak || 0) + 1 : 1;
    S.lastDate = k;
    if (S.streak > 0 && S.streak % 7 === 0) { S.streakFreezes = Math.min(3, (S.streakFreezes || 0) + 1); }
  }
  // the daily goal counts different cards, so repeating one hard word does not fill it
  if (!Array.isArray(S.todayIds)) S.todayIds = [];
  if (!cardId || !S.todayIds.includes(cardId)) { if (cardId) S.todayIds.push(cardId); S.reviewedToday = (S.reviewedToday || 0) + 1; }
  awardXP({ again: 2, hard: 5, good: 10, easy: 12 }[r] || 5, r === 'again' ? null : 'review');
  if (S.reviewedToday >= S.dailyGoal && S.goalCelebrated !== k) { S.goalCelebrated = k; awardXP(40, 'Daily goal reached'); document.dispatchEvent(new CustomEvent('lm:goal')); }
  checkBadges();
  save();
}

// ── Leitner ─────────────────────────────────────────────────────────────────
export const LT = { interval: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 }, sub: { 1: 'Every day', 2: 'Every 2 days', 3: 'Every 4 days', 4: 'Every 8 days', 5: 'Every 16 days' } };
export function setBox(card, box) {
  card.lbox = Math.max(1, Math.min(5, box));
  card.lNext = daysFromNow(LT.interval[card.lbox]);
  if (card.lbox >= 5) card.status = 'mastered';
}
export function leitnerQueue(count, scope) {
  let items = Object.values(S.decks).flatMap(d => d.cards.map(card => ({ card, deck: d })));
  if (/^[1-5]$/.test(scope)) items = items.filter(i => i.card.lbox === Number(scope));
  const tk = today();
  const overdue = i => Math.max(0, Math.round((parseKey(tk) - parseKey(i.card.lNext)) / 86400000));
  const due = items.filter(i => isDue(i.card, tk)).sort((a, b) => a.card.lbox - b.card.lbox || overdue(b) - overdue(a) || Math.random() - .5);
  const upcoming = items.filter(i => !isDue(i.card, tk)).sort((a, b) => a.card.lNext < b.card.lNext ? -1 : 1);
  const pool = scope === 'due' ? due : due.concat(upcoming);
  return count === 'all' ? pool : pool.slice(0, Number(count) || 20);
}

// Study queue for a deck: due first, then most-lapsed, then status
export function studyQueue(deck) {
  const tk = today(), order = { review: 0, learning: 1, new: 2, mastered: 3 };
  return [...deck.cards].sort((a, b) => {
    const ad = a.due <= tk, bd = b.due <= tk;
    if (ad !== bd) return ad ? -1 : 1;
    if (a.lapses !== b.lapses) return b.lapses - a.lapses;
    return (order[a.status] ?? 2) - (order[b.status] ?? 2);
  });
}
export function forecast(days = 7) {
  const cards = allCards();
  return Array.from({ length: days }, (_, i) => { const k = daysFromNow(i); return { key: k, due: cards.filter(c => c.due === k && c.status !== 'new').length }; });
}
