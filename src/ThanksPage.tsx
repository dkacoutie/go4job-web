import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import "./ThanksPage.css";

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

    let title = "Merci";
    let message = "Ton retour a bien ete pris en compte.";

    if (!isOk) {
      title = "Oups";
      message = "Une erreur est survenue. Tu peux fermer cette page.";
    } else if (reason === "already_used") {
      title = "Merci";
      message = "Ce lien a deja ete utilise, mais ton feedback est deja enregistre.";
    } else if (action === "up") {
      title = "Merci";
      message = "Super. On utilise ton retour pour ameliorer le matching.";
    } else if (action === "down") {
      title = "Merci";
      message = "Merci. Ton retour nous aide a filtrer les offres moins pertinentes.";
    }

    return { title, message, status, reason, action, feedback, jobId, alertId };
  }, [sp]);

  return (
    <div className="thanks-shell">
      <div className="thanks-card">
        <div className="thanks-kicker">Feedback JobRadar</div>
        <h1>{data.title}</h1>
        <p className="thanks-message">{data.message}</p>

        <div className="thanks-meta">
          {data.status && (
            <div>
              <b>status:</b> {data.status}
            </div>
          )}
          {data.reason && (
            <div>
              <b>reason:</b> {data.reason}
            </div>
          )}
          {data.action && (
            <div>
              <b>action:</b> {data.action}
            </div>
          )}
          {data.feedback && (
            <div>
              <b>feedback:</b> {data.feedback}
            </div>
          )}
          {data.jobId && (
            <div>
              <b>job_id:</b> {data.jobId}
            </div>
          )}
          {data.alertId && (
            <div>
              <b>alert_id:</b> {data.alertId}
            </div>
          )}
        </div>

        <div className="thanks-actions">
          <a className="btn btnGhost" href="/">
            Aller a l'accueil
          </a>
          <a className="btn btnPrimary" href="/auth">
            Se connecter
          </a>
        </div>
      </div>
    </div>
  );
}
