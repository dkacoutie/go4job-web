// src/ThanksPage.tsx
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

type Status = "ok" | "error";

export default function ThanksPage() {
  const [sp] = useSearchParams();

  const data = useMemo(() => {
    const status = (sp.get("status") || "ok") as Status;
    const reason = sp.get("reason") || "";
    const action = sp.get("action") || "";
    const feedback = sp.get("feedback") || "";
    const jobId = sp.get("job_id") || "";

    return { status, reason, action, feedback, jobId };
  }, [sp]);

  const isOk = data.status === "ok";

  let title = "Merci ✅";
  let message = "Ton retour a bien été pris en compte.";
  let badgeText = "OK";

  if (isOk) {
    if (data.action === "up") {
      title = "Merci 👍";
      message = "Super ! On utilise ton 👍 pour améliorer le matching.";
      badgeText = "Feedback enregistré";
    } else if (data.action === "down") {
      title = "Merci 👎";
      message = "Merci ! Ton 👎 nous aide à filtrer les offres moins pertinentes.";
      badgeText = "Feedback enregistré";
    } else if (data.reason === "already_used") {
      title = "Merci ✅";
      message = "Ce lien a déjà été utilisé, mais c’est bon : ton feedback est déjà enregistré.";
      badgeText = "Déjà pris en compte";
    }
  } else {
    title = "Oups…";
    badgeText = "Erreur";

    if (data.reason === "expired") {
      message = "Ce lien a expiré. Reçois un nouveau digest et réessaie.";
    } else if (data.reason === "invalid_token") {
      message = "Lien invalide. Vérifie que tu as ouvert le lien complet depuis l’email.";
    } else if (data.reason === "missing_token") {
      message = "Lien incomplet. Ouvre le lien depuis l’email.";
    } else {
      message = "Une erreur est survenue. Réessaie depuis l’email (ou le prochain digest).";
    }
  }

  const details = [data.reason && `reason=${data.reason}`, data.action && `action=${data.action}`, data.feedback && `feedback=${data.feedback}`, data.jobId && `job_id=${data.jobId}`]
    .filter(Boolean)
    .join(" • ");

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 16px" }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 20 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{title}</h1>
          <p style={{ margin: "0 0 10px", color: "#374151", lineHeight: 1.4 }}>{message}</p>

          <span
            style={{
              display: "inline-block",
              padding: "6px 10px",
              borderRadius: 999,
              fontSize: 13,
              marginTop: 10,
              background: isOk ? "#ecfdf5" : "#fef2f2",
              color: isOk ? "#065f46" : "#991b1b",
              border: `1px solid ${isOk ? "#a7f3d0" : "#fecaca"}`,
            }}
          >
            {badgeText}
          </span>

          {details ? (
            <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12, wordBreak: "break-all" }}>
              Détails: {details}
            </p>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <Link
              to="/"
              style={{
                display: "inline-block",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                textDecoration: "none",
                color: "#111827",
              }}
            >
              Retour à Go4Job
            </Link>
          </div>
        </div>

        <p style={{ marginTop: 14, color: "#6b7280", fontSize: 13 }}>Astuce : tu peux fermer cette page et revenir à ton email.</p>
      </div>
    </div>
  );
}
