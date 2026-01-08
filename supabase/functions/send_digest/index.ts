/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type DigestRequest = {
  dry_run?: boolean;
  user_id?: string;
  to_email?: string;
  country?: string; // ex: "CI"
  keywords?: string; // optionnel
  alert_id?: string | null; // optionnel
  limit_top?: number;
  limit_explorer?: number;
  public_functions_base?: string; // ex: "http://127.0.0.1:54321/functions/v1"
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function requireCronSecret(req: Request) {
  // ✅ FIX: trim des deux côtés (évite espaces / retours à la ligne invisibles)
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  // Si pas de secret configuré, on n'impose pas (utile en dev)
  if (!expected) return;

  const got = (req.headers.get("x-cron-secret") ?? "").trim();
  if (got !== expected) {
    throw new Error("unauthorized");
  }
}

function getEnvAny(keys: string[]): string | null {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}

function makeToken(): string {
  // Toujours une string non-vide
  return crypto.randomUUID().replaceAll("-", "");
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateFR(d: Date) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "content-type, x-cron-secret, authorization, apikey",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    if (req.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    // Auth cron (header x-cron-secret)
    try {
      requireCronSecret(req);
    } catch {
      return json(401, { ok: false, error: "unauthorized" });
    }

    const body = (await req.json().catch(() => ({}))) as DigestRequest;

    const dry_run = !!body.dry_run;
    const user_id = body.user_id?.trim();
    const to_email = body.to_email?.trim();
    const country = (body.country?.trim() || "CI").toUpperCase();
    const keywords = (body.keywords?.trim() || "");
    const alert_id = body.alert_id ?? null;

    const limit_top = Math.max(0, Math.min(10, body.limit_top ?? 5));
    const limit_explorer = Math.max(0, Math.min(20, body.limit_explorer ?? 10));
    const total_limit = limit_top + limit_explorer;

    if (!user_id) return json(400, { ok: false, error: "missing_user_id" });
    if (!to_email) return json(400, { ok: false, error: "missing_to_email" });

    // Env: on supporte tes deux noms (SUPABASE_* et SB_*)
    const supabaseUrl =
      getEnvAny(["SUPABASE_URL", "SB_URL"]) ??
      "http://127.0.0.1:54321";
    const serviceRoleKey =
      getEnvAny(["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY"]) ?? "";
    const anonKey = getEnvAny(["SUPABASE_ANON_KEY", "SB_ANON_KEY"]) ?? "";

    if (!serviceRoleKey) {
      return json(500, {
        ok: false,
        error: "missing_service_role_key",
        message:
          "Set SUPABASE_SERVICE_ROLE_KEY (or SB_SERVICE_ROLE_KEY) in supabase/functions/.env",
      });
    }

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: anonKey
          ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
          : {},
      },
    });

    // 1) Charger quelques jobs (simple, pour test local)
    const { data: jobs, error: jobsErr } = await sb
      .from("jobs")
      .select(
        "id,title,company_name,location,country,remote_type,external_id,created_at",
      )
      .eq("country", country)
      .order("created_at", { ascending: false })
      .limit(total_limit);

    if (jobsErr) {
      return json(400, {
        ok: false,
        error: "supabase_get_failed",
        message: String(jobsErr.message ?? jobsErr),
      });
    }

    const list = jobs ?? [];
    const top = list.slice(0, limit_top);
    const explore = list.slice(limit_top, limit_top + limit_explorer);

    // Base publique pour liens actions
    const functionsBase =
      body.public_functions_base?.trim() ||
      Deno.env.get("PUBLIC_FUNCTIONS_BASE") ||
      "http://127.0.0.1:54321/functions/v1";

    // 2) Générer tokens (uniquement si jobs)
    type TokenRow = {
      token: string;
      user_id: string;
      job_id: string;
      action: "up" | "down";
      alert_id?: string | null;
      expires_at: string;
    };

    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();

    const tokenRows: TokenRow[] = [];
    for (const j of [...top, ...explore]) {
      // Sécurité: token TOUJOURS non-null
      const upToken = makeToken();
      const downToken = makeToken();

      tokenRows.push({
        token: upToken,
        user_id,
        job_id: j.id,
        action: "up",
        alert_id,
        expires_at: expires,
      });
      tokenRows.push({
        token: downToken,
        user_id,
        job_id: j.id,
        action: "down",
        alert_id,
        expires_at: expires,
      });
    }

    if (tokenRows.length > 0) {
      const { error: insErr } = await sb.from("email_action_tokens").insert(
        tokenRows,
        { defaultToNull: true },
      );
      if (insErr) {
        return json(400, {
          ok: false,
          error: "supabase_insert_failed",
          message: String(insErr.message ?? insErr),
        });
      }
    }

    // 3) Construire HTML
    const dateStr = formatDateFR(new Date());
    const subject = `JobRadar — Tes Top offres du ${dateStr} (${country})`;

    function jobLine(j: any) {
      const title = escapeHtml(j.title ?? "Offre");
      const company = escapeHtml(j.company_name ?? "");
      const loc = escapeHtml(j.location ?? "");
      const meta = [company, loc].filter(Boolean).join(" • ");

      // récupérer les tokens correspondants
      const up = tokenRows.find((t) => t.job_id === j.id && t.action === "up")
        ?.token;
      const down = tokenRows.find((t) =>
        t.job_id === j.id && t.action === "down"
      )?.token;

      const upUrl = up
        ? `${functionsBase}/email_action?token=${encodeURIComponent(up)}`
        : "#";
      const downUrl = down
        ? `${functionsBase}/email_action?token=${encodeURIComponent(down)}`
        : "#";

      return `
<li>
  <div><b>${title}</b></div>
  <div style="color:#666;font-size:13px">${meta}</div>
  <div style="margin-top:6px;font-size:13px">
    <a href="${upUrl}">👍</a>&nbsp;&nbsp;<a href="${downUrl}">👎</a>
  </div>
</li>`;
    }

    const topHtml = top.length
      ? `<ol>${top.map(jobLine).join("")}</ol>`
      : `<ol><li>Aucun top match aujourd’hui.</li></ol>`;

    const exploreHtml = explore.length
      ? `<ol>${explore.map(jobLine).join("")}</ol>`
      : `<ol><li>Aucune offre à explorer aujourd’hui.</li></ol>`;

    const html = `
<div style="font-family:Arial,sans-serif;line-height:1.4">
  <h2>JobRadar — ${dateStr}</h2>

  <p><b>Top Matchs</b></p>
  ${topHtml}

  <p><b>Explorer</b></p>
  ${exploreHtml}

  <hr/>
  <p style="font-size:12px;color:#666">
    Merci ! Tes 👍/👎 servent à améliorer le matching.
  </p>
</div>`.trim();

    // 4) Dry run (pas d’envoi)
    return json(200, {
      ok: true,
      status: dry_run ? "dry_run_generated" : "generated",
      to_email,
      subject,
      keywords,
      country,
      top_count: top.length,
      explore_count: explore.length,
      functions_base: functionsBase,
      html,
    });
  } catch (e) {
    return json(500, { ok: false, error: "send_digest_failed", message: String(e) });
  }
});
