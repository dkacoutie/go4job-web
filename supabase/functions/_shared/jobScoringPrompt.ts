import type { CandidateJob, MatchingProfile } from "./jobradar_match_core.ts";

// JR-0075 : prompt de scoring explicable (candidat x offre) pour Claude.
//
// Décision d'architecture (JR-0074) : ce module écrit dans `job_matches`
// (score, fit_summary, strengths, gaps, raw_model_output) à partir de
// `jobradar_matching_profiles` (candidat) et `jobs` (offre) — aucune nouvelle
// table. Les types `MatchingProfile`/`CandidateJob` sont réutilisés tels
// quels depuis `jobradar_match_core.ts` (moteur de matching déterministe
// déjà en production derrière `jobradar_match_feed`) pour rester cohérent
// avec le pipeline existant plutôt que de redéfinir un schéma parallèle.
//
// Portée de ce fichier : construire le prompt et définir le schéma de sortie
// attendu. L'appel réel à l'API Claude, le cache (JR-0076), le branchement
// sur le digest (JR-0077) et le plafond de coût (JR-0078) sont des tickets
// séparés et volontairement pas traités ici — voir JOBRADAR_BACKLOG.md.
//
// Calibrage : le barème par palier de 20 (0/20/40/60/80/100) reprend le
// format du seul lot de données existant dans `job_matches` (30 lignes,
// test manuel du 15/11/2025, aucun pipeline actif ne l'alimente aujourd'hui)
// pour rester comparable aux données déjà en base plutôt que d'introduire
// une échelle différente sans raison.

export const JOB_SCORING_SYSTEM_PROMPT = `Tu es l'assistant de matching de JobRadar. Ton rôle : évaluer honnêtement l'adéquation entre le profil d'un candidat et une offre d'emploi, pour l'aider à prioriser sa recherche — pas pour le rassurer.

Règles :
1. Base-toi uniquement sur les informations fournies. Ne suppose jamais une compétence, une expérience ou une préférence qui n'est pas explicitement donnée.
2. Si les données du candidat sont pauvres ou vides (ex. compétences non renseignées), dis-le explicitement dans fit_summary et note en conséquence — l'absence d'information n'est ni un point fort ni un point faible, c'est une limite de l'évaluation.
3. Sois spécifique : cite les compétences, technologies ou exigences concrètes de l'offre, pas des généralités ("bon profil", "expérience pertinente").
4. Le score suit un barème à 5 paliers, pas une échelle continue : 0 (aucun rapport), 20 (rapport très faible), 40 (partiel, lacunes importantes), 60 (bon socle, quelques lacunes), 80 (très bon fit), 100 (correspondance quasi parfaite). N'utilise pas de valeurs intermédiaires (ex. 55, 73).
5. Réponds uniquement en JSON valide, sans texte avant ou après, au format exact :
{
  "score": <0|20|40|60|80|100>,
  "fit_summary": "<2 à 4 phrases en français, factuelles>",
  "strengths": ["<point fort concret>", ...],
  "gaps": ["<lacune concrète>", ...]
}
strengths et gaps contiennent entre 1 et 4 éléments chacun. Si le candidat n'a aucun point fort identifiable pour cette offre, strengths peut être un tableau vide — ne force pas un point positif artificiel.`;

function formatList(items: string[] | null | undefined, empty = "non renseigné"): string {
  if (!items || items.length === 0) return empty;
  return items.join(", ");
}

function formatExperience(profile: MatchingProfile): string {
  const years = profile.experience_years_effective;
  const level = profile.experience_level;
  if (years == null && !level) return "non renseignée";
  const parts: string[] = [];
  if (years != null) parts.push(`${years} an(s)`);
  if (level) parts.push(`niveau ${level}`);
  return parts.join(", ");
}

function formatSalary(job: CandidateJob & { salary_min?: number | null; salary_max?: number | null; salary_currency?: string | null }): string {
  if (job.salary_min == null && job.salary_max == null) return "non précisé";
  const currency = job.salary_currency ?? "";
  if (job.salary_min != null && job.salary_max != null) return `${job.salary_min}-${job.salary_max} ${currency}`.trim();
  return `${job.salary_min ?? job.salary_max} ${currency}`.trim();
}

