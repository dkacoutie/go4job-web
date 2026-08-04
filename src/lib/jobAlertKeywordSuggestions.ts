export const MAX_KEYWORD_SUGGESTIONS = 6;
export const MAX_STORED_ALERT_KEYWORDS = 6;

/**
 * Une entrée telle qu'écrite à la main : uniquement des données, jamais de
 * regex. `triggers` liste les mots ou expressions qui doivent déclencher
 * cette famille de suggestions, chacun écrit UNE SEULE FOIS, dans son
 * orthographe naturelle (avec accent si le mot en a un).
 *
 * Ne plus jamais dupliquer une forme accentuée et sa forme sans accent ici
 * ("électricien" ET "electricien", "santé" ET "sante"...). C'était le
 * fonctionnement avant le 2026-08-01 et c'est la source exacte du bug corrigé
 * ce jour-là : dès qu'une personne oubliait la forme sans accent, le mot
 * accenté devenait injoignable pour un titre tapé normalement (voir
 * `buildTriggerPattern` ci-dessous pour le pourquoi technique). Depuis ce
 * correctif, la normalisation (accents retirés, casse ignorée) est appliquée
 * automatiquement à la compilation du dictionnaire ET à la saisie de
 * l'utilisateur — écrire un mot une seule fois suffit et suffira toujours,
 * quel que soit le nombre de métiers ajoutés ensuite.
 */
type JobSuggestionEntryData = {
  id: string;
  triggers: string[];
  keywords: string[];
  excludedKeywords?: string[];
  source: "hand_curated";
};

export type JobSuggestionEntry = JobSuggestionEntryData & { pattern: RegExp };

const WEAK_SUGGESTION_TERMS = new Set([
  "chef",
  "responsable",
  "manager",
  "directeur",
  "directrice",
  "coordinateur",
  "coordinatrice",
  "superviseur",
  "assistant",
  "assistante",
  "charge",
  "chargee",
  "agent",
  "technicien",
  "technicienne",
  "conseiller",
  "conseillere",
  "projet",
  "equipe",
  "service",
  "poste",
  "profil",
  "candidat",
  "candidate",
  "gestion",
  "suivi",
  "support",
  "pilotage",
  "conducteur",
  "conductrice",
]);

const SHORT_ALLOWED_TERMS = new Set([
  "ai",
  "api",
  "bi",
  "btp",
  "crm",
  "erp",
  "ia",
  "ios",
  "ml",
  "m&e",
  "nlp",
  "ong",
  "pmo",
  "rh",
  "sap",
  "sea",
  "seo",
  "soc",
  "sql",
  "ui",
  "vue",
  "aws",
]);

const GENERIC_ALERT_TERMS = new Set(["job", "emploi", "offre", "opportunity", "recrutement"]);

const STOP_WORDS = new Set([
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "un",
  "une",
  "et",
  "en",
  "a",
  "à",
  "au",
  "aux",
  "pour",
  "avec",
  "sans",
  "sur",
  "dans",
  "chez",
  "ou",
  "cdi",
  "cdd",
  "stage",
  "alternance",
  "junior",
  "senior",
  "confirme",
  "confirmé",
  "freelance",
  "remote",
  "hybride",
  "temps",
  "plein",
  "partiel",
  "of",
  "the",
  "an",
  "and",
  "or",
  "for",
  "with",
  "without",
  "in",
  "on",
  "at",
  "to",
  "from",
  "full",
  "time",
  "part",
  "intern",
  "internship",
  "contract",
  "permanent",
  "abidjan",
  "san",
  "pedro",
  "dakar",
  "bamako",
  "ouagadougou",
  "cote",
  "ivoire",
  "ivory",
  "coast",
  "senegal",
  "mali",
  "ghana",
  "benin",
  "togo",
  "niger",
]);

