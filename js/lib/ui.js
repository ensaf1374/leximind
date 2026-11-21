// ── DOM & UI helpers ────────────────────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Tagged template that escapes every interpolation unless wrapped with raw()
export function html(strings, ...vals) {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ''), ''));
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s));

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(msg, type = '', ms = 3200) {
  let root = $('#toast-root');
  if (!root.classList.contains('toast')) root.classList.add('toast');
  const t = el('div', { class: type }, msg);
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
}

// ── Modal ───────────────────────────────────────────────────────────────────
let modalStack = [];
export function modal({ title, body, actions = [], onClose, wide }) {
  const root = $('#modal-root');
  const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const box = el('div', { class: 'modal' + (wide ? ' wide' : '') });
  if (wide) box.style.maxWidth = '760px';
  if (title) box.append(el('h2', {}, title));
  const content = typeof body === 'string' ? (() => { const d = el('div'); d.innerHTML = body; return d; })() : body;
  box.append(content);
  const acts = el('div', { class: 'acts' });
  actions.forEach(a => acts.append(el('button', { class: 'btn ' + (a.cls || ''), type: 'button', onclick: async () => { const r = await a.onClick?.(close, box); if (r !== false) close(); } }, a.label)));
  if (actions.length) box.append(acts);
  overlay.append(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  root.append(overlay);
  const first = box.querySelector('input,textarea,select,button');
  first && setTimeout(() => first.focus(), 30);
  function close() { overlay.remove(); modalStack = modalStack.filter(m => m !== close); onClose?.(); }
  modalStack.push(close);
  return { close, box };
}
export function confirmDialog(title, text, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise(res => {
    modal({ title, body: `<p>${esc(text)}</p>`, onClose: () => res(false),
      actions: [{ label: 'Cancel' }, { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { res(true); } }] });
  });
}
export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = 'Save' } = {}) {
  return new Promise(res => {
    const input = el('input', { type: 'text', value, placeholder });
    const wrap = el('label', { class: 'field' }, label ? el('span', {}, label) : '', input);
    const m = modal({ title, body: wrap, onClose: () => res(null),
      actions: [{ label: 'Cancel' }, { label: okLabel, cls: 'btn-primary', onClick: () => { res(input.value.trim()); } }] });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { res(input.value.trim()); m.close(); } });
  });
}
export function closeTopModal() { const c = modalStack.pop(); c && c(); return !!c; }

// ── Router ──────────────────────────────────────────────────────────────────
const routes = new Map();
let current = null;
export function route(name, page) { routes.set(name, page); }
export function navigate(hash) { location.hash = hash.startsWith('#') ? hash : '#/' + hash; }
export function currentRoute() { return (location.hash.replace(/^#\/?/, '') || 'home').split('/'); }
export async function renderRoute(ctx) {
  const [name, ...params] = currentRoute();
  const page = routes.get(name) || routes.get('home');
  if (current?.destroy) { try { current.destroy(); } catch {} }
  const main = $('#main');
  main.innerHTML = '';
  document.body.classList.toggle('focus', !!page.focus);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name || (name === 'settings' && a.id === 'user-chip')));
  current = page;
  await page.render(main, ctx, params);
  main.scrollTop = 0; window.scrollTo(0, 0);
}

// ── Misc ────────────────────────────────────────────────────────────────────
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function confetti() {
  const c = el('div', { class: 'confetti' });
  const colors = ['#2F5FE3', '#1F9D61', '#E0A940', '#8FA8F3', '#111827'];
  for (let i = 0; i < 50; i++) c.append(el('i', { style: `left:${Math.random() * 100}%;top:-14px;background:${colors[i % 5]};animation-delay:${Math.random()}s;animation-duration:${2 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)` }));
  document.body.append(c); setTimeout(() => c.remove(), 4000);
}
export function fmtDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// Inline icon set (masked SVG via CSS var) — Lucide-style strokes
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  cards: '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v11"/>',
  boxes: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  grammar: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m16 16 2 2 4-4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.8-1.6L13.3 2h-4l-.4 2.9a7 7 0 0 0-2.8 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.8 1.6l.4 2.9h4l.4-2.9a7 7 0 0 0 2.8-1.6l2.3 1 2-3.4-2-1.5A7 7 0 0 0 19 12z"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M8.5 13 7 22l5-3 5 3-1.5-9"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-9 0 4-4 7-4 12 0 5 3 8 7 8z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
// Inline icon: works inside html`` templates and plain strings alike
export const ico = name => raw(`<i data-ico="${name}" aria-hidden="true"></i>`);
export function installIcons() {
  const css = Object.entries(ICONS).map(([k, p]) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${p}</svg>`;
    return `i[data-ico="${k}"]{--ico:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  }).join('\n');
  document.head.append(el('style', {}, css));
}