/**
 * Construit le message utilisateur envoyé à Claude pour un couple (candidat, offre).
 * Le texte de l'offre est tronqué à 2000 caractères : suffisant pour capturer les
 * exigences (les descriptions les plus longues répètent souvent la même information
 * en fin de texte — mentions légales, boilerplate société), et ça borne le coût par appel.
 */
export function buildJobScoringUserPrompt(profile: MatchingProfile, job: CandidateJob): string {
  const description = (job.official_desc || job.description_text || "").trim().slice(0, 2000);

  return `## Profil du candidat
- Poste recherché : ${profile.desired_role ?? profile.desired_role_fallback ?? "non renseigné"}
- Compétences (CV) : ${formatList(profile.cv_skills)}
- Compétences (déclarées) : ${formatList(profile.profile_skills)}
- Expérience : ${formatExperience(profile)}
- Mots-clés d'alerte suivis : ${formatList(profile.alert_keywords_norm)}
- Types de contrat souhaités : ${formatList(profile.employment_types)}
- Mode de travail souhaité : ${formatList(profile.work_modes_onboarding)}
- Secteurs d'intérêt : ${formatList(profile.sectors_onboarding)}
- Pays souhaités : ${formatList(profile.country_codes_onboarding)}

## Offre d'emploi
- Titre : ${job.title ?? "non précisé"}
- Entreprise : ${job.company_name ?? "non précisée"}
- Lieu : ${job.location ?? "non précisé"} (${job.country ?? "pays non précisé"})
- Mode de travail : ${job.remote_type ?? "non précisé"}
- Type de contrat : ${job.contract_type ?? "non précisé"}
- Séniorité : ${job.seniority ?? "non précisée"}
- Compétences requises (si extraites) : ${formatList(job.required_skills)}
- Compétences optionnelles (si extraites) : ${formatList(job.optional_skills)}
- Famille de poste (si extraite) : ${job.job_family ?? "non précisée"}
- Description :
${description || "(description non disponible)"}

Évalue l'adéquation de ce candidat pour cette offre selon les règles données.`;
}

export type JobScoringResult = {
  score: 0 | 20 | 40 | 60 | 80 | 100;
  fit_summary: string;
  strengths: string[];
  gaps: string[];
};

const VALID_SCORES = new Set([0, 20, 40, 60, 80, 100]);

/**
 * Valide et normalise la réponse JSON de Claude. Lève une erreur explicite plutôt
 * que d'écrire une ligne à moitié correcte dans job_matches — un score
 * invalide ou un JSON mal formé doit être visible (log/alerte) et retenté,
 * pas silencieusement encaissé.
 */
export function parseJobScoringResult(raw: string): JobScoringResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`JR-0075: réponse non-JSON du modèle: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("JR-0075: réponse JSON qui n'est pas un objet");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.score !== "number" || !VALID_SCORES.has(obj.score)) {
    throw new Error(`JR-0075: score invalide (attendu 0/20/40/60/80/100): ${JSON.stringify(obj.score)}`);
  }
  if (typeof obj.fit_summary !== "string" || obj.fit_summary.trim().length === 0) {
    throw new Error("JR-0075: fit_summary manquant ou vide");
  }
  if (!Array.isArray(obj.strengths) || !obj.strengths.every((s) => typeof s === "string")) {
    throw new Error("JR-0075: strengths doit être un tableau de chaînes");
  }
  if (!Array.isArray(obj.gaps) || !obj.gaps.every((s) => typeof s === "string")) {
    throw new Error("JR-0075: gaps doit être un tableau de chaînes");
  }

  return {
    score: obj.score as JobScoringResult["score"],
    fit_summary: obj.fit_summary,
    strengths: obj.strengths as string[],
    gaps: obj.gaps as string[],
  };
}
