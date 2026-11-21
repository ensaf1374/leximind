import { $, $$, route, renderRoute, installIcons, toast, closeTopModal, confetti } from './lib/ui.js';
import { S, SETTINGS, saveSettings, onChange, flushSave, dueCount, rollover } from './lib/store.js';
import * as supa from './lib/supa.js';
import { levelInfo } from './lib/gamify.js';
import home from './pages/home.js';
import study from './pages/study.js';
import review from './pages/review.js';
import speak from './pages/speak.js';
import read from './pages/read.js';
import collocations from './pages/collocations.js';
import library from './pages/library.js';
import community from './pages/community.js';
import progress from './pages/progress.js';
import settings from './pages/settings.js';
import more from './pages/more.js';
import calendar from './pages/calendar.js';
import games from './pages/games.js';
import watch from './pages/watch.js';

installIcons();
for (const [n, p] of Object.entries({ home, study, review, speak, read, collocations, library, community, progress, settings, more, calendar, games, watch })) route(n, p);
route('generate', collocations);   // the generator's current name; "#/collocations" still works for old links

// ── Auth screen ─────────────────────────────────────────────────────────────
const auth = $('#auth'), app = $('#app');
let mode = 'signin';
function showAuth() { auth.hidden = false; app.hidden = true; $('#auth-config-warning').hidden = supa.configured(); $('#auth-google').disabled = !supa.sb; $('#auth-submit').disabled = !supa.sb; }
function showApp() { auth.hidden = true; app.hidden = false; refreshChrome(); renderRoute(); }
function setMode(m) {
  mode = m;
  $('#auth-heading').textContent = m === 'signup' ? 'Create your account' : m === 'forgot' ? 'Reset your password' : 'Welcome back';
  $('#auth-lead').textContent = m === 'signup' ? 'Free. Your decks and progress follow you to every device.' : m === 'forgot' ? "We'll email you a link to choose a new password." : 'Sign in to sync your progress across devices.';
  $('#auth-name-field').hidden = m !== 'signup';
  $('#auth-password').closest('.field').hidden = m === 'forgot';
  $('#auth-submit').textContent = m === 'signup' ? 'Create account' : m === 'forgot' ? 'Send reset link' : 'Sign in';
  $('#auth-switch-text').textContent = m === 'signin' ? 'New here?' : 'Already have an account?';
  $('#auth-switch').textContent = m === 'signin' ? 'Create an account' : 'Sign in';
  $('#auth-password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#auth-error').hidden = true;
}
// "Continue with Google" is shown only once the project confirms Google sign-in is enabled
function syncProviders() { $('#auth-google').hidden = !supa.googleEnabled; $('#auth-or').hidden = !supa.googleEnabled; }
document.addEventListener('lm:providers', syncProviders); syncProviders();
$('#auth-switch').onclick =() => setMode(mode === 'signin' ? 'signup' : 'signin');
$('#auth-forgot').onclick = () => setMode('forgot');
$('#auth-guest').onclick = () => { localStorage.setItem('lm:guest', '1'); supa.activateGuest(); showApp(); };
$('#auth-google').onclick = async () => { try { await supa.signInGoogle(); } catch (e) { showErr(e.message); } };
$('#auth-form').onsubmit = async e => {
  e.preventDefault();
  const email = $('#auth-email').value.trim(), pw = $('#auth-password').value, name = $('#auth-name').value.trim();
  const btn = $('#auth-submit'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    if (!supa.sb) throw new Error('Cloud sign-in is not configured');
    if (mode === 'forgot') { await supa.resetPassword(email); toast('Check your email for the reset link', 'ok'); setMode('signin'); }
    else if (mode === 'signup') {
      if (pw.length < 8) throw new Error('Use at least 8 characters for your password');
      const r = await supa.signUp(email, pw, name);
      if (r === 'confirm_email') { toast('Account created — confirm your email, then sign in', 'ok', 6000); setMode('signin'); }
    } else await supa.signIn(email, pw);
  } catch (err) { showErr(friendly(err.message)); }
  btn.disabled = false; setMode(mode);
};
function showErr(m) { const el = $('#auth-error'); el.textContent = m; el.hidden = false; }
function friendly(m = '') {
  if (/invalid login/i.test(m)) return 'Email or password is incorrect.';
  if (/already registered/i.test(m)) return 'That email already has an account — sign in instead.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/confirm/i.test(m)) return 'Confirm your email first (check your inbox), then sign in.';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return supa.netMsg();
  return m || 'Something went wrong.';
}

// ── Chrome (sidebar user chip, badges) ──────────────────────────────────────
function refreshChrome() {
  const name = supa.user() ? supa.displayName() : 'Guest';
  $('#user-name').textContent = name;
  const li = levelInfo();
  $('#user-level').textContent = `Level ${li.level} · ${li.title}`;
  const av = $('#user-avatar'); const url = supa.avatarUrl();
  av.textContent = '';
  if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; img.referrerPolicy = 'no-referrer'; av.append(img); } else av.textContent = (name[0] || '?').toUpperCase();
  const due = dueCount();
  $$('.nav a[data-nav="study"]').forEach(a => { a.querySelector('.badge-n')?.remove(); if (due) a.insertAdjacentHTML('beforeend', `<span class="badge-n">${due}</span>`); });
}
onChange(refreshChrome);
document.addEventListener('lm:xp', refreshChrome);
document.addEventListener('lm:goal', confetti);

// ── Global keys, routing, offline ───────────────────────────────────────────
window.addEventListener('hashchange', () => { if (!app.hidden) renderRoute(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (closeTopModal()) return; $$('.popup').forEach(p => p.remove()); } });
function offline() { $('#offline-bar').hidden = navigator.onLine; if (navigator.onLine) flushSave(); }
window.addEventListener('online', offline); window.addEventListener('offline', offline); offline();
window.addEventListener('beforeunload', () => flushSave());
let shownDay = new Date().toDateString();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return flushSave();
  // coming back to a tab that was left open overnight: start the new day cleanly
  const now = new Date().toDateString();
  if (now !== shownDay) { shownDay = now; rollover(); if (!app.hidden) { refreshChrome(); if (/^(#\/?(home)?)?$/.test(location.hash) && !document.querySelector('.overlay')) renderRoute(); } }
});

// theme
if (SETTINGS.theme) document.documentElement.classList.toggle('dark', SETTINGS.theme === 'dark');

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  const ok = await supa.init(async s => { if (s) { await supa.activateUser(); showApp(); } else { supa.activateGuest(); localStorage.removeItem('lm:guest'); showAuth(); } });
  if (ok && supa.session) { await supa.activateUser(); showApp(); }
  else if (localStorage.getItem('lm:guest') || !supa.configured() && localStorage.getItem('lm:data:guest')) { supa.activateGuest(); showApp(); }
  else { supa.activateGuest(); showAuth(); }
  setMode('signin');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
