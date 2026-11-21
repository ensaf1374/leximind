// ── Speech: text-to-speech, recognition, scoring ───────────────────────────
import { SETTINGS } from './store.js';

export const ttsSupported = () => 'speechSynthesis' in window;
export const sttSupported = () => 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;

let voicesCache = [];
export function voices() {
  if (!ttsSupported()) return [];
  voicesCache = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
  return voicesCache;
}
if (ttsSupported()) { voices(); speechSynthesis.onvoiceschanged = voices; }
// Human-sounding voices: Edge's "Online (Natural)" voices, Apple's Premium/Enhanced voices, and similar.
export const isNatural = v => /natural|neural|premium|enhanced/i.test(v.name);
// Best voice the browser offers: natural US English, then any natural English, then Google's, then whatever exists.
export function bestVoice() {
  const v = voices(), us = x => x.lang === 'en-US';
  return v.find(x => us(x) && isNatural(x)) || v.find(isNatural) || v.find(x => us(x) && /google/i.test(x.name)) || v.find(x => us(x) && x.localService) || v.find(us) || v[0] || null;
}
function pickVoice() {
  return voices().find(x => x.name === SETTINGS.voice) || bestVoice();
}
export function speak(text, { rate, onEnd, onBoundary } = {}) {
  if (!ttsSupported() || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = rate ?? SETTINGS.rate ?? 0.9;
    const v = pickVoice(); if (v) u.voice = v;
    u.onend = () => { onEnd?.(); res(); };
    u.onerror = () => res();
    if (onBoundary) u.onboundary = onBoundary;
    speechSynthesis.speak(u);
  });
}
export function stopSpeaking() { if (ttsSupported()) speechSynthesis.cancel(); }

// Returns a controller { stop() }; calls onResult(finalText, interimText) and onEnd(finalText)
export function listen({ onResult, onEnd, onError, continuous = false, lang = 'en-US' }) {
  if (!sttSupported()) { onError?.(new Error('Speech recognition is not supported in this browser. Chrome or Edge work best.')); return { stop() {} }; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new R(); rec.lang = lang; rec.interimResults = true; rec.continuous = continuous; rec.maxAlternatives = 3;
  let finalText = '', stopped = false;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t; else interim += t; }
    onResult?.(finalText, interim);
  };
  rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') onError?.(new Error(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow the microphone for this site.' : `Recognition error: ${e.error}`)); };
  rec.onend = () => { if (!stopped) { stopped = true; onEnd?.(finalText.trim()); } };
  try { rec.start(); } catch (e) { onError?.(e); }
  return { stop() { try { rec.stop(); } catch {} } };
}

// ── Scoring ─────────────────────────────────────────────────────────────────
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
export function levenshtein(a, b) {
  a = norm(a); b = norm(b); const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[n];
}
export function similarity(a, b) { const d = levenshtein(a, b), L = Math.max(norm(a).length, norm(b).length) || 1; return Math.max(0, Math.round((1 - d / L) * 100)); }
// Very small metaphone-ish comparison so "their/there" don't count as failures
const soundKey = w => norm(w).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/[cqk]/g, 'k').replace(/gh/g, '').replace(/wh/g, 'w').replace(/(.)\1+/g, '$1').replace(/[aeiouy]+/g, 'a');
export function wordMatch(a, b) { return norm(a) === norm(b) || soundKey(a) === soundKey(b) || similarity(a, b) >= 80; }

// Word-level diff for dictation feedback: returns [{w, state:'ok'|'no'|'miss'}]
export function diffWords(target, said) {
  const T = norm(target).split(' ').filter(Boolean), Sd = norm(said).split(' ').filter(Boolean);
  const m = T.length, n = Sd.length, dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = wordMatch(T[i], Sd[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (wordMatch(T[i], Sd[j])) { out.push({ w: T[i], state: 'ok' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ w: T[i], state: 'miss' }); i++; }
    else { out.push({ w: Sd[j], state: 'no' }); j++; }
  }
  while (i < m) out.push({ w: T[i++], state: 'miss' });
  while (j < n) out.push({ w: Sd[j++], state: 'no' });
  const ok = out.filter(x => x.state === 'ok').length;
  return { parts: out, score: Math.round((ok / Math.max(m, 1)) * 100) };
}
