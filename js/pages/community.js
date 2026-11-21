import { html, raw, esc, $, toast, modal, navigate, debounce } from '../lib/ui.js';
import { S } from '../lib/store.js';
import * as supa from '../lib/supa.js';
import { levelFor } from '../lib/gamify.js';

let view = 'decks';
export default {
  render(main) {
    main.innerHTML = html`
      <div class="page-head"><div><h1>Community</h1><p>Decks other learners have shared, and who's putting in the hours this week.</p></div>
        <div class="seg"><button data-v="decks" class="${view === 'decks' ? 'on' : ''}">Shared decks</button><button data-v="board" class="${view === 'board' ? 'on' : ''}">Leaderboard</button></div></div>
      <div id="cm-body"></div>`;
    main.querySelectorAll('.seg button').forEach(b => b.onclick = () => { view = b.dataset.v; this.render(main); });
    if (!supa.configured()) { $('#cm-body').innerHTML = `<div class="empty"><h3>Community needs the cloud</h3><p>Add your Supabase project to <code>js/config.js</code> to browse shared decks and the leaderboard.</p></div>`; return; }
    if (!supa.sb) { $('#cm-body').innerHTML = `<div class="empty"><h3>Can't reach the community right now</h3><p>Check your connection and try again.</p></div>`; return; }
    (view === 'decks' ? decks : board)($('#cm-body'));
  }
};

async function decks(el) {
  el.innerHTML = html`<div class="row" style="margin-bottom:14px"><input type="search" id="cm-q" placeholder="Search decks…" style="max-width:300px"><select id="cm-level" style="width:auto"><option value="">Any level</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select><select id="cm-sort" style="width:auto"><option value="downloads">Most copied</option><option value="likes">Most liked</option><option value="new">Newest</option></select></div><div id="cm-list"><span class="spin"></span></div>`;
  const load = async () => {
    const list = $('#cm-list'); list.innerHTML = '<span class="spin"></span>';
    try {
      const [rows, likes] = await Promise.all([supa.browseDecks({ q: $('#cm-q').value.trim(), level: $('#cm-level').value, sort: $('#cm-sort').value }), supa.myLikes()]);
      const mine = new Set(Object.values(S.decks).map(d => d.sourceId || d.publishedId).filter(Boolean));
      if (!rows.length) { list.innerHTML = `<div class="empty"><h3>No shared decks yet</h3><p>Be the first: open one of your decks , click the ••• menu, then Publish.</p><a class="btn btn-primary" href="#/library">My decks</a></div>`; return; }
      list.innerHTML = `<div class="deck-list" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${rows.map(r => {
        const owner = r.profiles || {}; const initial = (owner.display_name || '?')[0].toUpperCase();
        return `<div class="cd"><div class="row between"><h3>${esc(r.title)}</h3><span class="chip">${esc(r.level || '')}</span></div>
          <p class="small muted" style="min-height:20px">${esc(r.description || '')}</p>
          <div class="by"><span class="avatar">${owner.avatar_url ? `<img src="${esc(owner.avatar_url)}" alt="" referrerpolicy="no-referrer">` : initial}</span>${esc(owner.display_name || 'Learner')}</div>
          <div class="nums"><span>${Number(r.card_count) || 0} cards</span><span>${Number(r.downloads) || 0} copies</span><span>${Number(r.likes) || 0} likes</span>${(r.tags || []).slice(0, 3).map(t => `<span class="chip" style="padding:0 8px">${esc(t)}</span>`).join('')}</div>
          <div class="row" style="margin-top:auto"><button class="btn btn-sm btn-primary" data-get="${esc(r.id)}" ${mine.has(r.id) ? 'disabled' : ''}>${mine.has(r.id) ? 'In your decks' : 'Copy to my decks'}</button><button class="btn btn-sm" data-like="${esc(r.id)}" ${supa.user() ? '' : 'disabled title="Sign in to like"'}>${likes.has(r.id) ? 'Liked' : 'Like'}</button><button class="btn btn-sm btn-ghost" data-peek="${esc(r.id)}">Preview</button></div></div>`; }).join('')}</div>`;
      list.querySelectorAll('[data-get]').forEach(b => b.onclick = async () => { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; try { const d = await supa.importPublicDeck(b.dataset.get); toast(`“${d.name}” added to your decks`, 'ok'); b.textContent = 'In your decks'; } catch (e) { toast(e.message, 'err'); b.disabled = false; b.textContent = 'Copy to my decks'; } });
      list.querySelectorAll('[data-like]').forEach(b => b.onclick = async () => { try { const liked = await supa.toggleLike(b.dataset.like); b.textContent = liked ? 'Liked' : 'Like'; } catch (e) { toast(e.message, 'err'); } });
      list.querySelectorAll('[data-peek]').forEach(b => b.onclick = async () => { try { const d = await supa.fetchDeck(b.dataset.peek); modal({ title: d.title, wide: true, body: `<div class="wl">${(Array.isArray(d.cards) ? d.cards : []).slice(0, 60).map(c => `<div class="wi"><div class="t"><b>${esc(c?.word)}</b> <span class="phon" style="font-size:13px">${esc(c?.phonetic || '')}</span><small>${esc(c?.definition)}${c?.farsi ? ` · <span lang="fa" class="fa" style="display:inline">${esc(c.farsi)}</span>` : ''}</small></div></div>`).join('')}${d.cards?.length > 60 ? `<p class="small muted">…and ${d.cards.length - 60} more</p>` : ''}</div>`, actions: [{ label: 'Close' }] }); } catch (e) { toast(e.message, 'err'); } });
    } catch (e) { list.innerHTML = `<p class="notice bad">${esc(supa.netMsg(e))}</p>`; }
  };
  $('#cm-q').oninput = debounce(load, 350); $('#cm-level').onchange = load; $('#cm-sort').onchange = load;
  load();
}

async function board(el) {
  el.innerHTML = '<span class="spin"></span>';
  try {
    const rows = await supa.leaderboard(); const me = supa.user()?.id;
    if (!rows.length) { el.innerHTML = '<div class="empty"><h3>Nobody on the board yet</h3><p>Review a few cards and you will be the first.</p></div>'; return; }
    el.innerHTML = `<div class="panel"><ul class="lb">${rows.map((r, i) => `<li class="${r.id === me ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="avatar">${r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="" referrerpolicy="no-referrer">` : esc((r.display_name || '?')[0].toUpperCase())}</span><span style="flex:1"><b>${esc(r.display_name || 'Learner')}</b><br><small class="muted">Level ${levelFor(r.xp)}</small></span><b>${(Number(r.xp) || 0).toLocaleString()} XP</b></li>`).join('')}</ul></div>
      ${!me ? '<p class="notice warn" style="margin-top:12px">Sign in and your reviews will count here too.</p>' : ''}`;
  } catch (e) { el.innerHTML = `<p class="notice bad">${esc(supa.netMsg(e))}</p>`; }
}
