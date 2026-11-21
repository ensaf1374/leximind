import { html, ico } from '../lib/ui.js';
import { levelInfo } from '../lib/gamify.js';
import * as supa from '../lib/supa.js';

const row = (href, icon, title, text) => html`<a class="item" href="${href}"><span class="ic">${ico(icon)}</span><div class="t"><b>${title}</b><small>${text}</small></div>${ico('chevron')}</a>`;

export default {
  render(main) {
    const li = levelInfo();
    main.innerHTML = html`
      <div class="page-head"><div><h1>More</h1><p>${supa.user() ? supa.displayName() : 'Guest'} · Level ${li.level}</p></div></div>
      <div class="list">
        ${row('#/read', 'book', 'Read', 'Short passages at your level')}
        ${row('#/watch', 'video', 'Watch', 'Study a YouTube video with its transcript')}
        ${row('#/generate', 'plus', 'Generate', 'New words, collocations and sentences')}
        ${row('#/games', 'grid', 'Games', 'Crossword and word search from your decks')}
        ${row('#/calendar', 'calendar', 'Calendar', 'What you studied, day by day')}
        ${row('#/progress', 'chart', 'Progress', 'Activity, schedule and badges')}
        ${row('#/community', 'globe', 'Community', 'Shared decks and leaderboard')}
        ${row('#/settings', 'settings', 'Settings', 'Account, AI, voice, theme and backups')}
      </div>`;
  }
};
