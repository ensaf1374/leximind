// ── Supabase: auth, cloud sync, community library ──────────────────────────
import { CFG, S, setUser, replaceState, loadLocal, save, snapshot, newCard, newDeck, recordNewWords, cardContent } from './store.js';
import { toast, $ } from './ui.js';

export let sb = null;          // supabase client (null when unconfigured or library failed to load)
export let session = null;     // current auth session
export let profile = null;     // row from public.profiles
export const configured = () => !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
let onAuth = () => {};
// Plain-language message for "the cloud project could not be reached" (offline, or a wrong/deleted project URL in js/config.js)
export function netMsg(e) {
  const m = String(e?.message || e || '');
  if (e && !/failed to fetch|networkerror|load failed/i.test(m)) return m || 'Something went wrong.';
  return navigator.onLine ? "Can't reach the cloud service. The Supabase project URL in js/config.js may be wrong, paused or deleted. You can keep using the app as a guest." : "You're offline. Cloud features will work again when you're back online.";
}

export async function init(handler) {
  onAuth = handler;
  if (!configured()) return false;
  try {
    const mod = await import('https://esm.sh/@supabase/supabase-js@2');
    sb = mod.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (e) { console.warn('Supabase library unavailable (offline?)', e); return false; }
  checkProviders();
  const { data } = await sb.auth.getSession();
  session = data.session || null;
  sb.auth.onAuthStateChange((_evt, s) => { const was = !!session; session = s; if (!!s !== was || s?.user?.id !== profile?.id) onAuth(s); });
  return true;
}

// Ask the project which sign-in methods are switched on, so the login screen only offers ones that work.
export let googleEnabled = false;
async function checkProviders() {
  try {
    const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: CFG.supabaseAnonKey } });
    if (!r.ok) return;
    googleEnabled = !!(await r.json())?.external?.google;
    document.dispatchEvent(new CustomEvent('lm:providers'));
  } catch {}
}

// ── Auth actions ────────────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
}
export async function signUp(email, password, name) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  return data.session ? 'signed_in' : 'confirm_email';
}
export async function signInGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '#/settings' }); if (error) throw error;
}
export async function signOut() { await sb?.auth.signOut(); session = null; profile = null; }
export const user = () => session?.user || null;
export const displayName = () => profile?.display_name || user()?.user_metadata?.full_name || user()?.email?.split('@')[0] || 'Guest';
export const avatarUrl = () => profile?.avatar_url || user()?.user_metadata?.avatar_url || '';

// ── Cloud state adapter ─────────────────────────────────────────────────────
export function setSync(state, text) { const p = $('#sync-pill'); if (!p) return; p.className = 'sync ' + state; $('#sync-text').textContent = text; }

async function loadCloud(uid) {
  const { data, error } = await sb.from('user_data').select('data,updated_at').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data?.data || null;
}
async function saveCloud(doc) {
  if (!session || !navigator.onLine) { setSync('', navigator.onLine ? 'Local' : 'Offline'); return; }
  setSync('busy', 'Saving…');
  const { error } = await sb.from('user_data').upsert({ user_id: session.user.id, data: doc, updated_at: new Date().toISOString() });
  if (error) { setSync('err', 'Sync failed'); console.warn(error); return; }
  // mirror xp to profile so the leaderboard can read it
  sb.from('profiles').update({ xp: doc.xp || 0, updated_at: new Date().toISOString() }).eq('id', session.user.id).then(() => {});
  setSync('ok', 'Synced');
}

