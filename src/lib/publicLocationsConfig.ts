// JR-0135 : configuration des pages publiques pays/ville (SEO local).
// Périmètre limité aux marchés où JR-0134 a confirmé un volume réel suffisant
// (Côte d'Ivoire + France) — Sénégal, Cameroun, Belgique, Suisse volontairement
// exclus pour l'instant (tagging pays/ville trop faible ou stock trop mince).

export type PublicLocationConfig = {
  slug: string;
  /** Libellés exacts de jobs.country à filtrer (le champ n'est pas normalisé). */
  countries: string[];
  /** Motif ILIKE sur jobs.location, ou null pour une page pays (pas de filtre ville). */
  locationPattern: string | null;
  h1: string;
  /** Description utilisée avant que le compte réel d'offres soit connu (fallback). */
  introFallback: string;
  metaTitle: string;
  breadcrumbLabel: string;
};

export const PUBLIC_LOCATIONS: PublicLocationConfig[] = [
  {
    slug: "cote-divoire",
    // JR-SEO-audit-20260812 : jobs.country contient au moins 3 variantes distinctes
    // pour la Côte d'Ivoire ("CI" x1397, "Cote d'Ivoire" sans accent x354, "Côte
    // d'Ivoire" avec accent x5 — vérifié par requête SQL le 12/08/2026). Le filtre
    // exact (j.country = any(p_countries)) dans jobradar_public_jobs_by_location
    // ignorait la variante sans accent : ~20% des offres actives de Côte d'Ivoire
    // étaient invisibles sur cette page et sur /offres/abidjan, /offres/bouake,
    // /offres/yamoussoukro (mêmes countries).
    countries: ["CI", "Côte d'Ivoire", "Cote d'Ivoire"],
    locationPattern: null,
    h1: "Offres d'emploi en Côte d'Ivoire",
    introFallback:
      "Un aperçu des offres suivies par JobRadar en Côte d'Ivoire, à Abidjan et dans les autres villes du pays.",
    metaTitle: "Offres d'emploi en Côte d'Ivoire",
    breadcrumbLabel: "Côte d'Ivoire",
  },
  {
    slug: "abidjan",
    countries: ["CI", "Côte d'Ivoire", "Cote d'Ivoire"],
    locationPattern: "%abidjan%",
    h1: "Offres d'emploi à Abidjan",
    introFallback: "Un aperçu des offres suivies par JobRadar à Abidjan, tous quartiers confondus.",
    metaTitle: "Offres d'emploi à Abidjan",
    breadcrumbLabel: "Abidjan",
  },
  {
    slug: "bouake",
    countries: ["CI", "Côte d'Ivoire", "Cote d'Ivoire"],
    locationPattern: "%bouak%",
    h1: "Offres d'emploi à Bouaké",
    introFallback: "Un aperçu des offres suivies par JobRadar à Bouaké.",
    metaTitle: "Offres d'emploi à Bouaké",
    breadcrumbLabel: "Bouaké",
  },
  {
    slug: "yamoussoukro",
    countries: ["CI", "Côte d'Ivoire", "Cote d'Ivoire"],
    locationPattern: "%yamoussoukro%",
    h1: "Offres d'emploi à Yamoussoukro",
    introFallback: "Un aperçu des offres suivies par JobRadar à Yamoussoukro.",
    metaTitle: "Offres d'emploi à Yamoussoukro",
    breadcrumbLabel: "Yamoussoukro",
  },
  {
    slug: "france",
    countries: ["France"],
    locationPattern: null,
    h1: "Offres d'emploi en France",
    introFallback: "Un aperçu des offres suivies par JobRadar en France, à Paris, Lyon, Toulouse et ailleurs.",
    metaTitle: "Offres d'emploi en France",
    breadcrumbLabel: "France",
  },
  {
    slug: "paris",
    countries: ["France"],
    locationPattern: "%paris%",
    h1: "Offres d'emploi à Paris",
    introFallback: "Un aperçu des offres suivies par JobRadar à Paris et en Île-de-France.",
    metaTitle: "Offres d'emploi à Paris",
    breadcrumbLabel: "Paris",
  },
  {
    slug: "lyon",
    countries: ["France"],
    locationPattern: "%lyon%",
    h1: "Offres d'emploi à Lyon",
    introFallback: "Un aperçu des offres suivies par JobRadar à Lyon et dans la région Auvergne-Rhône-Alpes.",
    metaTitle: "Offres d'emploi à Lyon",
    breadcrumbLabel: "Lyon",
  },
  {
    slug: "toulouse",
    countries: ["France"],
    locationPattern: "%toulouse%",
    h1: "Offres d'emploi à Toulouse",
    introFallback: "Un aperçu des offres suivies par JobRadar à Toulouse et en Haute-Garonne.",
    metaTitle: "Offres d'emploi à Toulouse",
    breadcrumbLabel: "Toulouse",
  },
];

export function getPublicLocationConfig(slug: string): PublicLocationConfig | undefined {
  return PUBLIC_LOCATIONS.find((l) => l.slug === slug);
}