const JOB_SUGGESTION_ENTRIES_DATA: JobSuggestionEntryData[] = [
  {
    id: "data-bi",
    triggers: ["data", "analyst", "analyse", "analytics", "bi", "power bi", "tableau", "sql", "reporting", "dashboard", "etl", "dataviz", "visualisation"],
    keywords: ["data analyst", "analyste data", "business intelligence", "power bi", "sql", "reporting"],
    source: "hand_curated",
  },
  {
    id: "data-science-ml",
    triggers: ["data scientist", "machine learning", "ml", "ai", "ia", "deep learning", "nlp", "model"],
    keywords: ["data scientist", "machine learning", "python", "pandas", "scikit-learn", "nlp"],
    source: "hand_curated",
  },
  {
    id: "frontend",
    triggers: ["frontend", "front-end", "front end", "react", "vue", "angular", "next.js", "nextjs", "ui", "web designer", "intégrateur", "integration"],
    keywords: ["frontend", "react", "vue", "angular", "typescript", "javascript"],
    source: "hand_curated",
  },
  {
    id: "backend",
    triggers: ["backend", "back-end", "back end", "api", "node", "express", "django", "flask", "laravel", "spring", "java", "php", "c#", "dotnet", ".net"],
    keywords: ["backend", "api", "node", "django", "laravel", "postgres"],
    source: "hand_curated",
  },
  {
    id: "fullstack",
    triggers: ["fullstack", "full-stack", "full stack"],
    keywords: ["fullstack", "react", "node", "typescript", "api", "postgres"],
    source: "hand_curated",
  },
  {
    id: "mobile",
    triggers: ["mobile", "android", "ios", "react native", "flutter", "kotlin", "swift"],
    keywords: ["mobile", "android", "ios", "react native", "flutter", "firebase"],
    source: "hand_curated",
  },
  {
    id: "devops-cloud",
    triggers: ["devops", "cloud", "aws", "azure", "gcp", "docker", "kubernetes", "k8s", "ci/cd", "terraform"],
    keywords: ["devops", "cloud", "aws", "azure", "docker", "kubernetes"],
    source: "hand_curated",
  },
  {
    id: "security",
    triggers: ["security", "cyber", "cybersécurité", "secops", "soc", "pentest", "vulnerability", "iso 27001"],
    keywords: ["cybersécurité", "soc", "secops", "pentest", "vulnerability", "siem"],
    source: "hand_curated",
  },
  {
    id: "project-management",
    triggers: ["chef de projet", "project manager", "pmo", "product owner", "scrum", "agile", "kanban"],
    keywords: ["chef de projet", "project manager", "PMO", "product owner", "scrum", "agile"],
    source: "hand_curated",
  },
  {
    id: "m-e-ngo",
    triggers: ["m&e", "suivi-évaluation", "suivi évaluation", "monitoring", "evaluation", "ong", "ngo", "humanitarian", "relief", "programme", "program"],
    keywords: ["suivi-évaluation", "monitoring", "evaluation", "M&E", "ong", "programme"],
    source: "hand_curated",
  },
  {
    id: "sales-bd",
    triggers: ["business developer", "business development", "bd", "sales", "commercial", "vente", "account manager"],
    keywords: ["commercial", "business developer", "vente", "prospection", "account manager", "crm"],
    excludedKeywords: ["immobilier", "stage"],
    source: "hand_curated",
  },
  {
    id: "marketing-com",
    triggers: ["marketing", "communication", "community manager", "social media", "content", "seo", "sea", "copywriter", "brand"],
    keywords: ["marketing", "communication", "community manager", "social media", "seo", "campagne"],
    source: "hand_curated",
  },
  {
    id: "health-pharma",
    triggers: ["santé", "health", "pharmacie", "pharmacien", "pharmacist", "infirmier", "nurse", "medical", "clinique", "hôpital"],
    keywords: ["santé", "pharmacie", "pharmacien", "infirmier", "clinique", "médical"],
    source: "hand_curated",
  },
  {
    id: "woodwork-carpentry",
    triggers: ["menuisier", "menuiserie", "ébéniste", "bois", "charpentier", "agencement", "mobilier"],
    keywords: ["menuisier", "menuiserie", "ébéniste", "atelier bois", "agencement", "mobilier"],
    source: "hand_curated",
  },
  {
    id: "transport-driver",
    triggers: ["chauffeur", "livreur", "transport", "permis", "poids lourd", "camion", "coursier", "citerne"],
    keywords: ["chauffeur", "livreur", "poids lourd", "permis C", "coursier", "citerne"],
    excludedKeywords: ["taxi"],
    source: "hand_curated",
  },
  {
    id: "accounting-finance",
    triggers: ["comptable", "comptabilité", "aide comptable", "finance", "financier", "trésorerie", "fiscalité", "audit", "sage", "ohada"],
    keywords: ["comptable", "aide comptable", "comptabilité", "OHADA", "trésorerie", "fiscalité"],
    source: "hand_curated",
  },
  {
    id: "admin-secretariat",
    triggers: ["secrétaire", "assistant administratif", "assistante administrative", "administration", "accueil", "office manager", "standardiste"],
    keywords: ["secrétaire", "assistant administratif", "accueil", "office manager", "standardiste", "bureautique"],
    source: "hand_curated",
  },
  {
    id: "logistics-transit",
    triggers: ["transitaire", "transit", "douane", "douanier", "dédouanement", "import", "export", "logistique", "magasinier", "stock", "approvisionnement", "supply", "fret"],
    keywords: ["transitaire", "transit", "douane", "dédouanement", "fret", "import export"],
    source: "hand_curated",
  },
  {
    id: "warehouse-logistics",
    triggers: ["magasinier", "stock", "inventaire", "entrepôt", "cariste", "manutention", "manutentionnaire", "approvisionnement"],
    keywords: ["magasinier", "stock", "inventaire", "entrepôt", "cariste", "approvisionnement"],
    source: "hand_curated",
  },
  {
    id: "construction-trades",
    triggers: ["btp", "maçon", "maçonnerie", "chantier", "conducteur travaux", "chef chantier", "génie civil", "bâtiment", "construction"],
    keywords: ["BTP", "chantier", "maçon", "conducteur travaux", "génie civil", "bâtiment"],
    source: "hand_curated",
  },
  {
    id: "electrical-maintenance",
    triggers: ["électricien", "électricité", "maintenance", "climatisation", "froid", "électromécanicien"],
    keywords: ["électricien", "électricité", "maintenance", "climatisation", "froid", "électromécanicien"],
    source: "hand_curated",
  },
  {
    id: "mechanic-welding",
    triggers: ["mécanicien", "mécanique", "garage", "soudeur", "soudure", "tôlier", "chaudronnier"],
    keywords: ["mécanicien", "mécanique", "garage", "soudeur", "soudure", "chaudronnier"],
    source: "hand_curated",
  },
  {
    id: "hospitality-food",
    triggers: ["serveur", "serveuse", "cuisinier", "cuisine", "restaurant", "restauration", "hôtel", "réceptionniste", "barmaid", "barman"],
    keywords: ["serveur", "cuisinier", "restauration", "restaurant", "hôtel", "réceptionniste"],
    source: "hand_curated",
  },
  {
    id: "retail-cashier",
    triggers: ["caissier", "caissière", "vendeur", "vendeuse", "boutique", "rayon", "supermarché", "merchandiser"],
    keywords: ["caissier", "vendeur", "vente", "boutique", "rayon", "supermarché"],
    source: "hand_curated",
  },
  {
    id: "hr-recruiting",
    triggers: ["rh", "ressources humaines", "recrutement", "paie", "formation", "talent", "hr"],
    keywords: ["ressources humaines", "RH", "paie", "formation", "administration RH", "talent acquisition"],
    source: "hand_curated",
  },
  {
    id: "legal",
    triggers: ["juriste", "juridique", "droit", "légal", "avocat", "contrat", "conformité", "compliance"],
    keywords: ["juriste", "juridique", "droit", "contrat", "conformité", "contentieux"],
    source: "hand_curated",
  },
  {
    id: "education-training",
    triggers: ["enseignant", "professeur", "formateur", "formation", "éducateur", "pédagogie", "école"],
    keywords: ["enseignant", "professeur", "formateur", "formation", "éducateur", "pédagogie"],
    source: "hand_curated",
  },
  {
    id: "security-guard",
    triggers: ["agent de sécurité", "sécurité", "gardien", "gardiennage", "surveillance", "vigile"],
    keywords: ["agent de sécurité", "gardiennage", "surveillance", "vigile", "contrôle accès", "ronde"],
    source: "hand_curated",
  },
  {
    id: "cleaning-care",
    triggers: ["ménage", "nettoyage", "agent d'entretien", "entretien", "nounou", "aide ménagère", "domestique", "technicien de surface"],
    keywords: ["ménage", "nettoyage", "agent d'entretien", "aide ménagère", "technicien de surface", "hygiène"],
    source: "hand_curated",
  },
  {
    id: "beauty-fashion",
    triggers: ["coiffeur", "coiffeuse", "coiffure", "esthétique", "couturier", "couturière", "couture", "tailleur"],
    keywords: ["coiffeur", "coiffure", "esthétique", "couturier", "couture", "tailleur"],
    source: "hand_curated",
  },
];

