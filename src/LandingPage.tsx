import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

export default function LandingPage() {
  const navigate = useNavigate();

  const goAuth = () => {
    navigate("/auth", { state: { from: "/jobradar/feed" } });
  };

  return (
    <div className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero__content">
          <div className="landing-badge">11 000+ offres d’emploi</div>
          <h1>Ne perds plus des heures à chercher un job</h1>
          <p>
            Accède à 11 000+ offres d’emploi sur JobRadar et repère plus vite les opportunités qui
            te correspondent.
          </p>

          <div className="landing-hero__cta">
            <button type="button" className="btn btnPrimary" onClick={goAuth}>
              Commencer
            </button>
            <a className="btn btnGhost" href="#benefits">
              Découvrir JobRadar
            </a>
          </div>

          <div className="landing-micro">
            Simple, rapide et pensé pour les talents d’Afrique francophone.
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
        <div className="landing-proofbar__item">11 000+ offres d’emploi</div>
        <div className="landing-proofbar__item">Recherche plus simple</div>
        <div className="landing-proofbar__item">Suivi plus clair</div>
      </section>

      <section id="benefits" className="landing-section landing-benefits">
        <div className="landing-section__header">
          <h2>Pourquoi utiliser JobRadar ?</h2>
        </div>
        <div className="landing-benefits__grid">
          <div className="benefit-card">
            <h3>Gagne du temps</h3>
            <p>Ne multiplie plus les recherches dispersées sur plusieurs sites et groupes.</p>
          </div>
          <div className="benefit-card">
            <h3>Repère plus vite les bonnes opportunités</h3>
            <p>
              Accède à un grand volume d’offres et filtre plus facilement ce qui te correspond.
            </p>
          </div>
          <div className="benefit-card">
            <h3>Reste organisé</h3>
            <p>Suis tes opportunités et structure ta recherche avec plus de clarté.</p>
          </div>
        </div>
      </section>

      <section className="landing-cta-final">
        <div>
          <h2>Prêt à découvrir JobRadar ?</h2>
          <p>
            Accède à une plateforme pensée pour t’aider à chercher plus vite, plus clairement et
            avec de meilleures opportunités sous les yeux.
          </p>
          <span className="landing-cta-final__note">
            Découvre JobRadar et commence ta recherche plus sereinement.
          </span>
        </div>
        <button type="button" className="btn btnPrimary" onClick={goAuth}>
          Créer mon compte
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
