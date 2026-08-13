import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicJobsCount } from "./lib/publicJobsPreview";
import { usePageMeta } from "./lib/usePageMeta";
import "./App.css";
import "./AboutPage.css";

// JR-SEO-audit-20260812, complement du 13/08/2026 (nuit) : trou E-E-A-T
// identifie en verifiant go4jobapp.com -- ni ce domaine ni jobradar.go4jobapp.com
// n'avaient de page "qui sommes-nous" ou d'info credible sur l'entreprise
// derriere le produit. Contenu base UNIQUEMENT sur des faits deja publics et
// verifiables ailleurs sur ce depot (LegalPage.tsx, mentions legales) --
// aucune information inventee : societe, immatriculation, ville, contact.
export default function AboutPage() {
  const [activeCount, setActiveCount] = useState<number | null>(null);

  usePageMeta({
    title: "Qui sommes-nous",
    description:
      "JobRadar est un produit Go4Job, opere par GLOBAL DREAMS & CO depuis Abidjan, Cote d'Ivoire. Decouvrez qui est derriere JobRadar et CapCarriere.",
    path: "/qui-sommes-nous",
  });

  useEffect(() => {
    let cancelled = false;
    fetchPublicJobsCount().then((count) => {
      if (!cancelled) setActiveCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const roundedCount = activeCount !== null ? Math.floor(activeCount / 1000) * 1000 : null;

  return (
    <div className="app-narrow aboutPage">
      <h1>Qui sommes-nous</h1>

      <p className="aboutPage__lead">
        JobRadar est un produit Go4Job : une veille automatisée sur les offres d'emploi, pensée pour
        que tu n'aies pas à chercher chaque jour sur des dizaines de sites différents.
        {roundedCount !== null && (
          <> Plus de {roundedCount.toLocaleString("fr-FR")} offres actives suivies en continu, à travers de
            nombreuses sources — de la Côte d'Ivoire à la France, en passant par le Royaume-Uni, les
            États-Unis et de nombreux autres pays.</>
        )}
      </p>

      <h2>Ce qu'on fait</h2>
      <p>
        JobRadar scanne en continu des dizaines de sources d'offres d'emploi (sites d'emploi
        généralistes, plateformes spécialisées, sites d'entreprises, agences pour l'emploi) et
        rassemble tout au même endroit, avec des alertes personnalisées dès qu'une offre correspond à
        ton profil. Pas besoin de retourner vérifier chaque site manuellement.
      </p>
      <p>
        <strong>CapCarrière</strong>, notre second produit, prend le relais une fois l'offre trouvée :
        aide à la rédaction de CV et de lettres de motivation, préparation aux entretiens, pour
        transformer une opportunité repérée en candidature solide.
      </p>

      <h2>Qui est derrière</h2>
      <p>
        JobRadar et CapCarrière sont opérés par <strong>GLOBAL DREAMS & CO</strong>, SARL immatriculée
        en Côte d'Ivoire (RCCM CI-ABJ-2018-B-04830), basée à Abidjan. Le projet est fondé et piloté par
        Dieudonné Kacoutié Affaly.
      </p>
      <p>
        On est une équipe réduite, ce qui veut dire des décisions rapides et un produit qui évolue vite
        — mais aussi que si quelque chose ne va pas, on préfère le savoir directement plutôt que de te
        laisser bloqué. Voir la section contact ci-dessous.
      </p>

      <h2>Où on opère</h2>
      <p>
        Basés à Abidjan, en Côte d'Ivoire, avec un catalogue d'offres qui couvre aujourd'hui
        principalement la France, le Royaume-Uni, les États-Unis et la Côte d'Ivoire, en plus d'une
        trentaine d'autres pays. L'Afrique francophone reste notre priorité de développement.
      </p>

      <h2>Nous contacter</h2>
      <p>
        Une question, un bug, une suggestion ? <Link to="/contact">Écris-nous</Link> — on répond sous
        24h ouvrées, souvent plus vite par WhatsApp. Toutes les informations légales de la société sont
        disponibles sur la page <Link to="/legal">Mentions légales</Link>.
      </p>
    </div>
  );
}
