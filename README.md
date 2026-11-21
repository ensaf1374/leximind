# LexiMind

English vocabulary trainer for Farsi speakers: spaced repetition (SM-2) + Leitner boxes, AI-written cards and readings, speaking & listening practice, a shared deck library, XP/badges/streak freezes, and an installable offline-capable PWA.

```
index.html                 app shell + login screen
css/app.css                design system
js/config.js               ← the only file you must edit
js/app.js                  boot, auth screen, routing
js/lib/                    store (state+sync), srs, gamify, ai, speech, supa (Supabase), ui
js/pages/                  home, study, speak, read, collocations, library, community, progress, settings, more
sw.js, manifest.webmanifest, icons/     PWA
supabase/schema.sql        database tables, RLS policies, RPCs
supabase/functions/claude-proxy/index.ts   Edge Function that holds the shared Anthropic key
```

## 1. Run it locally (guest mode, no cloud)

The app uses ES modules, so it must be served over http, not opened as a file:

```
cd leximind
python3 -m http.server 8080      # then open http://localhost:8080
```

Click **Try it without an account**. Everything works except sync, community and shared AI. Add your own Anthropic key in *Settings → AI* to enable AI features as a guest.

## 2. Set up accounts + sync + community (Supabase, free tier)

1. Create a project at supabase.com. In **Project Settings → API** copy the *Project URL* and *anon public* key into `js/config.js`.
2. **SQL Editor** → paste `supabase/schema.sql` → Run. This creates `profiles`, `user_data`, `public_decks`, `deck_likes`, `api_usage`, the RPCs and all Row-Level-Security policies (each user can only read/write their own rows).
3. **Authentication → Providers**: enable **Email** (keep "Confirm email" on) and **Google** (create OAuth credentials in Google Cloud Console; Supabase shows you the callback URL to paste there).
4. **Authentication → URL Configuration**: set *Site URL* to where you host the app (e.g. `https://yourname.github.io/leximind/`) and add it to *Redirect URLs*. For local testing also add `http://localhost:8080`.

Guest progress on a device is merged into the account the first time that person signs in there.

## 3. Shared AI key (Edge Function)

The browser never sees your Anthropic key. The Edge Function checks the user's login token, counts the call against a daily per-user quota, caps `max_tokens`, and forwards to Anthropic.

```
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set DAILY_CALL_LIMIT=300          # optional, default 300
supabase functions deploy claude-proxy
```

`ALLOWED_ORIGIN` (optional secret) locks CORS to your site. Users who want no limit can turn on **Use my own key** in Settings; that key stays in their browser only.

Rough cost: one flashcard generation ≈ 1–3k tokens; with Sonnet pricing a heavy user costs cents per day. Lower `DAILY_CALL_LIMIT` if you open it to the public.

## 4. Host it

Any static host works. GitHub Pages: push the folder to a repo → Settings → Pages → deploy from `main`. Netlify/Vercel: drag the folder in. HTTPS is required for the service worker, microphone and Google sign-in.

## 5. Update the app

Bump `VERSION` in `sw.js` (e.g. `lx-v2`) whenever you deploy changes, so installed PWAs pick up the new files.

## Where data lives

| Data | Guest | Signed in |
|---|---|---|
| Decks, progress, XP, badges, readings | `localStorage` (`lm:data:guest`) | `user_data.data` (JSON) + local copy per user id |
| Device settings (theme, voice, own API key) | `localStorage` (`lm:settings`), never synced | same |
| Shared decks | — | `public_decks` (cards only, no progress) |
| AI usage | — | `api_usage` (per user, per day) |

Backups (Settings → Your data) contain everything except API keys.

## Browser support

Chrome/Edge: everything. Safari: everything except speech recognition (Pronounce/Shadowing) — dictation and the listening quiz still work. Firefox: no speech recognition.
