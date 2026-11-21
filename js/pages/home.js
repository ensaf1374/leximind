import { html, raw, esc, navigate, modal, toast, ico } from '../lib/ui.js';
import { S, save, allCards, isDue, today, nextDueIn } from '../lib/store.js';
import { last14 } from '../lib/gamify.js';
import * as supa from '../lib/supa.js';
import { aiAvailable } from '../lib/ai.js';
import { openNewDeck } from './library.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default {
  render(main) {
    const t = today(), cards = allCards(), decks = Object.values(S.decks);
    const due = cards.filter(c => isDue(c, t)), fresh = due.filter(c => c.status === 'new').length;
    const todo = due.length, minutes = Math.max(1, Math.round(todo / 4));
    const name = supa.user() ? supa.displayName().split(' ')[0] : '';
    const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const goalPct = Math.min(100, Math.round((S.reviewedToday / S.dailyGoal) * 100));
    const week = last14().slice(-7);

    let headline, sub, action;
    if (!cards.length) {
      headline = 'Add your first words'; sub = 'Create a deck, or copy one that another learner has shared.';
      action = html`<div class="row"><button class="btn btn-primary btn-lg" id="go-create">New deck</button><a class="btn btn-lg" href="#/community">Browse shared decks</a></div>`;
    } else if (todo) {
      headline = `${plural(todo, 'card')} to study today`;
      sub = `About ${plural(minutes, 'minute')}${fresh ? ` · ${fresh === todo ? 'all new' : `${fresh} new`}` : ''}`;
      action = html`<button class="btn btn-primary btn-lg" id="go-study">Start session ${ico('arrow')}</button>`;
    } else {
      const n = nextDueIn();
      headline = 'You’re done for today'; sub = n === null ? 'Nothing is due.' : `Nothing is due. Your next cards come back ${n === 1 ? 'tomorrow' : `in ${n} days`}.`;
      action = html`<a class="btn btn-lg" href="#/study">Practise anyway</a>`;
    }

    main.innerHTML = html`
      <div class="page-head"><div><h1>${greet}${name ? `, ${name}` : ''}</h1></div></div>

      <section class="today">
        <div class="today-main"><div><h2>${headline}</h2><p>${sub}</p></div>${action}</div>
        <div class="today-foot">
          <div class="goal">
            <div class="goal-head"><span>Daily goal · <b>${Math.min(S.reviewedToday, 9999)} of ${S.dailyGoal}</b> cards</span><button class="link small" id="edit-goal">Change</button></div>
            <div class="bar ${goalPct >= 100 ? 'good' : ''}"><i style="width:${goalPct}%"></i></div>
          </div>
          <div>
            <div class="week" title="${S.streak}-day streak">${raw(week.map((d, i) => `<div class="${i === 6 ? 'now' : ''}" title="${esc(d.day.toLocaleDateString())}: ${plural(d.reviewed, 'review')}"><i class="${d.reviewed ? 'on' : d.frozen ? 'frozen' : ''}"></i>${esc(d.day.toLocaleDateString(undefined, { weekday: 'narrow' }))}</div>`).join(''))}</div>
          </div>
        </div>
      </section>
      ${S.streak > 1 ? html`<p class="small muted" style="margin-top:10px">${S.streak}-day streak${S.streakFreezes ? ` · ${plural(S.streakFreezes, 'streak freeze')} saved for a missed day` : ''}</p>` : ''}

      ${aiAvailable() || !cards.length ? '' : html`<p class="notice" style="margin-top:16px">${supa.configured() && !supa.user() ? 'Sign in to let AI write cards, Farsi meanings and reading passages for you.' : 'Add an API key to let AI write cards and reading passages for you.'} <a class="link" href="#/settings">Open settings</a></p>`}

      ${decks.length ? html`
        <div class="section-title"><h2>Your decks</h2><a class="link small" href="#/library">All decks</a></div>
        <div class="list">${raw(decks.slice(0, 5).map(d => {
          const dd = d.cards.filter(c => isDue(c, t)).length, m = d.cards.filter(c => c.status === 'mastered').length;
          const pct = d.cards.length ? Math.round(m / d.cards.length * 100) : 0;
          return `<div class="item click" data-open="${esc(d.id)}" tabindex="0" role="link">
            <div class="t"><b>${esc(d.name)}</b><small>${plural(d.cards.length, 'card')}${dd ? ` · ${dd} due` : ''}</small></div>
            <div class="pg"><div class="bar good"><i style="width:${pct}%"></i></div><span>${pct}% mastered</span></div>
            <a class="btn btn-sm ${dd ? 'btn-primary' : ''}" href="#/study/${esc(d.id)}" data-stop>Study</a>
          </div>`; }).join(''))}</div>` : ''}

      <div class="section-title"><h2>More ways to practise</h2><a class="link small" href="#/calendar">Open calendar</a></div>
      <div class="list">
        <a class="item" href="#/speak"><span class="ic">${ico('mic')}</span><div class="t"><b>Speak &amp; listen</b><small>Pronunciation, dictation and listening with your own words</small></div>${ico('chevron')}</a>
        <a class="item" href="#/read"><span class="ic">${ico('book')}</span><div class="t"><b>Read</b><small>Short passages at your level; tap any word to look it up</small></div>${ico('chevron')}</a>
        <a class="item" href="#/games"><span class="ic">${ico('grid')}</span><div class="t"><b>Games</b><small>Crossword and word search made from your own words</small></div>${ico('chevron')}</a>
        <a class="item" href="#/generate"><span class="ic">${ico('plus')}</span><div class="t"><b>Generate</b><small>New words, collocations and sentences written for your level</small></div>${ico('chevron')}</a>
      </div>`;

    main.querySelector('#go-study')?.addEventListener('click', () => navigate('study/today'));
    main.querySelector('#go-create')?.addEventListener('click', () => openNewDeck());
    main.querySelectorAll('[data-open]').forEach(d => { const go = e => { if (e.target.closest('[data-stop]')) return; navigate('library/' + d.dataset.open); }; d.onclick = go; d.onkeydown = e => { if (e.key === 'Enter') go(e); }; });
    main.querySelector('#edit-goal').onclick = () => {
      const wrap = document.createElement('div'); wrap.className = 'stack';
      wrap.innerHTML = `<p class="small muted">How many cards do you want to study each day?</p><div class="seg" id="goal-seg">${[10, 20, 30, 50].map(v => `<button data-v="${v}" class="${S.dailyGoal === v ? 'on' : ''}">${v}</button>`).join('')}</div><label class="field"><span>Or another number</span><input type="number" id="goal-custom" min="1" max="300" placeholder="e.g. 25"></label>`;
      let val = S.dailyGoal;
      wrap.querySelectorAll('#goal-seg button').forEach(b => b.onclick = () => { val = +b.dataset.v; wrap.querySelectorAll('#goal-seg button').forEach(x => x.classList.toggle('on', x === b)); wrap.querySelector('#goal-custom').value = ''; });
      modal({ title: 'Daily goal', body: wrap, actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'btn-primary', onClick: () => { const c = parseInt(wrap.querySelector('#goal-custom').value); S.dailyGoal = Math.min(300, c > 0 ? c : val); save(); toast(`Daily goal set to ${S.dailyGoal} cards`, 'ok'); this.render(main); } }] });
    };
  }
};
