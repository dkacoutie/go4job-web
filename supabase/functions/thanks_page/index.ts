// supabase/functions/thanks_page/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pageHtml(params: {
  status: string;
  reason: string;
  action: string;
}) {
  const { status, reason, action } = params;

  const isOk = status !== "error";
  let title = "Merci ✅";
  let message = "Ton retour a bien été pris en compte.";
  let badge = "OK";
  let badgeKind: "ok" | "err" = "ok";

  if (isOk) {
    if (action === "up") {
      title = "Merci 👍";
      message = "Super ! On utilise ton 👍 pour améliorer les offres recommandées.";
      badge = "Feedback enregistré";
    } else if (action === "down") {
      title = "Merci 👎";
      message = "Merci ! Ton 👎 nous aide à filtrer les offres moins pertinentes.";
      badge = "Feedback enregistré";
    } else if (reason === "already_used") {
      title = "Merci ✅";
      message = "Ce lien a déjà été utilisé, mais c’est bon : ton feedback est déjà enregistré.";
      badge = "Déjà pris en compte";
    }
  } else {
    title = "Oups…";
    badge = "Erreur";
    badgeKind = "err";

    if (reason === "expired") {
      message = "Ce lien a expiré. Reçois un nouveau digest et réessaie.";
    } else if (reason === "invalid_token") {
      message = "Lien invalide. Vérifie que tu as ouvert le lien complet depuis l’email.";
    } else if (reason === "missing_token") {
      message = "Lien incomplet. Ouvre le lien depuis l’email.";
    } else {
      message = "Une erreur est survenue. Réessaie depuis l’email (ou le prochain digest).";
    }
  }

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Go4Job — Merci</title>
  <meta name="robots" content="noindex,nofollow" />
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 40px 16px; }
    .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 20px; }
    .h { font-size: 22px; margin: 0 0 8px; }
    .p { margin: 0 0 10px; color: #374151; line-height: 1.4; }
    .muted { color: #6b7280; font-size: 13px; }
    .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 13px; margin-top: 10px; }
    .ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    a.btn { display:inline-block; margin-top: 16px; padding: 10px 14px; border-radius: 12px; border: 1px solid #e5e7eb; text-decoration: none; color: #111827; }
    .small { font-size: 12px; word-break: break-all; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 class="h">${escapeHtml(title)}</h1>
      <p class="p">${escapeHtml(message)}</p>

      <span class="badge ${badgeKind}">${escapeHtml(badge)}</span>

      <a class="btn" href="https://go4job.org/">Retour à Go4Job</a>
    </div>

    <p class="muted" style="margin-top:14px">
      Astuce : tu peux fermer cette page et revenir à ton email.
    </p>
  </div>
</body>
</html>`;
}

serve((req) => {
  const url = new URL(req.url);

  const status = url.searchParams.get("status") ?? "ok";
  const reason = url.searchParams.get("reason") ?? "";
  const action = url.searchParams.get("action") ?? "";
  const html = pageHtml({ status, reason, action });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
