// Watch: turn any YouTube video into a lesson.
// The learner pastes a link and the video's transcript (YouTube's "Show transcript" text). The video plays
// beside the transcript; words from the decks are marked, every line jumps the video to its moment, and any
// word can be looked up and saved exactly as on the Read page. Nothing here needs AI.
//   #/watch        new lesson + saved lessons
//   #/watch/<id>   a saved lesson
import { html, raw, esc, $, ico, toast, confirmDialog, navigate } from '../lib/ui.js';
import { S, save, uid, logActivity } from '../lib/store.js';
import { lookup, paragraphHTML, deckIndex } from './read.js';

const MAX_SAVED = 20, MAX_CHARS = 60000;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let player = null, poll = null, L = null, activeSeg = -1;

// ── Parsing what the learner pasted ─────────────────────────────────────────
export function videoId(url) {
  const s = String(url || '').trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live|v)\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}
const toSec = t => t.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
// YouTube's transcript panel copies as a time on one line and the words on the next; some tools put both on
// one line. Lines without any time are kept as plain text.
export function parseTranscript(text) {
  const TIME = /^\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\]?/;
  const segs = []; let cur = null, sawTime = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim(); if (!line) continue;
    const m = line.match(TIME);
    if (m) {
      sawTime = true; cur = { t: toSec(m[1]), text: '' }; segs.push(cur);
      const rest = line.slice(m[0].length).replace(/^[\s\-–—:]+/, '').replace(/^\d+ (?:hours?|minutes?|seconds?)(?:,? \d+ (?:minutes?|seconds?))*\s*/i, '');
      if (rest) cur.text = rest;
    } else if (cur && sawTime) {
      // some copies repeat the time in words on its own line ("1 minute, 15 seconds"): not part of the speech
      if (!cur.text && /^\d+ (?:hours?|minutes?|seconds?)(?:,? (?:and )?\d+ (?:minutes?|seconds?))*$/i.test(line)) continue;
      cur.text += (cur.text ? ' ' : '') + line;
    }
    else segs.push({ t: null, text: line });
  }
  return segs.filter(s => s.text);
}

function loadYT() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch {} res(); };
    if (!document.querySelector('script[data-yt]')) { const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.dataset.yt = '1'; s.onerror = () => rej(new Error('blocked')); document.head.append(s); }
    setTimeout(() => { if (!window.YT?.Player) rej(new Error('timeout')); }, 15000);
  });
}
function stop() { clearInterval(poll); poll = null; try { player?.destroy?.(); } catch {} player = null; activeSeg = -1; }

export default {
  render(main, _ctx, [id]) {
    stop();
    if (!Array.isArray(S.videos)) S.videos = [];
    L = id ? S.videos.find(v => v.id === id) || null : null;
    if (id && !L) { navigate('watch'); return; }
    return L ? lesson(main) : start(main);
  },
  destroy() { stop(); document.querySelectorAll('.popup').forEach(p => p.remove()); }
};

