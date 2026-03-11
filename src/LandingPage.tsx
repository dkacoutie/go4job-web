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
            <a className="btn btnGhost" href="#product">
              Découvrir JobRadar
            </a>
          </div>

          <div className="landing-micro">
            Simple, rapide et pensé pour les talents d’Afrique francophone.
          </div>
        </div>

        <div className="landing-hero__mockup" aria-label="Apercu JobRadar">
          <div className="mockup-card mockup-card--primary">
            <div className="mockup-card__title">JobRadar Feed</div>
            <div className="mockup-card__row">
              <span className="mockup-tag">Abidjan</span>
              <span className="mockup-pill">Marketing</span>
              <span className="mockup-pill">CDI</span>
            </div>
            <div className="mockup-card__job">
              <div>
                <strong>Charge(e) de communication</strong>
                <span>NGO / ONG</span>
              </div>
              <button type="button">Voir</button>
            </div>
            <div className="mockup-card__job">
              <div>
                <strong>Analyste data junior</strong>
                <span>Banque / Fintech</span>
              </div>
              <button type="button">Voir</button>
            </div>
          </div>

          <div className="mockup-card mockup-card--secondary">
            <div className="mockup-card__title">Suivi intelligent</div>
            <div className="mockup-card__metric">
              <strong>Opportunites recentes</strong>
              <span>+120 cette semaine</span>
            </div>
            <div className="mockup-card__metric">
              <strong>Alertes actives</strong>
              <span>Personnalisees</span>
            </div>
          </div>
        </div>
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
            <span className="benefit-icon" aria-hidden="true" />
            <h3>Gagne du temps</h3>
            <p>Ne multiplie plus les recherches dispersées sur plusieurs sites et groupes.</p>
          </div>
          <div className="benefit-card">
            <span className="benefit-icon" aria-hidden="true" />
            <h3>Repère plus vite les bonnes opportunités</h3>
            <p>
              Accède à un grand volume d’offres et filtre plus facilement ce qui te correspond.
            </p>
          </div>
          <div className="benefit-card">
            <span className="benefit-icon" aria-hidden="true" />
            <h3>Reste organisé</h3>
            <p>Suis tes opportunités et structure ta recherche avec plus de clarté.</p>
          </div>
          <div className="benefit-card">
            <span className="benefit-icon" aria-hidden="true" />
            <h3>Avance avec plus de méthode</h3>
            <p>
              Une interface simple pour t’aider à chercher efficacement sans te perdre dans le
              bruit.
            </p>
          </div>
        </div>
      </section>

      <section id="product" className="landing-section landing-product">
        <div className="landing-product__content">
          <h2>Une plateforme simple pour trouver plus vite les bonnes opportunités</h2>
          <p>
            JobRadar réunit déjà 11 000+ offres d’emploi pour aider les chercheurs d’emploi à
            gagner du temps, mieux s’organiser et avancer plus efficacement.
          </p>
          <div className="landing-product__points">
            <div>
              <strong>Recherche</strong>
              <span>Des offres actives, regroupées.</span>
            </div>
            <div>
              <strong>Alertes</strong>
              <span>Repère plus vite ce qui compte.</span>
            </div>
            <div>
              <strong>Suivi</strong>
              <span>Organise tes opportunités.</span>
            </div>
          </div>
        </div>
        <div className="landing-product__visual" aria-label="Mockup JobRadar">
          <div className="product-panel">
            <div className="product-panel__header">
              <span>JobRadar</span>
              <span className="product-panel__badge">11 000+ offres</span>
            </div>
            <div className="product-panel__rows">
              <div>
                <strong>Marketing & Communication</strong>
                <span>Opportunités récentes</span>
              </div>
              <div>
                <strong>Tech & Digital</strong>
                <span>Rôles juniors à confirmer</span>
              </div>
              <div>
                <strong>ONG & Impact</strong>
                <span>Offres Afrique de l’Ouest</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-reassurance">
        <div className="landing-section__header">
          <h2>Pensé pour l’Afrique francophone</h2>
        </div>
        <div className="landing-reassurance__grid">
          <div className="reassurance-card">
            <strong>Opportunités actives</strong>
            <span>Une base d’offres déjà active et en croissance continue.</span>
          </div>
          <div className="reassurance-card">
            <strong>Expérience claire</strong>
            <span>Une interface simple pour chercher sans complexité inutile.</span>
          </div>
          <div className="reassurance-card">
            <strong>Recherche plus structurée</strong>
            <span>Une meilleure façon de suivre tes opportunités et d’avancer avec méthode.</span>
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

      <section className="landing-section landing-faq">
        <div className="landing-section__header">
          <h2>Mini FAQ</h2>
        </div>
        <div className="landing-faq__grid">
          <div className="landing-faq__item">
            <h3>À qui s’adresse JobRadar ?</h3>
            <p>
              À toute personne qui veut chercher un emploi plus efficacement, notamment les jeunes
              diplômés, chercheurs d’emploi et jeunes professionnels.
            </p>
          </div>
          <div className="landing-faq__item">
            <h3>Que puis-je trouver sur JobRadar ?</h3>
            <p>
              Des offres d’emploi actives regroupées pour t’aider à repérer plus vite les
              opportunités pertinentes.
            </p>
          </div>
          <div className="landing-faq__item">
            <h3>Pourquoi utiliser JobRadar ?</h3>
            <p>
              Pour gagner du temps, mieux organiser ta recherche et éviter de chercher partout sans
              méthode.
            </p>
          </div>
        </div>
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
