// src/HomePage.tsx
import { Link, useNavigate } from "react-router-dom";

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo">
            <div className="app-logo-circle">G</div>
            <span className="app-logo-text">Go4Job</span>
          </div>

          <div className="app-header-actions">
            <div className="app-lang">
              <button type="button">FR</button>
              <span className="app-lang-sep">|</span>
              <button type="button">EN</button>
            </div>

            {/* CTA Auth */}
            <Link className="btn btn-outline" to="/auth">
              Se connecter
            </Link>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <main className="app-main">
        {/* Texte d’accueil */}
        <section className="hero">
          <h1>Bienvenue sur Go4Job</h1>
          <p>
            L&apos;IA qui cherche les offres pour toi et t&apos;aide à y postuler.
            Choisis par où commencer&nbsp;: laisser <strong>JobRadar</strong> scanner le marché,
            ou te faire accompagner par <strong>JobCopilot</strong> pour optimiser ton CV et tes candidatures.
          </p>

          <div className="hero-cta">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/auth")}>
              Créer un compte / Se connecter
            </button>
          </div>
        </section>

        {/* Deux cartes : JobRadar / JobCopilot */}
        <section className="cards">
          <div className="card">
            <div>
              <div className="card-tag">🛰️ JobRadar</div>
              <h2>Laisse Go4Job scanner le web pour toi</h2>
              <p>
                L&apos;IA collecte des offres sur plusieurs sites, les analyse et te remonte
                celles qui matchent le mieux avec ton profil.
              </p>
              <ul>
                <li>Analyse de nombreuses sources d&apos;offres</li>
                <li>Matching intelligent avec ton profil</li>
                <li>Mises à jour régulières des nouvelles opportunités</li>
              </ul>
            </div>

            <button className="btn btn-primary" type="button" onClick={() => navigate("/auth")}>
              Activer JobRadar
            </button>
          </div>

          <div className="card">
            <div>
              <div className="card-tag card-tag-secondary">🤝 JobCopilot</div>
              <h2>Ton copilote IA pour candidater</h2>
              <p>
                Go4Job t&apos;aide à améliorer ton CV, adapter tes lettres et répondre
                aux formulaires de candidature plus rapidement.
              </p>
              <ul>
                <li>Analyse et suggestions pour ton CV</li>
                <li>Lettres personnalisées selon chaque offre</li>
                <li>Aide pour les questions des formulaires</li>
              </ul>
            </div>

            <button className="btn btn-dark" type="button" onClick={() => navigate("/auth")}>
              Lancer JobCopilot
            </button>
          </div>
        </section>

        {/* Comment ça marche ? */}
        <section className="steps">
          <h3>Comment ça marche ?</h3>

          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">1</div>
              <h4>Configure ton profil</h4>
              <p>Compétences, pays, niveau de salaire et types de postes.</p>
            </div>

            <div className="step-card">
              <div className="step-number">2</div>
              <h4>Laisse JobRadar travailler</h4>
              <p>L&apos;IA collecte et score les offres pour toi.</p>
            </div>

            <div className="step-card">
              <div className="step-number">3</div>
              <h4>Utilise JobCopilot pour candidater</h4>
              <p>Adaptation de ton CV &amp; LM + suivi de tes candidatures.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default HomePage;
