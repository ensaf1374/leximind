// ── LexiMind configuration ─────────────────────────────────────────────
// 1. Create a Supabase project → Settings → API. Paste the Project URL and the anon/publishable key below.
// 2. Run supabase/schema.sql in the SQL editor.
// 3. Authentication → Providers: enable Email and Google (add your site URL to Redirect URLs).
// 4. Deploy the Edge Function (supabase/functions/claude-proxy) and set ANTHROPIC_API_KEY as a secret.
// Leave the URL empty to run the app fully offline as a guest (no sync, own API key only).
window.LEXIMIND_CONFIG = {
  supabaseUrl: "https://ydakiimjgupsaxzhnpzx.supabase.co",
  supabaseAnonKey: "sb_publishable_pqk8GcVDgGsmD1-KuG9BSQ_ZM7PNdGa",
  proxyFunction: "claude-proxy",   // name of the deployed Edge Function
  appName: "LexiMind",
  dailyGoalDefault: 20
};