// ── New lesson + saved lessons ──────────────────────────────────────────────
function start(main) {
  main.innerHTML = html`
    <div class="page-head"><div><h1>Watch</h1><p>Study any YouTube video: the video plays beside its transcript, and every word is one tap away.</p></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="stack">
      <label class="field"><span>YouTube link</span><input type="text" id="wa-url" placeholder="https://www.youtube.com/watch?v=…" inputmode="url" autocomplete="off"></label>
      <label class="field"><span>Title (optional)</span><input type="text" id="wa-title" placeholder="e.g. TED talk about habits"></label>
      <label class="field"><span>Transcript</span><textarea id="wa-text" style="min-height:160px" placeholder="0:00&#10;hello and welcome to the channel&#10;0:04&#10;today we are going to talk about…"></textarea></label>
      <details class="small muted"><summary style="cursor:pointer;color:var(--accent-ink);font-weight:550">How do I get the transcript?</summary>
        <ol style="margin:8px 0 0 18px;line-height:1.7"><li>Open the video on YouTube in your browser.</li><li>Under the video, click <b>…more</b> in the description, then <b>Show transcript</b>.</li><li>Click inside the transcript, press <b>Ctrl+A</b> then <b>Ctrl+C</b> (or drag to select it all and copy).</li><li>Paste it in the box above. The times are needed so each line can jump the video.</li></ol></details>
      <div class="row between"><span class="small muted">No AI needed. The video plays from YouTube.</span><button class="btn btn-primary" id="wa-go">Start lesson</button></div>
    </div></div>
    <div class="section-title"><h2>Saved videos</h2><span class="muted small">${S.videos.length} saved</span></div>
    <div id="wa-saved"></div>`;
  $('#wa-go').onclick = create;
  drawSaved();
}
function create() {
  const vid = videoId($('#wa-url').value), text = $('#wa-text').value;
  if (!vid) { toast('That does not look like a YouTube link', 'err'); $('#wa-url').focus(); return; }
  if (text.length > MAX_CHARS) { toast(`That transcript is too long — keep it under ${MAX_CHARS.toLocaleString()} characters (about 45 minutes of video)`, 'err', 5000); return; }
  const segments = parseTranscript(text);
  if (segments.length < 2) { toast('Paste the transcript first — see “How do I get the transcript?”', 'err'); $('#wa-text').focus(); return; }
  const v = { id: uid('v'), videoId: vid, title: $('#wa-title').value.trim().slice(0, 120) || segments[0].text.split(' ').slice(0, 8).join(' ') + '…', segments, created: new Date().toISOString() };
  S.videos.unshift(v); if (S.videos.length > MAX_SAVED) S.videos.pop(); save();
  logActivity({ kind: 'video', title: v.title, detail: plural(segments.length, 'line') });
  if (!segments.some(s => s.t != null)) toast('No times were found, so lines cannot jump the video. You can still read and look up words.', '', 6000);
  navigate('watch/' + v.id);
}
function drawSaved() {
  const el = $('#wa-saved'); if (!el) return;
  if (!S.videos.length) { el.innerHTML = '<div class="empty" style="padding:24px"><p>Videos you study are kept here so you can watch them again.</p></div>'; return; }
  el.innerHTML = `<div class="wl">${S.videos.map(v => `<div class="wi"><img class="thumb" src="https://i.ytimg.com/vi/${esc(v.videoId)}/mqdefault.jpg" alt="" loading="lazy"><div class="t"><b>${esc(v.title)}</b><small>${new Date(v.created).toLocaleDateString()} · ${plural((v.segments || []).length, 'line')}</small></div><div class="acts"><a class="btn btn-sm" href="#/watch/${esc(v.id)}">Open</a><button class="icon-btn danger" data-del="${esc(v.id)}" title="Delete" aria-label="Delete">${ico('trash')}</button></div></div>`).join('')}</div>`;
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const v = S.videos.find(x => x.id === b.dataset.del); if (v && await confirmDialog('Delete video?', `“${v.title}” will be removed from your saved videos.`, { danger: true, okLabel: 'Delete' })) { S.videos = S.videos.filter(x => x !== v); save(); drawSaved(); } });
}

