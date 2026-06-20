import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import "./ThanksPage.css";

export default function ThanksPage() {
  const [sp] = useSearchParams();

  const data = useMemo(() => {
    const status = sp.get("status") ?? "";
    const reason = sp.get("reason") ?? "";
    const action = sp.get("action") ?? "";

    const isOk = status !== "error";

    let title = "Merci";
    let message = "Ton retour a bien été pris en compte.";

    if (!isOk) {
      title = "Oups";
      message = "Une erreur est survenue. Tu peux fermer cette page.";
    } else if (reason === "already_used") {
      title = "Merci";
      message = "Ce lien a déjà été utilisé, mais ton retour est déjà enregistré.";
    } else if (action === "up") {
      title = "Merci";
      message = "Super. On utilise ton retour pour améliorer les offres recommandées.";
    } else if (action === "down") {
      title = "Merci";
      message = "Merci. Ton retour nous aide à filtrer les offres moins pertinentes.";
    }

    return { title, message };
  }, [sp]);

  return (
    <div className="thanks-shell">
      <div className="thanks-card">
        <div className="thanks-kicker">Feedback JobRadar</div>
        <h1>{data.title}</h1>
        <p className="thanks-message">{data.message}</p>

        <div className="thanks-actions">
          <a className="btn btnGhost" href="/">
            Aller à l'accueil
          </a>
          <a className="btn btnPrimary" href="/auth">
            Se connecter
          </a>
        </div>
      </div>
    </div>
  );
}
