// supabase/functions/email_action/index.ts
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type EmailActionTokenRow = {
  token: string;
  user_id: string;
  job_id: string;
  action: string | null;
  alert_id: string | null;
  expires_at: string | null;
  used_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function isExpired(expiresAtIso: string | null) {
  if (!expiresAtIso) return false;
  const exp = new Date(expiresAtIso).getTime();
  if (Number.isNaN(exp)) return false;
  return exp <= Date.now();
}

function normalizeAction(raw: string | null): "up" | "down" | "unknown" {
  if (!raw) return "unknown";
  const v = raw.trim().toLowerCase();
  if (["up", "like", "thumbs_up", "thumbsup", "1", "yes"].includes(v)) return "up";
  if (["down", "dislike", "thumbs_down", "thumbsdown", "-1", "no"].includes(v)) return "down";
  return "unknown";
}

function feedbackFromAction(a: "up" | "down" | "unknown"): 1 | -1 | null {
  if (a === "up") return 1;
  if (a === "down") return -1;
  return null;
}

function buildThanksUrl(params: {
  status: string;
  reason?: string;
  action?: string;
  feedback?: string;
  job_id?: string;
  alert_id?: string | null;
}) {
  // IMPORTANT: URL HTTPS réelle (ex: https://go4job.org/thanks)
  const base = (Deno.env.get("THANKS_BASE_URL") || "https://go4job.org/thanks").trim();
  const u = new URL(base);
  u.searchParams.set("status", params.status);
  if (params.reason) u.searchParams.set("reason", params.reason);
  if (params.action) u.searchParams.set("action", params.action);
  if (params.feedback) u.searchParams.set("feedback", params.feedback);
  if (params.job_id) u.searchParams.set("job_id", params.job_id);
  if (params.alert_id) u.searchParams.set("alert_id", params.alert_id ?? "");
  return u.toString();
}

function redirectToThanks(url: string, status = 303) {
  // 303 = “See Other” (pratique pour éviter comportements bizarres / cache)
  return new Response(null, {
    status,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
    },
  });
}

serve(async (req) => {
  try {
    const requestUrl = new URL(req.url);
    const token = requestUrl.searchParams.get("token")?.trim();

    // Pas de token → redirection "missing_token"
    if (!token) {
      const thanks = buildThanksUrl({ status: "error", reason: "missing_token" });
      return redirectToThanks(thanks);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      const thanks = buildThanksUrl({ status: "error", reason: "server_misconfigured" });
      return redirectToThanks(thanks);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) Lire le token
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("email_action_tokens")
      .select("token,user_id,job_id,action,alert_id,expires_at,used_at")
      .eq("token", token)
      .maybeSingle<EmailActionTokenRow>();

    if (tokenErr) {
      const thanks = buildThanksUrl({ status: "error", reason: "db_read_failed" });
      return redirectToThanks(thanks);
    }

    if (!tokenRow) {
      const thanks = buildThanksUrl({ status: "error", reason: "invalid_token" });
      return redirectToThanks(thanks);
    }

    if (tokenRow.used_at) {
      const thanks = buildThanksUrl({
        status: "ok",
        reason: "already_used",
        action: tokenRow.action ?? undefined,
        job_id: tokenRow.job_id,
        alert_id: tokenRow.alert_id,
      });
      return redirectToThanks(thanks);
    }

    if (isExpired(tokenRow.expires_at)) {
      const thanks = buildThanksUrl({
        status: "error",
        reason: "expired",
        action: tokenRow.action ?? undefined,
        job_id: tokenRow.job_id,
        alert_id: tokenRow.alert_id,
      });
      return redirectToThanks(thanks);
    }

    const actionNorm = normalizeAction(tokenRow.action);
    const feedback = feedbackFromAction(actionNorm);

    if (feedback === null) {
      const thanks = buildThanksUrl({
        status: "error",
        reason: "unknown_action",
        action: tokenRow.action ?? undefined,
        job_id: tokenRow.job_id,
        alert_id: tokenRow.alert_id,
      });
      return redirectToThanks(thanks);
    }

    // 2) Écrire/mettre à jour le feedback (logique intacte)
    const payload = {
      user_id: tokenRow.user_id,
      job_id: tokenRow.job_id,
      feedback, // 1 ou -1
      via: "email",
      action: actionNorm, // "up" | "down"
      created_at: nowIso(),
    };

    const { error: upsertErr } = await supabase
      .from("job_feedback")
      .upsert(payload, { onConflict: "user_id,job_id" });

    if (upsertErr) {
      const thanks = buildThanksUrl({
        status: "error",
        reason: "feedback_write_failed",
        action: actionNorm,
        feedback: String(feedback),
        job_id: tokenRow.job_id,
        alert_id: tokenRow.alert_id,
      });
      return redirectToThanks(thanks);
    }

    // 3) Marquer le token comme utilisé
    const { error: usedErr } = await supabase
      .from("email_action_tokens")
      .update({ used_at: nowIso() })
      .eq("token", token);

    if (usedErr) {
      // Feedback écrit OK, mais used_at KO → on redirige quand même en "ok" (MVP)
      const thanks = buildThanksUrl({
        status: "ok",
        reason: "feedback_saved_but_token_not_marked",
        action: actionNorm,
        feedback: String(feedback),
        job_id: tokenRow.job_id,
        alert_id: tokenRow.alert_id,
      });
      return redirectToThanks(thanks);
    }

    // 4) OK → redirection vers page Merci HTTPS
    const thanks = buildThanksUrl({
      status: "ok",
      action: actionNorm,
      feedback: String(feedback),
      job_id: tokenRow.job_id,
      alert_id: tokenRow.alert_id,
    });
    return redirectToThanks(thanks);
  } catch {
    const thanks = buildThanksUrl({ status: "error", reason: "unexpected" });
    return redirectToThanks(thanks);
  }
});