// Called after sign-in: load profile + data, merge guest data if any, install adapter
export async function activateUser() {
  const u = user(); if (!u) return;
  setSync('busy', 'Loading…');
  try {
    const { data: p } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
    profile = p || null;
    if (!profile) { await sb.from('profiles').upsert({ id: u.id, display_name: displayName(), avatar_url: avatarUrl() }); profile = { id: u.id, display_name: displayName(), avatar_url: avatarUrl(), xp: 0 }; }
    const cloudDoc = await loadCloud(u.id);
    const localDoc = loadLocal(u.id);
    const guestDoc = loadLocal('guest');
    let doc = pickNewer(cloudDoc, localDoc);
    // first sign-in on this device with guest progress → merge guest decks in
    if (guestDoc && Object.keys(guestDoc.decks || {}).length && !localStorage.getItem(`lm:merged:${u.id}`)) {
      doc = mergeDocs(doc, guestDoc);
      localStorage.setItem(`lm:merged:${u.id}`, '1');
      toast('Your guest progress was added to this account', 'ok');
    }
    setUser(u.id, { save: saveCloud, load: () => loadCloud(u.id) });
    replaceState(doc || {});
    save({ immediate: true });
    setSync('ok', 'Synced');
  } catch (e) {
    console.warn(e);
    setUser(u.id, { save: saveCloud, load: () => loadCloud(u.id) });
    replaceState(loadLocal(u.id) || {});
    setSync('err', 'Offline copy');
  }
}
export function activateGuest() {
  setUser('guest', null);
  replaceState(loadLocal('guest') || {});
  setSync('', 'Local only');
}
function pickNewer(a, b) {
  if (!a) return b; if (!b) return a;
  return (a.updatedAt || '') >= (b.updatedAt || '') ? a : b;
}
function mergeDocs(base, extra) {
  const out = base ? JSON.parse(JSON.stringify(base)) : {};
  out.decks = out.decks || {};
  for (const [id, d] of Object.entries(extra.decks || {})) if (!out.decks[id]) out.decks[id] = d;
  out.history = Object.assign({}, extra.history || {}, out.history || {});
  out.xp = (out.xp || 0) + (extra.xp || 0);
  out.badges = [...new Set([...(out.badges || []), ...(extra.badges || [])])];
  out.streak = Math.max(out.streak || 0, extra.streak || 0);
  return out;
}

// ── Community library ───────────────────────────────────────────────────────
export async function publishDeck(deck, { description, tags }) {
  if (!user()) throw new Error('Sign in to publish');
  const cards = deck.cards.map(c => ({ word: c.word, phonetic: c.phonetic, type: c.type, definition: c.definition, example: c.example, farsi: c.farsi, synonyms: c.synonyms, collocs: c.collocs, context: c.context }));
  const row = { owner: user().id, title: deck.name, description: description || '', level: deck.level || 'intermediate', tags: tags || [], cards, card_count: cards.length, updated_at: new Date().toISOString() };
  let res;
  if (deck.publishedId) res = await sb.from('public_decks').update(row).eq('id', deck.publishedId).select('id').single();
  else res = await sb.from('public_decks').insert(row).select('id').single();
  if (res.error) throw res.error;
  deck.publishedId = res.data.id; save();
  return res.data.id;
}
export async function unpublishDeck(deck) {
  if (!deck.publishedId) return;
  const { error } = await sb.from('public_decks').delete().eq('id', deck.publishedId); if (error) throw error;
  deck.publishedId = null; save();
}
export async function browseDecks({ q = '', level = '', sort = 'downloads' } = {}) {
  let query = sb.from('public_decks').select('id,owner,title,description,level,tags,card_count,downloads,likes,created_at,profiles(display_name,avatar_url)').limit(60);
  if (level) query = query.eq('level', level);
  if (q) query = query.ilike('title', `%${q}%`);
  query = query.order(sort === 'new' ? 'created_at' : sort, { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function fetchDeck(id) {
  const { data, error } = await sb.from('public_decks').select('*').eq('id', id).single(); if (error) throw error; return data;
}
export async function importPublicDeck(id) {
  const row = await fetchDeck(id);
  const d = newDeck(row.title, { level: row.level, description: row.description });
  // copy the words only: never trust ids or progress fields stored in someone else's deck
  d.cards = (Array.isArray(row.cards) ? row.cards : []).map(c => newCard(cardContent(c))).filter(c => c.word);
  d.sourceId = id;
  S.decks[d.id] = d; recordNewWords(d.cards.map(c => c.word)); save();
  sb.rpc('download_deck', { p_deck: id }).then(() => {});
  return d;
}
export async function toggleLike(id) { const { data, error } = await sb.rpc('toggle_like', { p_deck: id }); if (error) throw error; return data; }
export async function myLikes() { if (!user()) return new Set(); const { data } = await sb.from('deck_likes').select('deck_id').eq('user_id', user().id); return new Set((data || []).map(r => r.deck_id)); }
export async function leaderboard() { const { data, error } = await sb.from('leaderboard').select('*'); if (error) throw error; return data || []; }
export async function updateProfile(fields) {
  if (!user()) return;
  const { error } = await sb.from('profiles').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', user().id); if (error) throw error;
  profile = { ...profile, ...fields };
}
export async function aiUsageToday() {
  if (!user()) return null;
  const { data } = await sb.from('api_usage').select('calls').eq('user_id', user().id).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle();
  return data?.calls || 0;
}
