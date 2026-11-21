import { html, raw, esc } from '../lib/ui.js';
import { S, allCards, dateKey, parseKey } from '../lib/store.js';
import { BADGES, levelInfo, totalReviews } from '../lib/gamify.js';
import { forecast } from '../lib/srs.js';

export default {
  render(main) {
    const cards = allCards(), li = levelInfo();
    const by = s => cards.filter(c => c.status === s).length;
    const days = Array.from({ length: 12 * 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (83 - i)); const k = dateKey(d); return { k, n: S.history[k]?.reviewed || 0, d }; });
    const max = Math.max(1, ...days.map(x => x.n));
    const lvl = n => n === 0 ? '' : n < max * .25 ? 'l1' : n < max * .5 ? 'l2' : n < max * .8 ? 'l3' : 'l4';
    const fc = forecast(7), fmax = Math.max(1, ...fc.map(f => f.due));
    const ratings = Object.values(S.history).reduce((a, h) => { for (const [k, v] of Object.entries(h.ratings || {})) a[k] = (a[k] || 0) + v; return a; }, {});
    const rt = Object.values(ratings).reduce((a, b) => a + b, 0) || 1;
    const retention = Math.round(((ratings.good || 0) + (ratings.easy || 0)) / rt * 100);
    const sp = S.speaking.attempts, spAvg = sp.length ? Math.round(sp.reduce((a, x) => a + x.score, 0) / sp.length) : 0;
    const earned = BADGES.filter(b => S.badges.includes(b.id)), locked = BADGES.filter(b => !S.badges.includes(b.id));
    main.innerHTML = html`
      <div class="page-head"><div><h1>Progress</h1><p>Level ${li.level} — ${li.title}. ${li.need - li.into} XP to the next level.</p></div></div>
      <div class="bar accent xp-bar" style="margin-bottom:20px"><i style="width:${li.pct}%"></i></div>
      <div class="stats" style="margin-top:0">
        <div class="stat"><b>${totalReviews().toLocaleString()}</b><span>reviews all time</span></div>
        <div class="stat"><b>${retention}%</b><span>remembered on first try</span></div>
        <div class="stat"><b>${S.streak}</b><span>day streak · ${S.streakFreezes} freeze${S.streakFreezes === 1 ? '' : 's'}</span></div>
        <div class="stat"><b>${spAvg}%</b><span>average speaking score (${sp.length})</span></div>
      </div>
      <div class="grid grid-2" style="margin-top:20px">
        <div class="panel"><h3>Last 12 weeks</h3><div class="heat">${raw(days.map(x => `<i class="${lvl(x.n)}" title="${x.d.toLocaleDateString()}: ${x.n} reviews"></i>`).join(''))}</div><p class="small muted" style="margin-top:8px">Each square is a day. Darker means more reviews.</p></div>
        <div class="panel"><h3>Coming up</h3>${raw(fc.map((f, i) => `<div class="kv"><span>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : parseKey(f.key).toLocaleDateString(undefined, { weekday: 'long' })}</span><span class="row" style="gap:8px"><span class="bar" style="width:120px"><i style="width:${Math.round(f.due / fmax * 100)}%"></i></span><b style="width:28px;text-align:right">${f.due}</b></span></div>`).join(''))}</div>
      </div>
      <div class="grid grid-2" style="margin-top:14px">
        <div class="panel"><h3>Cards by status</h3>${raw(['new', 'learning', 'review', 'mastered'].map(s => `<div class="kv"><span style="text-transform:capitalize">${s}</span><span class="row" style="gap:8px"><span class="bar" style="width:140px"><i style="width:${cards.length ? Math.round(by(s) / cards.length * 100) : 0}%;background:${{ new: 'var(--ink-3)', learning: 'var(--accent)', review: 'var(--teal)', mastered: 'var(--moss)' }[s]}"></i></span><b style="width:36px;text-align:right">${by(s)}</b></span></div>`).join(''))}</div>
        <div class="panel"><h3>How you rate cards</h3>${raw(['again', 'hard', 'good', 'easy'].map(r => `<div class="kv"><span style="text-transform:capitalize">${r}</span><span class="row" style="gap:8px"><span class="bar" style="width:140px"><i style="width:${Math.round((ratings[r] || 0) / rt * 100)}%;background:${{ again: 'var(--brick)', hard: 'var(--accent)', good: 'var(--teal)', easy: 'var(--moss)' }[r]}"></i></span><b style="width:36px;text-align:right">${ratings[r] || 0}</b></span></div>`).join(''))}</div>
      </div>
      <div class="page-head" style="margin-top:32px"><h2>Badges</h2><span class="muted small">${earned.length} of ${BADGES.length}</span></div>
      <div class="badges">${raw([...earned, ...locked].map(b => `<div class="badge ${S.badges.includes(b.id) ? '' : 'locked'}"><span class="ic"><i data-ico="award"></i></span><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join(''))}</div>`;
  }
};
