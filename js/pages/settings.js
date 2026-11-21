import { html, raw, esc, $, toast, confirmDialog, modal, el } from '../lib/ui.js';
import { S, SETTINGS, saveSettings, save, makeBackup, validateBackup, replaceState, downloadFile, CFG, currentUserId, loadLocal, today } from '../lib/store.js';
import * as supa from '../lib/supa.js';
import { aiAvailable, remainingToday } from '../lib/ai.js';
import { voices, speak, isNatural, bestVoice } from '../lib/speech.js';

export default {
  async render(main) {
    const u = supa.user(); const vs = [...voices()].sort((a, b) => isNatural(b) - isNatural(a) || (b.lang === 'en-US') - (a.lang === 'en-US') || a.name.localeCompare(b.name));
    const auto = bestVoice(), anyNatural = vs.some(isNatural);
    const usage = u ? await supa.aiUsageToday().catch(() => null) : null;
    main.innerHTML = html`
      <div class="page-head"><div><h1>Settings</h1></div></div>
      <div class="stack">
        <section class="panel"><h3>Account</h3>
          ${u ? html`<div class="row" style="gap:14px"><span class="avatar" style="width:48px;height:48px;flex-basis:48px;font-size:18px">${supa.avatarUrl() ? raw(`<img src="${esc(supa.avatarUrl())}" alt="" referrerpolicy="no-referrer">`) : supa.displayName()[0]}</span><div><b>${supa.displayName()}</b><br><span class="small muted">${u.email}</span></div><div class="row" style="margin-left:auto"><button class="btn btn-sm" id="st-name">Change name</button><button class="btn btn-sm" id="st-pass">Change password</button><button class="btn btn-sm btn-danger" id="st-out">Sign out</button></div></div>
            <p class="small muted" style="margin-top:10px">Your decks and progress sync to this account. ${usage != null ? `AI calls used today: <b>${usage}</b>.` : ''}</p>`
          : html`<p class="muted">You're using LexiMind as a guest. Progress is saved in this browser only.</p>${supa.configured() ? html`<button class="btn btn-primary" id="st-signin" style="margin-top:10px">Sign in or create an account</button><p class="small muted" style="margin-top:8px">Your guest decks will be moved into the account automatically.</p>` : html`<p class="notice warn" style="margin-top:10px">Cloud accounts aren't configured. Add your Supabase project to <code>js/config.js</code>.</p>`}`}
        </section>

        <section class="panel"><h3>AI</h3>
          <p class="small muted">${supa.configured() ? 'By default AI runs through the shared LexiMind service (sign-in required, daily limit). Turn on your own key to use your Anthropic account instead — no limit, and it also works as a guest.' : 'This copy of LexiMind has no shared AI service, so an Anthropic API key is needed for AI features.'}</p>
          <label class="row" style="margin:12px 0 8px;gap:8px"><input type="checkbox" id="st-own" ${SETTINGS.useOwnKey ? 'checked' : ''}> Use my own Anthropic API key</label>
          <div id="st-own-box" ${SETTINGS.useOwnKey ? '' : 'hidden'} class="stack">
            <label class="field"><span>API key</span><input type="password" id="st-key" value="${SETTINGS.ownKey}" placeholder="sk-ant-…" autocomplete="off"></label>
            <p class="small muted">Stored only in this browser, never synced or included in backups. Get one at console.anthropic.com. If you share this device, don't store your key here.</p>
          </div>
          <p class="small" style="margin-top:8px">Status: <b>${aiAvailable() === 'own' ? 'using your key' : aiAvailable() === 'proxy' ? `shared service${remainingToday != null ? ` · ${remainingToday} calls left today` : ''}` : 'off'}</b></p>
        </section>

        <section class="panel"><h3>Study</h3>
          <div class="grid grid-2">
            <label class="field"><span>Daily goal (cards)</span><input type="number" id="st-goal" min="1" max="300" value="${S.dailyGoal}"></label>
            <label class="field"><span>Timer per card</span><select id="st-timer"><option value="0" ${!SETTINGS.timer ? 'selected' : ''}>Off</option>${raw([15, 30, 45, 60].map(v => `<option value="${v}" ${SETTINGS.timer == v ? 'selected' : ''}>${v} seconds</option>`).join(''))}</select></label>
          </div>
          <label class="row" style="margin-top:10px;gap:8px"><input type="checkbox" id="st-auto" ${SETTINGS.autoSpeak ? 'checked' : ''}> Pronounce each word automatically when the card appears</label>
        </section>

        <section class="panel"><h3>Voice</h3>
          <div class="grid grid-2">
            <label class="field"><span>English voice</span><select id="st-voice"><option value="">Automatic${auto ? ` — ${auto.name.replace(/ - English.*$/, '')}` : ''}</option>${raw(vs.map(v => `<option value="${esc(v.name)}" ${SETTINGS.voice === v.name ? 'selected' : ''}>${isNatural(v) ? '★ ' : ''}${esc(v.name.replace(/ - English.*$/, ''))} (${esc(v.lang)})</option>`).join(''))}</select></label>
            <label class="field"><span>Speed <b id="st-rate-v">${SETTINGS.rate}×</b></span><input type="range" id="st-rate" min="0.5" max="1.5" step="0.1" value="${SETTINGS.rate}"></label>
          </div>
          <button class="btn btn-sm" id="st-test" style="margin-top:10px"><i data-ico="volume"></i> Test voice</button>
          <p class="small muted" style="margin-top:10px">${anyNatural ? 'Voices marked ★ sound the most human.' : 'This browser only has basic voices. For a much more natural voice, open LexiMind in Microsoft Edge: it includes “Natural” voices that are picked automatically.'}</p>
        </section>

        <section class="panel"><h3>Appearance</h3>
          <div class="seg"><button data-t="" class="${!SETTINGS.theme ? 'on' : ''}">System</button><button data-t="light" class="${SETTINGS.theme === 'light' ? 'on' : ''}">Light</button><button data-t="dark" class="${SETTINGS.theme === 'dark' ? 'on' : ''}">Dark</button></div>
        </section>

        <section class="panel"><h3>Your data</h3>
          <div class="kv"><span>Download a backup of everything (never includes API keys)</span><button class="btn btn-sm" id="st-backup">Download backup</button></div>
          <div class="kv"><span>Restore from a backup file</span><button class="btn btn-sm" id="st-restore">Restore…</button></div>
          <div class="kv"><span>Install as an app on this device</span><button class="btn btn-sm" id="st-install" ${window.__lxInstall ? '' : 'disabled title="Your browser will offer this from its menu, or the app is already installed"'}>Install</button></div>
          <div class="kv"><span>Erase all decks and progress ${u ? 'from this account' : 'on this device'}</span><button class="btn btn-sm btn-danger" id="st-erase">Erase</button></div>
        </section>
        <p class="small muted">LexiMind · ${u ? 'signed in' : 'guest'} · data key <code>${currentUserId()}</code></p>
      </div>`;

    // browsers load their voice list a moment after the page: refresh the list once when it arrives
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => { if (location.hash.startsWith('#/settings') && voices().length !== vs.length && !document.querySelector('.overlay')) this.render(main); }, { once: true });
    $('#st-signin')?.addEventListener('click', () => { localStorage.removeItem('lm:guest'); location.reload(); });
    $('#st-out')?.addEventListener('click', async () => { if (await confirmDialog('Sign out?', 'Your data stays in the cloud and comes back when you sign in again.')) { await supa.signOut(); localStorage.removeItem('lm:guest'); location.hash = '#/home'; location.reload(); } });
    $('#st-name')?.addEventListener('click', async () => { const { promptDialog } = await import('../lib/ui.js'); const n = await promptDialog('Your name', { value: supa.displayName(), okLabel: 'Save' }); if (n) { try { await supa.updateProfile({ display_name: n }); toast('Name updated', 'ok'); this.render(main); } catch (e) { toast(e.message, 'err'); } } });
    $('#st-pass')?.addEventListener('click', () => {
      const body = el('div', { class: 'stack' }); body.innerHTML = `<label class="field"><span>New password</span><input type="password" id="np" minlength="8" autocomplete="new-password"></label>`;
      modal({ title: 'Change password', body, actions: [{ label: 'Cancel' }, { label: 'Update', cls: 'btn-primary', onClick: async () => { const p = body.querySelector('#np').value; if (p.length < 8) { toast('Use at least 8 characters', 'err'); return false; } const { error } = await supa.sb.auth.updateUser({ password: p }); if (error) { toast(error.message, 'err'); return false; } toast('Password updated', 'ok'); } }] });
    });
    $('#st-own').onchange = e => { SETTINGS.useOwnKey = e.target.checked; $('#st-own-box').hidden = !e.target.checked; saveSettings(); this.render(main); };
    $('#st-key').oninput = e => { SETTINGS.ownKey = e.target.value.trim(); saveSettings(); };
    $('#st-goal').onchange = e => { const v = parseInt(e.target.value); if (v > 0) { S.dailyGoal = v; save(); toast(`Daily goal: ${v} cards`, 'ok'); } };
    $('#st-timer').onchange = e => { SETTINGS.timer = +e.target.value; saveSettings(); };
    $('#st-auto').onchange = e => { SETTINGS.autoSpeak = e.target.checked; saveSettings(); };
    $('#st-voice').onchange = e => { SETTINGS.voice = e.target.value; saveSettings(); speak('This is how I sound when I read to you.'); };
    $('#st-rate').oninput = e => { SETTINGS.rate = +e.target.value; $('#st-rate-v').textContent = SETTINGS.rate.toFixed(1) + '×'; saveSettings(); };
    $('#st-test').onclick = () => speak('Perseverance is the key to learning any language.');
    main.querySelectorAll('.seg [data-t]').forEach(b => b.onclick = () => { SETTINGS.theme = b.dataset.t || null; saveSettings(); const dark = SETTINGS.theme ? SETTINGS.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark', dark); localStorage.setItem('lm:theme', SETTINGS.theme || ''); this.render(main); });
    $('#st-backup').onclick = () => { downloadFile(JSON.stringify(makeBackup(), null, 2), 'application/json', `leximind-backup-${today()}.json`); toast('Backup downloaded', 'ok'); };
    $('#st-restore').onclick = () => { const inp = el('input', { type: 'file', accept: '.json,application/json' }); inp.onchange = async () => { const f = inp.files[0]; if (!f) return; if (f.size > 25e6) return toast('That file is too large to be a LexiMind backup', 'err'); try { const obj = JSON.parse(await f.text()); const { doc, decks, cards } = validateBackup(obj); if (await confirmDialog('Restore backup?', `${decks} decks and ${cards} cards from ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleString() : 'an older backup'} will replace your current data.`, { danger: true, okLabel: 'Restore' })) { replaceState(doc); save({ immediate: true }); toast('Backup restored', 'ok'); location.hash = '#/home'; } } catch (e) { toast(e.message, 'err', 5000); } }; inp.click(); };
    $('#st-install').onclick = async () => { if (window.__lxInstall) { window.__lxInstall.prompt(); } };
    $('#st-erase').onclick = async () => { if (await confirmDialog('Erase everything?', 'All decks, cards, history and badges will be deleted. This cannot be undone.', { danger: true, okLabel: 'Erase all data' })) { replaceState({}); save({ immediate: true }); toast('All data erased'); location.hash = '#/home'; } };
  }
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__lxInstall = e; });
