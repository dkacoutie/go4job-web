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

          <h1>Les bonnes offres passent vite. JobRadar les repère pour toi.</h1>

          <p>
            JobRadar surveille les offres d’emploi, les trie selon ton profil et met en avant
            celles qui méritent ton attention — sans que tu aies à chercher partout chaque jour.
          </p>

          <div className="landing-hero__cta">
            <button type="button" className="btn btnPrimary" onClick={goAuth}>
              Voir les offres pour moi
            </button>
            <button type="button" className="btn btnGhost" onClick={goPricing}>
              Découvrir les pass
            </button>
          </div>

          <div className="landing-micro">
            Tu peux découvrir JobRadar gratuitement. Un pass permet ensuite de débloquer plus
            d’opportunités et d’avancer plus loin dans ta recherche.
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
        <div className="landing-proofbar__item">Afrique, Europe et offres à distance</div>
        <div className="landing-proofbar__item">Offres utiles sauvegardées au même endroit</div>
      </section>

      <section className="landing-section landing-steps" aria-label="Comment ça marche">
        <div className="landing-section__header">
          <h2>Comment ça marche ?</h2>
          <p>Un parcours simple pour passer plus vite des offres disponibles aux offres utiles.</p>
        </div>

        <div className="landing-steps__grid">
          <div className="step-card">
            <span>1</span>
            <h3>Indique ce que tu recherches</h3>
            <p>
              Ajoute ton poste cible, ta zone, ton niveau d’expérience et tes préférences pour
              donner un cap clair à JobRadar.
            </p>
          </div>

          <div className="step-card">
            <span>2</span>
            <h3>JobRadar trie les offres pour toi</h3>
            <p>
              Tu évites de te perdre dans des recherches dispersées et tu vois d’abord les offres
              les plus cohérentes avec ton projet.
            </p>
          </div>

          <div className="step-card">
            <span>3</span>
            <h3>Tu choisis où postuler</h3>
            <p>
              Sauvegarde les opportunités intéressantes, reviens-y facilement et débloque plus
              d’offres quand tu veux aller plus loin.
            </p>
          </div>
        </div>
      </section>

      <section id="benefits" className="landing-section landing-benefits">
        <div className="landing-section__header">
          <h2>Pourquoi utiliser JobRadar ?</h2>
        </div>

        <div className="landing-benefits__grid">
          <div className="benefit-card">
            <h3>Tu gagnes du temps</h3>
            <p>
              JobRadar centralise des offres et t’aide à avancer sans passer tes journées à vérifier
              plusieurs sites.
            </p>
          </div>

          <div className="benefit-card">
            <h3>Tu repères mieux les bonnes opportunités</h3>
            <p>
              Les offres sont présentées pour t’aider à identifier plus vite celles qui correspondent
              à ton profil et à tes objectifs.
            </p>
          </div>

          <div className="benefit-card">
            <h3>Tu explores plus largement</h3>
            <p>
              Découvre des opportunités en Afrique, en Europe et à distance selon ton projet
              professionnel.
            </p>
          </div>

          <div className="benefit-card">
            <h3>Tu gardes le contrôle</h3>
            <p>
              JobRadar t’aide à organiser ta recherche, mais c’est toujours toi qui choisis les
              offres à ouvrir, sauvegarder ou suivre.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-cta-final">
        <div>
          <h2>Arrête de chercher partout. Laisse JobRadar surveiller pour toi.</h2>
          <p>
            Crée ton compte pour voir tes premières offres et comprendre plus vite quelles
            opportunités valent ton attention.
          </p>
          <span className="landing-cta-final__note">
            Tu peux commencer gratuitement, puis choisir un pass si tu veux débloquer plus
            d’opportunités.
          </span>
        </div>

        <button type="button" className="btn btnPrimary" onClick={goAuth}>
          Voir les offres pour moi
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