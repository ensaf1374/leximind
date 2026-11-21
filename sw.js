// LexiMind service worker — keeps a copy of the app for offline study. Online, files always come from the server.
const VERSION = 'lx-v12';
const SHELL = ['./','./index.html','./css/app.css','./js/config.js','./js/app.js',
  './js/lib/ui.js','./js/lib/store.js','./js/lib/srs.js','./js/lib/ai.js','./js/lib/supa.js','./js/lib/gamify.js','./js/lib/speech.js','./js/lib/clips.js',
  './js/pages/home.js','./js/pages/study.js','./js/pages/review.js','./js/pages/speak.js','./js/pages/read.js','./js/pages/collocations.js',
  './js/pages/library.js','./js/pages/community.js','./js/pages/progress.js','./js/pages/settings.js','./js/pages/more.js','./js/pages/calendar.js','./js/pages/games.js','./js/pages/watch.js',
  './manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache API, auth or supabase traffic
  if (/supabase\.co|anthropic\.com|esm\.sh/.test(url.host)) return;
  // fonts: stale-while-revalidate
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.open(VERSION+'-fonts').then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // App files: always ask the server first (a cheap "has it changed?" check), so an update shows up on the next
  // load without bumping VERSION or reloading twice. The cached copy is only used when there is no connection.
  if (url.origin === location.origin) {
    e.respondWith(fetch(url.href, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
  }
});