// ── The lesson ──────────────────────────────────────────────────────────────
function lesson(main) {
  const v = L, idx = deckIndex(), seen = new Map(), firstAt = new Map(), timed = v.segments.some(s => s.t != null);
  if (!/^[\w-]{11}$/.test(v.videoId)) { navigate('watch'); return; }
  const rows = v.segments.map((s, i) => {
    const before = new Set(seen.keys());
    const body = paragraphHTML(s.text, i, idx, new Set(), seen);
    for (const id of seen.keys()) if (!before.has(id)) firstAt.set(id, i);
    return `<div class="seg-row" data-i="${i}">${s.t != null ? `<button class="seg-time" data-t="${Number(s.t)}" title="Play from here">${clock(s.t)}</button>` : '<span class="seg-time"></span>'}<p>${body}</p></div>`;
  }).join('');
  const mine = [...seen.values()];
  main.innerHTML = html`
    <div class="page-head"><div><a class="small muted" href="#/watch">← All videos</a><h1 style="margin-top:6px">${v.title}</h1></div></div>
    <div class="watch">
      <div class="watch-video">
        <div class="player"><div id="wa-player"></div></div>
        <div class="read-bar" style="margin:10px 0 0">
          <button class="btn btn-sm" id="wa-repeat" ${timed ? '' : 'disabled'} title="Play the current line again">${ico('refresh')} Repeat line</button>
          <select id="wa-rate" aria-label="Playback speed" style="width:auto;padding:5px 8px;font-size:13px"><option value="0.75">Slow</option><option value="1" selected>Normal</option><option value="1.25">Fast</option></select>
          <label class="row small muted" style="gap:6px;margin-left:auto"><input type="checkbox" id="wa-follow" checked> Follow along</label>
        </div>
        <div id="wa-note"></div>
        ${mine.length ? html`<div style="margin-top:16px"><div class="lbl">${plural(mine.length, 'word')} from your decks in this video</div><div class="row" style="gap:6px">${raw(mine.map(c => `<button class="chip pick" data-jump="${firstAt.get(c.id)}">${esc(c.word)}</button>`).join(''))}</div></div>` : html`<p class="small muted" style="margin-top:14px">None of your deck words appear in this video yet. Tap any word in the transcript to look it up and add it.</p>`}
      </div>
      <div class="transcript reading" id="wa-text">${raw(rows)}</div>
    </div>`;
  const text = $('#wa-text'), rowEl = i => text.querySelector(`.seg-row[data-i="${i}"]`);
  const mark = (i, scroll) => {
    if (i === activeSeg) return; activeSeg = i;
    text.querySelectorAll('.seg-row.on').forEach(r => r.classList.remove('on'));
    const r = rowEl(i); if (!r) return; r.classList.add('on');
    if (scroll) text.scrollTo({ top: Math.max(0, r.offsetTop - text.clientHeight / 3), behavior: 'smooth' });
  };
  const seek = t => { if (!player?.seekTo) { toast('The video is still loading', ''); return; } player.seekTo(Math.max(0, t), true); player.playVideo(); };
  const jumpTo = i => { const s = v.segments[i]; mark(i, true); if (s?.t != null) seek(s.t); };

  text.addEventListener('click', e => {
    const w = e.target.closest('.rw'); if (w) return lookup(e, w, { title: v.title, vocab: [], glossary: [], pause: () => { try { player?.pauseVideo?.(); } catch {} } });
    const row = e.target.closest('.seg-row'); if (row && e.target.closest('.seg-time')) jumpTo(+row.dataset.i);
  });
  main.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => jumpTo(+b.dataset.jump));
  $('#wa-repeat').onclick = () => { const i = activeSeg >= 0 ? activeSeg : 0; if (v.segments[i]?.t != null) seek(v.segments[i].t); };
  $('#wa-rate').onchange = e => { try { player?.setPlaybackRate?.(parseFloat(e.target.value)); } catch {} };

  const note = msg => { const n = $('#wa-note'); if (n) n.innerHTML = `<p class="notice warn" style="margin-top:10px">${esc(msg)} <a class="link" href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">Open it on YouTube</a></p>`; };
  if (!navigator.onLine) { note('You are offline, so the video cannot play. You can still read the transcript.'); return; }
  loadYT().then(() => {
    if (L !== v || !$('#wa-player')) return;
    player = new window.YT.Player('wa-player', {
      videoId: v.videoId, width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: { onError: e => note([101, 150].includes(e.data) ? 'The owner of this video does not allow it to play inside other apps.' : 'This video could not be played.') },
    });
    if (timed) poll = setInterval(() => {
      if (!player?.getPlayerState || player.getPlayerState() !== 1) return;
      const t = player.getCurrentTime() + 0.25; let i = -1;
      for (let k = 0; k < v.segments.length; k++) { const s = v.segments[k]; if (s.t != null && s.t <= t) i = k; else if (s.t != null) break; }
      if (i >= 0) mark(i, $('#wa-follow')?.checked);
    }, 400);
  }).catch(() => note('The video player could not be loaded. Your connection or an ad blocker may be stopping it.'));
}
