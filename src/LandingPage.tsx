import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

export default function LandingPage() {
  const navigate = useNavigate();

  const goAuth = () => {
    navigate("/auth", { state: { from: "/jobradar/feed" } });
  };

  const goPricing = () => {
    navigate("/pricing");
  };

  return (
    <div className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero__content">
          <div className="landing-badge">Plus de 11 000 offres disponibles</div>
          <h1>Repère plus vite les offres qui te correspondent</h1>
          <p>
            JobRadar surveille les offres pour toi et met en avant celles qui correspondent à ton profil —
            sans que tu aies à chercher chaque jour.
          </p>

          <div className="landing-hero__cta">
            <button type="button" className="btn btnPrimary" onClick={goAuth}>
              Voir mes offres
            </button>
            <button type="button" className="btn btnGhost" onClick={goPricing}>
              Voir les tarifs
            </button>
          </div>

          <div className="landing-micro">
            Tu peux découvrir JobRadar gratuitement. Un pass permet ensuite de débloquer plus
            d’opportunités.
          </div>
        </div>

        <a
          className="landing-hero__visual hero-media"
          href="/auth"
          aria-label="Créer mon compte JobRadar"
          style={{ ["--hero-image" as any]: "url('/jobradar-hero-vertical.png')" }}
        >
          <div className="hero-media__frame" />
        </a>
      </section>

      <section className="landing-proofbar" aria-label="Preuves">
        <div className="landing-proofbar__item">Plus de 11 000 offres mises à jour régulièrement</div>
        <div className="landing-proofbar__item">Afrique, Europe et distance</div>
        <div className="landing-proofbar__item">Offres sauvegardées pour y revenir</div>
      </section>

      <section className="landing-section landing-steps" aria-label="Comment ça marche">
        <div className="landing-section__header">
          <h2>Comment ça marche ?</h2>
          <p>Un parcours simple pour passer plus vite des offres disponibles aux offres utiles.</p>
        </div>
        <div className="landing-steps__grid">
          <div className="step-card">
            <span>1</span>
            <h3>Indique le poste que tu recherches</h3>
            <p>Ajoute ton poste cible, ta zone et tes préférences pour donner un cap clair à JobRadar.</p>
          </div>
          <div className="step-card">
            <span>2</span>
            <h3>JobRadar trie les offres selon ton profil</h3>
            <p>Tu évites de te perdre dans trop d’offres et tu vois d’abord celles qui semblent les plus utiles.</p>
          </div>
          <div className="step-card">
            <span>3</span>
            <h3>Sauvegarde les offres intéressantes</h3>
            <p>Garde les opportunités de côté ou active un pass pour débloquer plus d’offres.</p>
          </div>
        </div>
      </section>

      <section id="benefits" className="landing-section landing-benefits">
        <div className="landing-section__header">
          <h2>Pourquoi utiliser JobRadar ?</h2>
        </div>
        <div className="landing-benefits__grid">
          <div className="benefit-card">
            <h3>Tu gagnes du temps dans ta recherche</h3>
            <p>JobRadar rassemble des offres et t’aide à avancer sans multiplier les recherches dispersées.</p>
          </div>
          <div className="benefit-card">
            <h3>Tu vois d’abord les offres les plus adaptées</h3>
            <p>
              Les offres sont présentées pour t’aider à repérer plus vite celles qui correspondent à ton projet.
            </p>
          </div>
          <div className="benefit-card">
            <h3>Tu cherches en Afrique, en Europe et à distance</h3>
            <p>Explore des opportunités locales, internationales et à distance selon tes objectifs.</p>
          </div>
          <div className="benefit-card">
            <h3>Tu gardes les offres intéressantes de côté</h3>
            <p>Sauvegarde les offres utiles pour les retrouver facilement quand tu veux avancer.</p>
          </div>
        </div>
      </section>

      <section className="landing-cta-final">
        <div>
          <h2>JobRadar surveille. Toi, tu choisis où postuler.</h2>
          <p>
            Crée ton compte pour voir tes premières offres et comprendre plus vite quelles opportunités
            valent ton attention.
          </p>
          <span className="landing-cta-final__note">
            Tu peux commencer gratuitement, puis choisir un pass si tu veux débloquer plus d’opportunités.
          </span>
        </div>
        <button type="button" className="btn btnPrimary" onClick={goAuth}>
          Voir mes offres
        </button>
      </section>

      <section className="landing-footer">
        <div className="landing-footer__brand">JobRadar</div>
        <div className="landing-footer__links">
          <a href="/auth">Créer un compte</a>
          <a href="/contact">Contact</a>
        </div>
      </section>
    </div>
  );
}
