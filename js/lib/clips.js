// "In real videos": plays YouTube clips at the moment a word or phrase is spoken, using YouGlish's
// embeddable player (https://youglish.com/api/doc/js-api). The player's script is only downloaded the first
// time someone asks for clips. The word being looked up is sent to YouGlish, and the clips play from YouTube.
import { modal, el, esc } from './ui.js';

let api = null;
function loadApi() {
  if (window.YG?.Widget) return Promise.resolve();
  if (!api) api = new Promise((res, rej) => {
    const fail = why => { api = null; rej(new Error(why)); };
    const prev = window.onYouglishAPIReady;
    window.onYouglishAPIReady = () => { try { prev?.(); } catch {} res(); };
    const s = document.createElement('script'); s.src = 'https://youglish.com/public/emb/widget.js'; s.async = true; s.charset = 'utf-8';
    s.onerror = () => fail('blocked');
    document.head.append(s);
    setTimeout(() => { if (!window.YG?.Widget) fail('timeout'); }, 15000);
  });
  return api;
}

let seq = 0;
const ACCENTS = [['', 'All accents'], ['us', 'American'], ['uk', 'British'], ['aus', 'Australian']];

export function openClips(text) {
  const q = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!q) return;
  const id = `yg-${++seq}`, link = `https://youglish.com/pronounce/${encodeURIComponent(q)}/english`;
  let widget = null, total = 0, closed = false, accent = '';
  const body = el('div', { class: 'stack clips' });
  body.innerHTML = `
    <div class="row between"><div class="seg" data-accents>${ACCENTS.map(([k, l]) => `<button data-a="${k}" class="${k === accent ? 'on' : ''}">${l}</button>`).join('')}</div><span class="small muted" data-status aria-live="polite">Finding clips…</span></div>
    <div class="clips-frame"><div id="${id}"></div></div>
    <div class="row between">
      <div class="row"><button class="btn btn-sm" data-do="previous" disabled>Previous</button><button class="btn btn-sm" data-do="replay" disabled>Replay</button><button class="btn btn-sm btn-primary" data-do="next" disabled>Next clip</button></div>
      <a class="link small" href="${esc(link)}" target="_blank" rel="noopener">Open on YouGlish</a>
    </div>
    <p class="small muted">Each clip starts where “${esc(q)}” is said. Clips are found by YouGlish and played from YouTube.</p>`;
  const status = t => { const s = body.querySelector('[data-status]'); if (s) s.textContent = t; };
  const enable = on => body.querySelectorAll('[data-do]').forEach(b => { b.disabled = !on; });
  const problem = msg => { status(''); enable(false); body.querySelector('.clips-frame').innerHTML = `<div class="notice warn" style="margin:16px">${esc(msg)} <a class="link" href="${esc(link)}" target="_blank" rel="noopener">Open “${esc(q)}” on YouGlish</a></div>`; };
  const m = modal({ title: `“${q}” in real videos`, body, wide: true, actions: [{ label: 'Close' }], onClose: () => { closed = true; try { widget?.pause(); widget?.close(); } catch {} } });
  m.box.classList.add('clips-modal');

  const search = () => { status('Finding clips…'); enable(false); try { accent ? widget.fetch(q, 'english', accent) : widget.fetch(q, 'english'); } catch { problem('The video player could not start.'); } };
  body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { if (!widget || accent === b.dataset.a) return; accent = b.dataset.a; body.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('on', x === b)); search(); });
  body.querySelectorAll('[data-do]').forEach(b => b.onclick = () => { try { widget?.[b.dataset.do](); } catch {} });

  if (!navigator.onLine) return problem('You are offline, so clips cannot be loaded.');
  loadApi().then(() => {
    if (closed) return;
    widget = new window.YG.Widget(id, {
      components: 4 + 8 + 16 + 64,   // title, caption, speed, player controls
      events: {
        onFetchDone: e => { if (closed) return; total = e.totalResult || 0; if (!total) problem(`No clips were found for “${q}”${accent ? ' in this accent' : ''}. Try a shorter phrase.`); else enable(true); },
        onVideoChange: e => { if (!closed && total) status(`Clip ${e.trackNumber || 1} of ${total.toLocaleString()}`); },
        onError: () => { if (!closed) problem('This clip could not be played.'); },
      },
    });
    search();
  }).catch(() => { if (!closed) problem('The video player could not be loaded. Your connection or an ad blocker may be stopping it.'); });
}
