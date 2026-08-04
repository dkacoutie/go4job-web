// Logos d'entreprise — liste blanche courte, décidée le 04/08/2026.
//
// Principe (volontairement conservateur) : une liste blanche est sûre par
// construction. Un domaine absent de cette liste ne montre jamais le mauvais
// logo — il retombe simplement sur l'avatar par défaut (initiales / globe,
// voir companyAvatar.ts). On n'est jamais passés à une logique de liste
// noire (bloquer les agrégateurs connus) : de nouvelles sources d'ingestion
// apparaissent régulièrement, une liste noire incomplète afficherait le
// mauvais logo au lieu de ne rien afficher — pire que l'état actuel.
//
// Origine des données : audit SQL en lecture seule sur `jobs` (offres
// actives, apply_url/source_url), le 04/08/2026. Sur ~5 800 offres restant
// après exclusion des agrégateurs/ATS déjà identifiés (France Travail,
// Adzuna, Himalayas, Talentsoft, LinkedIn, Indeed, etc.), ces domaines sont
// les seuls confirmés comme appartenant à un employeur unique.
//
// Exclus délibérément (vérifiés un par un, à ne pas rajouter sans revérifier) :
// - projobivoire.com, ngojobsinafrica.com, novojob.com, eburka-ci.net,
//   fedafrica.com : sources d'ingestion panafricaines/multi-pays de
//   JobRadar lui-même (voir supabase/functions/ingest_source/sources/ et
//   CLAUDE.md), pas un employeur unique.
// - remotive.com, vuejobs.com, larajobs.com, authenticjobs.com,
//   realworkfromanywhere.com : job boards / agrégateurs remote.
// - ycombinator.com, news.ycombinator.com, ashbyhq.com : "Work at a
//   Startup" / ATS partagé par des centaines d'entreprises différentes.
// - lipbelgique.be : agence d'intérim (beaucoup d'employeurs finaux
//   différents derrière un seul nom).
// - educarriere.ci, passerelles.economie.gouv.fr : portails d'offres
//   multi-employeurs (pas une entreprise).
export const KNOWN_EMPLOYER_DOMAINS: readonly string[] = [
  "edf.fr",
  "spie-job.com",
  "cea.fr",
  "elis.com",
  "amundi.com",
  "maif.fr",
  "airfrance.com",
  "1001vieshabitat.fr",
  "sgp.fr",
  "cristal-union.fr",
  "sorbonne-universite.fr",
  "groupe-psa.com",
  "rentacar.fr",
  "macsf.fr",
  "gustaveroussy.fr",
  "creditdumaroc.ma",
  "yvelines.fr",
];

// Clé publique logo.dev (gratuite, à créer sur https://logo.dev). Tant que
// cette variable n'est pas définie (Netlify + .env local), getCompanyLogoUrl
// renvoie toujours null : comportement identique à aujourd'hui (avatar par
// défaut partout), aucune régression possible en l'absence de clé.
const LOGO_DEV_TOKEN = import.meta.env?.VITE_LOGO_DEV_TOKEN as string | undefined;

function extractHostname(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function findWhitelistedDomain(hostname: string): string | null {
  return (
    KNOWN_EMPLOYER_DOMAINS.find((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ?? null
  );
}

// Retourne l'URL du logo si (et seulement si) le domaine de l'offre est dans
// la liste blanche ci-dessus, sinon null (→ avatar initiales par défaut).
export function getCompanyLogoUrl(applyUrl?: string | null, sourceUrl?: string | null): string | null {
  if (!LOGO_DEV_TOKEN) return null;
  const hostname = extractHostname(applyUrl) ?? extractHostname(sourceUrl);
  if (!hostname) return null;
  const domain = findWhitelistedDomain(hostname);
  if (!domain) return null;
  return `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=64&format=png`;
}