export function normalizeSuggestionText(input: string) {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile la liste de déclencheurs d'une entrée en une seule regex, en
 * normalisant chaque déclencheur (accents retirés, casse ignorée) avant de
 * l'assembler. C'est cette normalisation systématique — appliquée ici ET
 * sur le texte de l'utilisateur dans `collectMatchingEntries` — qui rend le
 * dictionnaire immunisé contre le bug d'accents, plutôt que de compter sur
 * chaque contributeur pour y penser à chaque nouvelle entrée.
 *
 * Un espace à l'intérieur d'un déclencheur devient `\s?` (espace optionnel),
 * pour couvrir aussi bien "chef de projet" que "chef  de projet" ou
 * "chefdeprojet" tel qu'on le voit parfois dans des titres d'offres.
 */
function buildTriggerPattern(triggers: string[]): RegExp {
  const parts = triggers
    .map((trigger) => normalizeSuggestionText(trigger))
    .filter(Boolean)
    .map((trigger) => escapeRegExp(trigger).replace(/\s+/g, "\\s?"));
  const unique = Array.from(new Set(parts));
  // (?:^|[^a-z0-9]) en tête et (?=[^a-z0-9]|$) en fin jouent le même rôle
  // qu'un \b classique, mais fonctionnent aussi quand un déclencheur commence
  // ou finit par un caractère qui n'est pas une lettre/chiffre (ex: "c#",
  // ".net") — \b ne reconnaît une limite qu'entre deux caractères ASCII
  // alphanumériques, donc échoue silencieusement sur ces cas-là aussi,
  // vérifié empiriquement en même temps que le bug d'accents.
  // Écrit volontairement sans lookbehind (?<!...) : cette syntaxe n'est
  // supportée par Safari qu'à partir de la version 16.4, et JobRadar cible
  // explicitement Safari iOS comme navigateur principal.
  return new RegExp(`(?:^|[^a-z0-9])(?:${unique.join("|")})(?=[^a-z0-9]|$)`, "i");
}

export const JOB_SUGGESTION_ENTRIES: JobSuggestionEntry[] = JOB_SUGGESTION_ENTRIES_DATA.map((entry) => ({
  ...entry,
  pattern: buildTriggerPattern(entry.triggers),
}));

function uniquePreservingCase(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const clean = item.trim().replace(/\s+/g, " ");
    const key = normalizeSuggestionText(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function isUsefulKeyword(keyword: string) {
  const normalized = normalizeSuggestionText(keyword);
  if (!normalized) return false;
  if (GENERIC_ALERT_TERMS.has(normalized)) return false;
  if (WEAK_SUGGESTION_TERMS.has(normalized)) return false;
  if (normalized.length < 4 && !SHORT_ALLOWED_TERMS.has(normalized)) return false;
  return true;
}

function fallbackKeywords(title: string) {
  const tokens = normalizeSuggestionText(title)
    .replace(/[^a-z0-9\s+.#&-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => word.length >= 4 || SHORT_ALLOWED_TERMS.has(word))
    .filter((word) => !STOP_WORDS.has(word))
    .filter(isUsefulKeyword);

  return uniquePreservingCase(tokens).slice(0, 3);
}

function collectMatchingEntries(title: string) {
  const raw = title.trim();
  if (!raw) return [];
  // Le texte de l'utilisateur est normalisé exactement comme les
  // déclencheurs du dictionnaire (voir buildTriggerPattern). C'est la
  // symétrie des deux côtés qui garantit le matching, pas un traitement
  // spécial d'un côté ou de l'autre.
  const normalized = normalizeSuggestionText(raw);
  return JOB_SUGGESTION_ENTRIES.filter((entry) => entry.pattern.test(normalized));
}

export function suggestKeywordsFromTitle(title: string) {
  const matches = collectMatchingEntries(title).flatMap((entry) => entry.keywords);
  const fallback = fallbackKeywords(title);
  return uniquePreservingCase([...matches, ...fallback])
    .filter(isUsefulKeyword)
    .slice(0, MAX_KEYWORD_SUGGESTIONS);
}

export function suggestExcludedKeywordsFromTitle(title: string) {
  return uniquePreservingCase(collectMatchingEntries(title).flatMap((entry) => entry.excludedKeywords ?? [])).slice(0, 4);
}

export function splitKeywordsText(value: string) {
  return uniquePreservingCase(value.split(",").map((item) => item.trim()).filter(Boolean));
}

export function mergeKeywordLists(base: string[], additions: string[], limit = MAX_STORED_ALERT_KEYWORDS) {
  return uniquePreservingCase([...base, ...additions]).filter(isUsefulKeyword).slice(0, limit);
}

export function hasSuggestionDictionaryIssues() {
  const issues: string[] = [];
  for (const entry of JOB_SUGGESTION_ENTRIES) {
    if (entry.keywords.length > MAX_KEYWORD_SUGGESTIONS) {
      issues.push(`${entry.id}: too many keywords`);
    }
    for (const keyword of entry.keywords) {
      if (!isUsefulKeyword(keyword)) {
        issues.push(`${entry.id}: weak or generic keyword "${keyword}"`);
      }
    }
    // Garde-fou permanent : si quelqu'un revient à l'ancienne habitude de
    // lister une forme accentuée ET sa forme sans accent comme deux
    // déclencheurs séparés, c'est désormais inutile (voir buildTriggerPattern)
    // et signale qu'on n'a pas compris pourquoi ce n'est plus nécessaire.
    const seenTriggers = new Set<string>();
    for (const trigger of entry.triggers) {
      const normalized = normalizeSuggestionText(trigger);
      if (seenTriggers.has(normalized)) {
        issues.push(`${entry.id}: redundant trigger "${trigger}" (accent-only duplicate, no longer needed)`);
      }
      seenTriggers.add(normalized);
    }
  }
  return issues;
}
