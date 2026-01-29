import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export default function ThanksPage() {
  const [sp] = useSearchParams();

  const data = useMemo(() => {
    const status = sp.get("status") ?? "";
    const reason = sp.get("reason") ?? "";
    const action = sp.get("action") ?? "";
    const feedback = sp.get("feedback") ?? "";
    const jobId = sp.get("job_id") ?? "";
    const alertId = sp.get("alert_id") ?? "";

    const isOk = status !== "error";

    let title = "Merci ✅";
    let message = "Ton retour a bien été pris en compte.";

    if (!isOk) {
      title = "Oups 😕";
      message = "Une erreur est survenue. Tu peux fermer cette page.";
    } else if (reason === "already_used") {
      title = "Merci ✅";
      message = "Ce lien a déjà été utilisé, mais ton feedback est déjà enregistré.";
    } else if (action === "up") {
      title = "Merci 👍";
      message = "Super ! On utilise ton 👍 pour améliorer le matching.";
    } else if (action === "down") {
      title = "Merci 👎";
      message = "Merci ! Ton 👎 nous aide à filtrer les offres moins pertinentes.";
    }

    return { title, message, status, reason, action, feedback, jobId, alertId };
  }, [sp]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 640, width: "100%", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>{data.title}</h1>
        <p style={{ marginTop: 12, marginBottom: 20, lineHeight: 1.5 }}>{data.message}</p>

        <div style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.6 }}>
          {data.status && <div><b>status:</b> {data.status}</div>}
          {data.reason && <div><b>reason:</b> {data.reason}</div>}
          {data.action && <div><b>action:</b> {data.action}</div>}
          {data.feedback && <div><b>feedback:</b> {data.feedback}</div>}
          {data.jobId && <div><b>job_id:</b> {data.jobId}</div>}
          {data.alertId && <div><b>alert_id:</b> {data.alertId}</div>}
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", textDecoration: "none" }}>
            Aller à l’accueil
          </a>
          <a href="/auth" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", textDecoration: "none" }}>
            Se connecter
          </a>
        </div>
      </div>
    </div>
  );
}
