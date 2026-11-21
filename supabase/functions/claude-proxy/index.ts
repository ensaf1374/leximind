// Supabase Edge Function: claude-proxy
// Deploy:  supabase functions deploy claude-proxy
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
// Optional: DAILY_CALL_LIMIT=300  CLAUDE_MODEL=claude-sonnet-4-6  ALLOWED_ORIGIN=https://your-site
//
// The browser never sees the Anthropic key. Every call must carry a valid Supabase user JWT,
// is counted against a daily per-user quota, and is forwarded with a server-side max_tokens cap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAILY_CALL_LIMIT = Number(Deno.env.get("DAILY_CALL_LIMIT") ?? 300);
const MAX_TOKENS_CAP = 3000;
const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-6";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in to use AI features" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !user) return json({ error: "Invalid or expired session — sign in again" }, 401);

  let body: { prompt?: string; system?: string; max_tokens?: number };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const prompt = String(body.prompt ?? "").slice(0, 12000);
  if (!prompt.trim()) return json({ error: "Empty prompt" }, 400);
  const max_tokens = Math.min(Math.max(Number(body.max_tokens ?? 500), 16), MAX_TOKENS_CAP);

  const { data: calls, error: qerr } = await admin.rpc("bump_api_usage", { p_user: user.id, p_tokens: max_tokens });
  if (qerr) return json({ error: "Quota check failed" }, 500);
  if ((calls as number) > DAILY_CALL_LIMIT)
    return json({ error: `Daily AI limit reached (${DAILY_CALL_LIMIT}). Try again tomorrow or add your own key in Settings.`, quota: true }, 429);

  const payload: Record<string, unknown> = { model: MODEL, max_tokens, messages: [{ role: "user", content: prompt }] };
  if (body.system) payload.system = String(body.system).slice(0, 4000);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: d?.error?.message ?? `Upstream ${r.status}` }, r.status === 429 ? 429 : 502);
  const text = (d.content ?? []).find((b: { type: string }) => b.type === "text")?.text ?? "";
  return json({ text, remaining: Math.max(0, DAILY_CALL_LIMIT - (calls as number)) });
});
