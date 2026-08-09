import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPublicJobsCount } from "./lib/publicJobsPreview";
import { usePageMeta } from "./lib/usePageMeta";
import "./LandingPage.css";

export default function LandingPage() {
  const navigate = useNavigate();
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  usePageMeta({
    title: "Trouvez votre prochain emploi en Afrique, en Europe et a distance",
    description:
      "JobRadar surveille les offres d'emploi en Afrique, en Europe, aux Etats-Unis et a distance, et les trie selon votre profil. Recherche gratuite, alertes ciblees.",
    path: "/landing",
  });

  useEffect(() => {
    let cancelled = false;
    // Compteur public : jobs n'accorde aucun droit SELECT à anon (voir
    // supabase/migrations/20260724060000_jobradar_public_offers_preview_rpc.sql),
    // donc une requête directe sur la table échoue silencieusement pour un
    // visiteur non connecté. On passe par la RPC dédiée, sûre pour anon.
    fetchPublicJobsCount().then((count) => {
      if (!cancelled && count !== null) setJobCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const roundedJobCount = jobCount !== null ? Math.floor(jobCount / 1000) * 1000 : null;
  const badgeText =
    roundedJobCount !== null
      ? `Plus de ${roundedJobCount.toLocaleString("fr-FR")} offres disponibles`
      : "Des milliers d’offres disponibles";
  const proofbarText =
    roundedJobCount !== null
      ? `Plus de ${roundedJobCount.toLocaleString("fr-FR")} offres mises à jour régulièrement`
      : "Des milliers d’offres mises à jour régulièrement";

  const goAuth = (query?: string) => {
    const trimmed = query?.trim();
    const from = trimmed ? `/jobradar/feed?q=${encodeURIComponent(trimmed)}` : "/jobradar/feed";
    navigate("/auth", { state: { from } });
  };

  const goPricing = () => {
    navigate("/pricing");
  };

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    goAuth(searchQuery);
  };

  return (
    <div className="landing-shell">
      <section className="landing-hero">
        <div className="landing-hero__content">
          <div className="landing-badge">{badgeText}</div>

          <h1>JobRadar trouve les bonnes offres pour toi.</h1>

          <p>
            Surveille les offres d’emploi en Afrique, en Europe, aux États-Unis et à distance,
            triées selon ton profil.
          </p>

          <form className="landing-search" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              className="landing-search__input"
              placeholder="Poste, mot-clé, ville…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Rechercher une offre"
            />
            <button type="submit" className="btn btnPrimary landing-search__submit">
              Voir les offres pour moi
            </button>
          </form>

          <div className="landing-hero__secondary">
            <button type="button" className="landing-link" onClick={goPricing}>
              Découvrir les pass
            </button>
          </div>

          <div className="landing-micro">
            Tu peux découvrir JobRadar gratuitement. Un pass permet ensuite de débloquer plus
            d’opportunités et d’avancer plus loin dans ta recherche.
          </div>
        </div>
      </section>

      <section className="landing-proofbar" aria-label="Preuves">
        <div className="landing-proofbar__item">{proofbarText}</div>
        <div className="landing-proofbar__item">Afrique, Europe, États-Unis et offres à distance</div>
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

        <button type="button" className="btn btnPrimary" onClick={() => goAuth()}>
          Voir les offres pour moi
        </button>
      </section>
    </div>
  );
}
