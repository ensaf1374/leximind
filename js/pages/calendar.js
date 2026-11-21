// Calendar: one month at a glance, showing what was studied on each day.
// Cards studied come from the review history; everything else (sessions, readings, generated sets, games,
// your own notes) comes from the activity log that the other pages write to.
import { html, raw, esc, $, ico, promptDialog, toast } from '../lib/ui.js';
import { S, save, today, dateKey, parseKey, logActivity } from '../lib/store.js';

const KIND = {
  study: { icon: 'cards', label: 'Study session' }, reading: { icon: 'book', label: 'Reading' }, generate: { icon: 'plus', label: 'Generated' },
  game: { icon: 'grid', label: 'Game' }, video: { icon: 'video', label: 'Video lesson' }, note: { icon: 'edit', label: 'Note' },
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let view = null;      // { y, m } month on screen
let sel = null;       // selected day key

const acts = k => (S.activity || []).filter(a => a.date === k);
const level = n => !n ? '' : n < 10 ? 'l1' : n < 20 ? 'l2' : n < 40 ? 'l3' : 'l4';

export default {
  render(main) {
    const t = today(), now = parseKey(t);
    if (!view) view = { y: now.getFullYear(), m: now.getMonth() };
    if (!sel) sel = t;
    const first = new Date(view.y, view.m, 1), start = new Date(view.y, view.m, 1 - first.getDay());
    const lastDay = new Date(view.y, view.m + 1, 0), weeks = Math.ceil((first.getDay() + lastDay.getDate()) / 7);
    const days = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const inMonth = days.filter(d => d.getMonth() === view.m).map(dateKey);
    const monthCards = inMonth.reduce((a, k) => a + (S.history[k]?.reviewed || 0), 0);
    const activeDays = inMonth.filter(k => (S.history[k]?.reviewed || 0) + (S.history[k]?.spoken || 0) + acts(k).length > 0).length;
    const monthEntries = inMonth.reduce((a, k) => a + acts(k).length, 0);
    const dow = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));

    main.innerHTML = html`
      <div class="page-head"><div><h1>Calendar</h1><p>Everything you study is recorded here, day by day.</p></div></div>
      <div class="cal">
        <section class="panel cal-main">
          <div class="row between" style="margin-bottom:14px">
            <h2 style="font-size:17px">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
            <div class="row" style="gap:4px"><button class="btn btn-sm" id="cal-today">Today</button><button class="icon-btn" id="cal-prev" title="Previous month" aria-label="Previous month" style="transform:rotate(180deg)">${ico('chevron')}</button><button class="icon-btn" id="cal-next" title="Next month" aria-label="Next month">${ico('chevron')}</button></div>
          </div>
          <div class="cal-grid cal-dow">${raw(dow.map(d => `<span>${esc(d)}</span>`).join(''))}</div>
          <div class="cal-grid" id="cal-grid">${raw(days.map(d => {
            const k = dateKey(d), h = S.history[k], n = h?.reviewed || 0, a = acts(k);
            const kinds = [...new Set(a.map(x => KIND[x.kind] ? x.kind : 'note'))];
            if (h?.spoken && !kinds.includes('study')) kinds.unshift('speak');
            const label = `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${n ? plural(n, 'card') + ' studied' : 'no cards'}${a.length ? ', ' + plural(a.length, 'entry').replace('entrys', 'entries') : ''}`;
            return `<button class="cal-day ${level(n)}${d.getMonth() === view.m ? '' : ' other'}${k === t ? ' today' : ''}${k === sel ? ' sel' : ''}${k > t ? ' future' : ''}" data-d="${k}" aria-label="${esc(label)}" aria-pressed="${k === sel}">
              <span class="top"><span class="n">${d.getDate()}</span><span class="dots">${kinds.slice(0, 3).map(x => `<i class="k-${x}"></i>`).join('')}</span></span>
              ${n ? `<span class="cnt">${n}<small> card${n === 1 ? '' : 's'}</small></span>` : ''}</button>`; }).join(''))}</div>
          <div class="cal-legend"><span><i class="k-study"></i>Study</span><span><i class="k-reading"></i>Reading &amp; video</span><span><i class="k-generate"></i>Generated</span><span><i class="k-game"></i>Game</span><span><i class="k-note"></i>Note</span></div>
          <p class="small muted" style="margin-top:12px">This month: ${plural(activeDays, 'active day')} · ${plural(monthCards, 'card')} studied · ${monthEntries} ${monthEntries === 1 ? 'entry' : 'entries'}. A darker day means more cards.</p>
        </section>
        <section class="panel" id="cal-day"></section>
      </div>`;
    $('#cal-prev').onclick = () => { view = new Date(view.y, view.m - 1, 1); view = { y: view.getFullYear(), m: view.getMonth() }; this.render(main); };
    $('#cal-next').onclick = () => { view = new Date(view.y, view.m + 1, 1); view = { y: view.getFullYear(), m: view.getMonth() }; this.render(main); };
    $('#cal-today').onclick = () => { view = { y: now.getFullYear(), m: now.getMonth() }; sel = t; this.render(main); };
    main.querySelectorAll('.cal-day').forEach(b => b.onclick = () => { sel = b.dataset.d; main.querySelectorAll('.cal-day').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', x === b); }); drawDay(main, this); });
    drawDay(main, this);
  }
};

function drawDay(main, page) {
  const el = $('#cal-day'); if (!el) return;
  const d = parseKey(sel), h = S.history[sel], list = acts(sel), t = today();
  const rows = [];
  if (h?.reviewed) {
    const r = h.ratings || {}, ok = (r.good || 0) + (r.easy || 0) + (r.hard || 0);
    rows.push(`<div class="item"><span class="ic">${ico('cards')}</span><div class="t"><b>${plural(h.reviewed, 'card')} studied</b><small>${ok} remembered · ${r.again || 0} to repeat</small></div></div>`);
  }
  if (h?.newWords?.length) rows.push(`<div class="item"><span class="ic">${ico('plus')}</span><div class="t"><b>${plural(h.newWords.length, 'new word')} added</b><small title="${esc(h.newWords.join(', '))}">${esc(h.newWords.slice(0, 8).join(', '))}${h.newWords.length > 8 ? '…' : ''}</small></div></div>`);
  if (h?.spoken) rows.push(`<div class="item"><span class="ic">${ico('mic')}</span><div class="t"><b>Speaking practice</b><small>${plural(h.spoken, 'attempt')}</small></div></div>`);
  for (const a of list) {
    const k = KIND[a.kind] || KIND.note;
    rows.push(`<div class="item"><span class="ic">${ico(k.icon)}</span><div class="t"><b style="white-space:normal">${esc(a.title)}</b><small>${esc(k.label)}${a.detail ? ` · ${esc(a.detail)}` : ''}</small></div><button class="icon-btn danger" data-rm="${esc(a.id)}" title="Remove from calendar" aria-label="Remove from calendar">${ico('x')}</button></div>`);
  }
  el.innerHTML = `<div class="row between" style="margin-bottom:12px;align-items:flex-start"><div><h3 style="margin:0">${esc(d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3><p class="small muted">${sel === t ? 'Today' : sel > t ? 'Coming up' : `${rows.length ? plural(rows.length, 'item') : 'Nothing'} recorded`}</p></div><button class="btn btn-sm" id="cal-add">${ico('plus')} Add entry</button></div>
    ${rows.length ? `<div class="list" style="box-shadow:none">${rows.join('')}</div>` : `<div class="empty" style="padding:28px 16px"><p>${sel > t ? 'Nothing planned yet. Add an entry to remind yourself what to study.' : sel === t ? 'Nothing yet today. Study a few cards and they will show up here.' : 'Nothing was recorded on this day.'}</p>${sel === t ? '<a class="btn btn-primary" href="#/study">Go to Study</a>' : ''}</div>`}`;
  $('#cal-add').onclick = async () => {
    const text = await promptDialog(sel > t ? 'Plan for this day' : 'Add to calendar', { label: sel > t ? 'What do you want to study?' : 'What did you study?', placeholder: 'e.g. Chapter 3 of my textbook, 20 minutes of listening', okLabel: 'Add' });
    if (!text) return;
    logActivity({ kind: 'note', title: text.slice(0, 140), date: sel, merge: false }); toast('Added to your calendar', 'ok'); page.render(main);
  };
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.activity = (S.activity || []).filter(a => a.id !== b.dataset.rm); save(); page.render(main); });
}
