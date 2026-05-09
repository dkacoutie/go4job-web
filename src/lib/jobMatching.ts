import { canonicalizeText } from "./taxonomy";

export type AlertLike = {
  name?: string | null;
  keywords?: string[] | null;
  country?: string | null;
  countries?: string[] | null;
};

export type JobLike = {
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  description?: string | null;
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  job_family?: string | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
};

export type CvExperience = { min: number | null; max: number | null } | null;

export type RemotePreference = "any" | "remote" | "hybrid" | "onsite";
export type GeoRemoteLevel = "strong" | "medium" | "none" | "unknown";

export type GeoPreferences = {
  allowAllCountries: boolean;
  allowedCountries: Set<string>;
  remotePreference: RemotePreference;
};

export type GeoRemoteBreakdown = {
  considered: boolean;
  country_match: boolean | null;
  remote_match: boolean | null;
  level: GeoRemoteLevel;
  points_awarded: number;
};

export type SkillsQualityBreakdown = {
  considered: boolean;
  matched_required_skills: string[];
  matched_optional_skills: string[];
  points_awarded: number;
};

export type DataQualityLevel = "high" | "medium" | "low";

export type DataQualityBreakdown = {
  score: number;
  level: DataQualityLevel;
  desc_len: number;
  job_is_sparse: boolean;
  has_tags: boolean;
  has_skills: boolean;
  has_location: boolean;
  has_title: boolean;
  has_remote: boolean;
};

export type DomainBreakdown = {
  profile_domains: string[];
  job_domain: string | null;
  profile_scores: Record<string, number>;
  job_scores: Record<string, number>;
  strong_mismatch: boolean;
  evidence_count: number;
  passes_evidence: boolean;
};

export type RoleFamilyConfidence = "none" | "weak" | "medium" | "strong";
export type RoleFamilyRelation = "match" | "mismatch" | "unknown";

export type RoleFamilyBreakdown = {
  profile_family: string | null;
  profile_label: string | null;
  profile_confidence: RoleFamilyConfidence;
  profile_contenders: string[];
  profile_scores: Record<string, number>;
  profile_evidence: string[];
  job_family: string | null;
  job_label: string | null;
  job_confidence: RoleFamilyConfidence;
  job_contenders: string[];
  job_scores: Record<string, number>;
  job_evidence: string[];
  relation: RoleFamilyRelation;
  gated: boolean;
  cap_applied: number | null;
};

export type ScoreLayersBreakdown = {
  title: number;
  meta: number;
  desc: number;
  combined: number;
  cap_applied?: string | null;
};

export type MatchWhyDetails = {
  score: number;
  breakdown: {
    alert: {
      total_keywords: number;
      matched_keywords: string[];
      matched_count: number;
      effective_weight_sum: number;
      generic_keywords: string[];
    };
    cv: {
      total_keywords: number;
      matched_keywords: string[];
      matched_count: number;
      effective_weight_sum: number;
      generic_keywords: string[];
    };
    experience: {
      considered: boolean;
      cv_exp_value?: number | null;
      job_min?: number | null;
      job_max?: number | null;
      ok?: boolean;
      points_awarded?: number;
    };
    geo_remote: GeoRemoteBreakdown;
    skills_quality: SkillsQualityBreakdown;
    generic_keyword_adjustment: {
      applied: boolean;
      matched_generic_keywords: string[];
      impact_note?: string;
    };
    role_family: RoleFamilyBreakdown;
    data_quality: DataQualityBreakdown;
    domain: DomainBreakdown;
    score_layers: ScoreLayersBreakdown;
  };
  debug?: {
    denom: number;
    weighted: number;
    score_title: number;
    score_meta: number;
    score_desc: number;
    data_quality: number;
    score_simple: number;
    score_advanced: number;
    thresholds?: { topMatch: number };
  };
};

export type MatchWhySummary = {
  alert: string[];
  cv: string[];
  restAlert: number;
  restCv: number;
  tags: string[];
  reasons: string[];
  missing: string[];
  details: MatchWhyDetails;
};

export type MatchScoreResult = {
  score: number;
  scoreSimple: number;
  s: number;
  kwCount: number;
  signalCount: number;
  expOk: boolean;
  expConsidered: boolean;
  geoRemote: GeoRemoteBreakdown;
  skillsQuality: SkillsQualityBreakdown;
  dataQuality: DataQualityBreakdown;
  jobIsSparse: boolean;
  evidenceCount: number;
  passesEvidence: boolean;
  domainMatch: boolean;
  domainMismatch: boolean;
  roleFamily: RoleFamilyBreakdown;
  scoreTitle: number;
  scoreMeta: number;
  scoreDesc: number;
  scoreCombined: number;
  why: MatchWhySummary;
};

const WEIGHT_ALERT = 2;
const WEIGHT_ALERT_GENERIC = 1.25;
const WEIGHT_CV = 1;
const WEIGHT_CV_GENERIC = 0.5;
const WEIGHT_EXP = 2;
const WEIGHT_GEO_MAX = 2;
const WEIGHT_SKILLS_MAX = 2;

const DESC_SPARSE_LEN = 350;
const DESC_MIN_LEN = 50;

const GENERIC_KEYWORDS = new Set([
  "senior",
  "lead",
  "manager",
  "head",
  "director",
  "principal",
  "chief",
  "assistant",
  "charge",
  "chargee",
  "agent",
  "responsable",
  "gestionnaire",
  "gestion",
  "management",
  "communication",
  "finance",
  "team",
  "office",
  "projet",
  "project",
  "support",
  "administratif",
  "administration",
  "officer",
  "specialist",
  "coordinator",
  "analyst",
  "executive",
  "associate",
  "administrator",
  "consultant",
  "generalist",
]);

const GENERIC_TITLE_TOKENS = new Set([
  "senior",
  "lead",
  "assistant",
  "officer",
  "manager",
  "head",
  "director",
  "principal",
  "chief",
  "agent",
  "intern",
  "internship",
  "trainee",
  "stage",
  "assistant",
  "associate",
  "specialist",
  "coordinator",
  "generalist",
  "responsable",
  "gestionnaire",
]);

const TOKEN_STOPWORDS = new Set([
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
  "au",
  "aux",
  "pour",
  "avec",
  "sans",
  "sur",
  "dans",
  "chez",
  "ou",
  "the",
  "a",
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
  "remote",
  "hybrid",
  "freelance",
  "intern",
  "internship",
  "stage",
  "alternance",
  "junior",
  "senior",
  "lead",
  "manager",
  "head",
  "director",
  "principal",
  "chief",
]);

const SKILLS_FINAL_CANON: Array<{ label: string; synonyms: string[] }> = [
  {
    label: "Gestion budgétaire & contrôle financier",
    synonyms: [
      "gestion budgetaire",
      "controle financier",
      "budget management",
      "budget control",
      "financial control",
      "budgeting",
      "budget oversight",
    ],
  },
  {
    label: "Analyse des écarts, prévisions & reporting",
    synonyms: [
      "analyse des ecarts",
      "ecarts budgetaires",
      "variance analysis",
      "variance reporting",
      "forecasting",
      "budget forecasting",
      "financial forecasting",
      "previsions budgetaires",
      "reporting",
    ],
  },
  {
    label: "Pilotage financier / suivi de performance",
    synonyms: [
      "pilotage financier",
      "suivi de performance",
      "performance management",
      "performance monitoring",
      "financial performance",
      "kpi finance",
    ],
  },
  {
    label: "Gestion de trésorerie",
    synonyms: ["tresorerie", "cash management", "treasury", "cash flow", "cashflow"],
  },
  {
    label: "Achats & approvisionnements / optimisation des coûts",
    synonyms: [
      "achats",
      "approvisionnements",
      "procurement",
      "purchasing",
      "sourcing",
      "cost optimization",
      "cost reduction",
      "cost saving",
      "supply management",
    ],
  },
  {
    label: "Conformité & audits internes",
    synonyms: ["conformite", "audit interne", "compliance", "internal audit", "regulatory compliance"],
  },
  {
    label: "Appels d’offres & gestion des contrats",
    synonyms: [
      "appel d offres",
      "appels d offres",
      "marches",
      "marches publics",
      "tender",
      "bidding",
      "contract management",
      "gestion des contrats",
      "contracts",
    ],
  },
  {
    label: "Coordination de projets & programmes",
    synonyms: [
      "coordination projet",
      "coordination de projet",
      "coordination de projets",
      "coordination programme",
      "gestion de projet",
      "gestion de projets",
      "project coordination",
      "program coordination",
      "project management",
      "programme management",
    ],
  },
  {
    label: "Management d’équipe",
    synonyms: [
      "management d equipe",
      "management d equipes",
      "management d'equipe",
      "management d'equipes",
      "team management",
      "people management",
      "supervision d equipe",
      "leadership d equipe",
    ],
  },
  {
    label: "Communication avec parties prenantes",
    synonyms: [
      "parties prenantes",
      "communication parties prenantes",
      "stakeholder management",
      "stakeholder communication",
      "relations parties prenantes",
    ],
  },
  {
    label: "Reporting financier",
    synonyms: ["reporting financier", "financial reporting", "management reporting", "monthly reporting"],
  },
  {
    label: "Excel avancé / PowerPoint",
    synonyms: ["excel", "excel avance", "advanced excel", "powerpoint", "ppt", "ms excel"],
  },
  {
    label: "SAP / SRAS",
    synonyms: ["sap", "sras", "sap erp", "erp sap"],
  },
  {
    label: "Gestion des fournisseurs",
    synonyms: ["gestion des fournisseurs", "fournisseurs", "supplier management", "vendor management"],
  },
];

const GENERIC_SKILL_TERMS = new Set([
  "gestion",
  "management",
  "communication",
  "finance",
  "administration",
  "projet",
  "team",
  "office",
]);

type CvSkillMatch = {
  label: string;
  key: string;
  score: number;
  inTitle: boolean;
  inDesc: boolean;
  display: string;
};

const SKILL_SYNONYM_INDEX = new Map<string, { label: string; synonyms: string[] }>();
for (const skill of SKILLS_FINAL_CANON) {
  const allTerms = [skill.label, ...skill.synonyms];
  for (const term of allTerms) {
    const k = normalizeSkillText(term);
    if (!k || GENERIC_SKILL_TERMS.has(k)) continue;
    SKILL_SYNONYM_INDEX.set(k, skill);
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSkillText(input: string) {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SKILL_REGEX_CACHE = new Map<string, RegExp>();
function buildSkillRegex(term: string) {
  const cached = SKILL_REGEX_CACHE.get(term);
  if (cached) return cached;
  const escaped = escapeRegExp(term).replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  SKILL_REGEX_CACHE.set(term, re);
  return re;
}

function textHasTerm(text: string, term: string) {
  if (!text || !term) return false;
  const re = buildSkillRegex(term);
  return re.test(text);
}

function resolveCvSkill(label: string) {
  const key = normalizeSkillText(label);
  if (!key || GENERIC_SKILL_TERMS.has(key)) return null;
  const canon = SKILL_SYNONYM_INDEX.get(key);
  if (canon) return canon;
  return { label: label.trim(), synonyms: [label.trim()] };
}

function buildCvSkillEntries(cvSkills: string[]) {
  const entries: Array<{ label: string; key: string; terms: string[] }> = [];
  const seen = new Set<string>();

  for (const raw of cvSkills) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) continue;
    const resolved = resolveCvSkill(cleaned);
    if (!resolved) continue;
    const key = normalizeSkillText(resolved.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const terms = Array.from(
      new Set(
        [resolved.label, ...(resolved.synonyms ?? [])]
          .map((t) => normalizeSkillText(t))
          .filter((t) => t && !GENERIC_SKILL_TERMS.has(t))
      )
    );

    if (!terms.length) continue;
    entries.push({ label: resolved.label, key, terms });
  }

  return entries;
}

function detectCvSkillMatches(cvSkills: string[], titleRaw: string, descRaw: string) {
  const title = normalizeSkillText(titleRaw);
  const desc = normalizeSkillText(descRaw);
  const matches: CvSkillMatch[] = [];
  let scoreSum = 0;

  for (const entry of buildCvSkillEntries(cvSkills)) {
    let inTitle = false;
    let inDesc = false;
    for (const term of entry.terms) {
      if (!inTitle && textHasTerm(title, term)) inTitle = true;
      if (!inDesc && textHasTerm(desc, term)) inDesc = true;
      if (inTitle && inDesc) break;
    }
    const score = Math.min(2, (inTitle ? 2 : 0) + (inDesc ? 1 : 0));
    if (!score) continue;
    scoreSum += score;
    const where = inTitle && inDesc ? "titre+desc" : inTitle ? "titre" : "desc";
    matches.push({
      label: entry.label,
      key: entry.key,
      score,
      inTitle,
      inDesc,
      display: `${entry.label} (${where})`,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches, scoreSum };
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  finance: [
    "finance",
    "financial",
    "budget",
    "budgetaire",
    "comptabilite",
    "accounting",
    "audit",
    "treasury",
    "controle",
    "reporting",
  ],
  operations: [
    "operations",
    "operational",
    "exploitation",
    "logistique",
    "logistics",
    "procurement",
    "achats",
    "supply",
    "inventory",
    "maintenance",
  ],
  administration: [
    "administration",
    "administratif",
    "assistant",
    "office",
    "secretariat",
    "coordination",
    "support",
  ],
  project: [
    "project",
    "projet",
    "programme",
    "pmo",
    "chef de projet",
  ],
  data: [
    "data",
    "analytics",
    "bi",
    "sql",
    "power bi",
    "tableau",
  ],
  engineering: [
    "developer",
    "software",
    "engineer",
    "it",
    "cloud",
    "network",
    "devops",
  ],
  marketing: [
    "marketing",
    "communication",
    "brand",
    "media",
    "pr",
    "relations presse",
    "digital",
  ],
  sales: [
    "sales",
    "vente",
    "commercial",
    "business development",
    "bd",
  ],
  legal: [
    "legal",
    "juridique",
    "compliance",
    "contract",
  ],
  health: [
    "health",
    "sante",
    "medical",
    "pharmacy",
    "clinique",
    "hospital",
  ],
};

type RoleFamilyId =
  | "project_program"
  | "product"
  | "engineering"
  | "data_ai"
  | "design_ux"
  | "marketing_comms"
  | "sales_bizdev"
  | "finance_accounting"
  | "hr_admin"
  | "operations_supply"
  | "legal_compliance"
  | "customer_success"
  | "healthcare";

const ROLE_FAMILY_LABELS: Record<RoleFamilyId, string> = {
  project_program: "Gestion de projet / programme",
  product: "Produit",
  engineering: "Ingenierie logicielle / plateforme",
  data_ai: "Data / IA",
  design_ux: "Design / UX",
  marketing_comms: "Marketing / communication",
  sales_bizdev: "Sales / business development",
  finance_accounting: "Finance / comptabilite",
  hr_admin: "RH / administration",
  operations_supply: "Operations / supply",
  legal_compliance: "Legal / compliance",
  customer_success: "Support / customer success",
  healthcare: "Sante",
};

const ROLE_FAMILY_NOISE_TOKENS = new Set([
  "senior",
  "lead",
  "manager",
  "head",
  "director",
  "principal",
  "chief",
  "responsable",
  "gestionnaire",
  "officer",
  "specialist",
  "specialiste",
  "consultant",
  "expert",
]);

const ROLE_FAMILY_RULES: Array<{ id: RoleFamilyId; terms: string[] }> = [
  {
    id: "project_program",
    terms: [
      "project manager",
      "project management",
      "program manager",
      "programme manager",
      "program management",
      "programme management",
      "chef de projet",
      "gestion de projet",
      "gestionnaire de projet",
      "project coordinator",
      "project coordination",
      "program coordinator",
      "programme coordinator",
      "project officer",
      "programme officer",
      "pmo",
      "projet",
      "project",
      "programme",
    ],
  },
  {
    id: "product",
    terms: [
      "product manager",
      "product owner",
      "product management",
      "chef de produit",
      "responsable produit",
      "product strategy",
      "produit",
      "product",
    ],
  },
  {
    id: "engineering",
    terms: [
      "software engineer",
      "software developer",
      "platform engineer",
      "fullstack developer",
      "full stack developer",
      "frontend developer",
      "backend developer",
      "front end developer",
      "back end developer",
      "mobile developer",
      "cloud engineer",
      "devops",
      "site reliability",
      "sre",
      "developer",
      "developpeur",
      "software",
      "engineering",
      "engineer",
      "fullstack",
      "frontend",
      "backend",
      "platform",
    ],
  },
  {
    id: "data_ai",
    terms: [
      "data analyst",
      "analyste data",
      "data scientist",
      "data engineer",
      "analytics engineer",
      "business intelligence",
      "machine learning",
      "artificial intelligence",
      "power bi",
      "tableau",
      "data",
      "analytics",
      "sql",
      "bi",
      "ai",
      "ml",
    ],
  },
  {
    id: "design_ux",
    terms: [
      "product designer",
      "ux designer",
      "ui designer",
      "graphic designer",
      "designer",
      "design",
      "ux",
      "ui",
    ],
  },
  {
    id: "marketing_comms",
    terms: [
      "marketing manager",
      "content marketing",
      "content manager",
      "digital marketing",
      "growth marketing",
      "social media",
      "copywriter",
      "brand",
      "seo",
      "marketing",
      "communication",
      "communications",
      "growth",
      "content",
      "media",
    ],
  },
  {
    id: "sales_bizdev",
    terms: [
      "account executive",
      "account manager",
      "business development",
      "sales manager",
      "key account",
      "partnership",
      "partnerships",
      "sales",
      "commercial",
      "vente",
      "bizdev",
    ],
  },
  {
    id: "finance_accounting",
    terms: [
      "financial analyst",
      "finance manager",
      "finance",
      "financial",
      "accounting",
      "accountant",
      "controller",
      "controle de gestion",
      "treasury",
      "budget",
      "audit",
      "fp&a",
      "comptabilite",
      "comptable",
    ],
  },
  {
    id: "hr_admin",
    terms: [
      "human resources",
      "talent acquisition",
      "administrative assistant",
      "office manager",
      "payroll",
      "recruiter",
      "recrutement",
      "administration",
      "administratif",
      "assistant administratif",
      "rh",
      "paie",
      "hr",
    ],
  },
  {
    id: "operations_supply",
    terms: [
      "operations manager",
      "supply chain",
      "procurement",
      "purchasing",
      "logistics",
      "logistique",
      "inventory",
      "warehouse",
      "operations",
      "achats",
      "supply",
    ],
  },
  {
    id: "legal_compliance",
    terms: [
      "legal counsel",
      "contract manager",
      "contracts",
      "compliance officer",
      "privacy",
      "juridique",
      "legal",
      "compliance",
      "risk",
      "contract",
    ],
  },
  {
    id: "customer_success",
    terms: [
      "customer success",
      "customer support",
      "client success",
      "service client",
      "helpdesk",
      "technical support",
      "support client",
      "support",
    ],
  },
  {
    id: "healthcare",
    terms: [
      "health",
      "medical",
      "clinical",
      "doctor",
      "nurse",
      "pharmacy",
      "pharmacien",
      "sante",
    ],
  },
];

type RoleFamilyDetection = {
  primary: RoleFamilyId | null;
  confidence: RoleFamilyConfidence;
  contenders: RoleFamilyId[];
  scores: Record<string, number>;
  evidence: string[];
};

const PROFILE_EXPANSIONS: Array<{ triggers: string[]; add: string[] }> = [
  {
    triggers: ["evenement", "event", "eventiel", "evenementiel"],
    add: [
      "conference",
      "press conference",
      "relations presse",
      "pr",
      "media",
      "logistique",
      "coordination",
      "communication",
      "event planning",
      "event management",
    ],
  },
  {
    triggers: ["communication", "relations presse", "pr"],
    add: ["press", "public relations", "media", "comm"],
  },
  {
    triggers: ["budget", "budgetaire", "finance", "financial"],
    add: ["budgeting", "reporting", "controle", "control", "treasury"],
  },
];

const REMOTE_TERMS = {
  remote: ["remote", "remotely", "teletravail", "telework", "work from home", "wfh", "distance"],
  hybrid: ["hybrid", "hybride", "flex"],
  onsite: ["on-site", "onsite", "on site", "office", "presentiel", "presential", "in office"],
};

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

export function normalizeSearchText(input: string) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(input: string) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeKeyword(input: string) {
  return norm(canonicalizeText(input ?? ""));
}

function normalizeLoose(input: string) {
  return normalizeText(canonicalizeText(input ?? ""));
}

function stripRoleNoise(input: string) {
  return normalizeLoose(input)
    .split(/\s+/)
    .filter((token) => token && !ROLE_FAMILY_NOISE_TOKENS.has(token))
    .join(" ");
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

const COUNTRY_ALIAS_MAP: Record<string, string[]> = {
  CI: ["ci", "côte d’ivoire", "côte d'ivoire", "cote d ivoire", "cote ivoire", "ivory coast"],
  SN: ["sn", "sénégal", "senegal"],
  FR: ["fr", "france"],
  GB: ["gb", "uk", "united kingdom", "royaume uni", "angleterre"],
  US: ["us", "usa", "united states", "états-unis", "etats unis"],
  CA: ["ca", "canada"],
  BE: ["be", "belgique", "belgium"],
  CH: ["ch", "suisse", "switzerland"],
  DE: ["de", "allemagne", "germany"],
  MA: ["ma", "maroc", "morocco"],
  TN: ["tn", "tunisie", "tunisia"],
  DZ: ["dz", "algérie", "algerie", "algeria"],
  CM: ["cm", "cameroun", "cameroon"],
  BJ: ["bj", "bénin", "benin"],
  TG: ["tg", "togo"],
  BF: ["bf", "burkina", "burkina faso"],
  ML: ["ml", "mali"],
  NE: ["ne", "niger"],
  GN: ["gn", "guinée", "guinee", "guinea"],
  GH: ["gh", "ghana"],
  NG: ["ng", "nigeria"],
  KE: ["ke", "kenya"],
  RW: ["rw", "rwanda"],
  ZA: ["za", "afrique du sud", "south africa"],
};

const COUNTRY_ALIAS_INDEX = new Map<string, string>();
for (const [code, aliases] of Object.entries(COUNTRY_ALIAS_MAP)) {
  for (const alias of aliases) {
    COUNTRY_ALIAS_INDEX.set(normalizeSearchText(alias), code);
  }
}

export function getCountryAliases(countryCode: string | null | undefined): string[] {
  const raw = (countryCode ?? "").trim();
  const code = raw.length === 2 ? raw.toUpperCase() : resolveCountrySearchQuery(raw);
  return code ? COUNTRY_ALIAS_MAP[code] ?? [] : [];
}

export function resolveCountrySearchQuery(q: string): string | null {
  return COUNTRY_ALIAS_INDEX.get(normalizeSearchText(q)) ?? null;
}

function sum(nums: number[]) {
  return nums.reduce((acc, v) => acc + v, 0);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((t) => text.includes(t));
}

function pickRemotePreference(scores: { remote: number; hybrid: number; onsite: number }): RemotePreference {
  const max = Math.max(scores.remote, scores.hybrid, scores.onsite);
  if (!max) return "any";
  const picks = Object.entries(scores)
    .filter(([, v]) => v === max)
    .map(([k]) => k as RemotePreference);
  if (picks.length !== 1) return "any";
  return picks[0];
}

function buildProfileTokens(alertKeywords: string[]) {
  const raw = uniq(alertKeywords).map(normalizeLoose).filter(Boolean);
  const phrases = raw.filter((p) => p.length >= 3);
  const words = raw.flatMap((p) => p.split(/\s+/).filter(Boolean));
  const tokens = uniq([...phrases, ...words]).filter((t) => t.length >= 3);
  return tokens.filter((t) => !TOKEN_STOPWORDS.has(t)).slice(0, 80);
}

function expandProfileTokens(tokens: string[]) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const rule of PROFILE_EXPANSIONS) {
      if (rule.triggers.some((t) => token.includes(t))) {
        rule.add.forEach((add) => expanded.add(normalizeLoose(add)));
      }
    }
  }
  return Array.from(expanded).filter((t) => t && t.length >= 3 && !TOKEN_STOPWORDS.has(t));
}

function tokenWeight(token: string) {
  return isGenericKeyword(token) ? 0.5 : 1;
}

function computeTokenScore(tokens: string[], text: string) {
  if (!tokens.length || !text) {
    return { score: 0, matched: [], matchedWeight: 0, totalWeight: 0 };
  }
  let matchedWeight = 0;
  let totalWeight = 0;
  const matched: string[] = [];

  for (const token of tokens) {
    const w = tokenWeight(token);
    totalWeight += w;
    if (text.includes(token)) {
      matchedWeight += w;
      matched.push(token);
    }
  }

  const score = totalWeight ? matchedWeight / totalWeight : 0;
  return { score, matched: uniq(matched), matchedWeight, totalWeight };
}

function scoreDomains(text: string) {
  const scores: Record<string, number> = {};
  const t = normalizeLoose(text);
  for (const [domain, keys] of Object.entries(DOMAIN_KEYWORDS)) {
    let hit = 0;
    for (const key of keys) {
      if (t.includes(normalizeLoose(key))) hit += 1;
    }
    if (hit > 0) scores[domain] = hit;
  }
  return scores;
}

function pickTopDomains(scores: Record<string, number>, max = 3) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([d]) => d);
}

function pickPrimaryDomain(scores: Record<string, number>): string | null {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  if (sorted[0][1] <= 0) return null;
  return sorted[0][0];
}

function roleFamilyTermWeight(term: string) {
  if (term.includes(" ")) return 2.5;
  if (term.length >= 8) return 1.5;
  return 1;
}

function scoreRoleFamilies(sources: Array<{ label: string; text: string; weight: number }>) {
  const scores: Record<string, number> = {};
  const evidence: Record<string, string[]> = {};

  for (const source of sources) {
    const text = stripRoleNoise(source.text);
    if (!text) continue;

    for (const rule of ROLE_FAMILY_RULES) {
      for (const term of rule.terms) {
        const normalizedTerm = normalizeLoose(term);
        if (!normalizedTerm || !textHasTerm(text, normalizedTerm)) continue;

        const points = source.weight * roleFamilyTermWeight(normalizedTerm);
        scores[rule.id] = (scores[rule.id] ?? 0) + points;
        const evidenceEntry = `${source.label}:${term}`;
        const familyEvidence = evidence[rule.id] ?? [];
        if (!familyEvidence.includes(evidenceEntry)) familyEvidence.push(evidenceEntry);
        evidence[rule.id] = familyEvidence;
      }
    }
  }

  return { scores, evidence };
}

function detectRoleFamily(sources: Array<{ label: string; text: string; weight: number }>): RoleFamilyDetection {
  const { scores, evidence } = scoreRoleFamilies(sources);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[RoleFamilyId, number]>;
  const top = sorted[0] ?? null;
  const secondScore = sorted[1]?.[1] ?? 0;
  const topScore = top?.[1] ?? 0;
  const gap = topScore - secondScore;

  let confidence: RoleFamilyConfidence = "none";
  if (topScore >= 9 && gap >= 2.5) confidence = "strong";
  else if (topScore >= 5 && gap >= 1.5) confidence = "medium";
  else if (topScore >= 3.5) confidence = "weak";

  const primary = confidence === "none" ? null : top?.[0] ?? null;
  const contenders =
    primary && topScore > 0
      ? sorted.filter(([, score]) => topScore - score <= 1.5).slice(0, 3).map(([family]) => family)
      : [];

  return {
    primary,
    confidence,
    contenders,
    scores,
    evidence: primary ? (evidence[primary] ?? []).slice(0, 4) : [],
  };
}

function computeRoleFamilyBreakdown(params: {
  desiredRole?: string | null;
  alertKeywords: string[];
  cvKeywords: string[];
  job: JobLike;
}): RoleFamilyBreakdown {
  const profileRole = detectRoleFamily([
    { label: "desired_role", text: params.desiredRole ?? "", weight: 4 },
    { label: "alert_keywords", text: params.alertKeywords.join(" "), weight: 2.5 },
    { label: "cv", text: params.cvKeywords.join(" "), weight: 1.5 },
  ]);

  const jobRole = detectRoleFamily([
    { label: "job_family", text: params.job.job_family ?? "", weight: 4 },
    { label: "title", text: params.job.title ?? "", weight: 4 },
    {
      label: "tags",
      text: [...(params.job.tags ?? []), ...(params.job.required_skills ?? []), ...(params.job.optional_skills ?? []), ...(params.job.job_skills ?? [])]
        .filter(Boolean)
        .join(" "),
      weight: 2,
    },
  ]);

  let relation: RoleFamilyRelation = "unknown";
  let gated = false;
  let capApplied: number | null = null;

  if (profileRole.primary && jobRole.primary) {
    const familiesOverlap =
      profileRole.primary === jobRole.primary ||
      profileRole.contenders.includes(jobRole.primary) ||
      jobRole.contenders.includes(profileRole.primary);

    if (familiesOverlap) {
      relation = "match";
    } else if (
      (profileRole.confidence === "strong" || profileRole.confidence === "medium") &&
      (jobRole.confidence === "strong" || jobRole.confidence === "medium")
    ) {
      relation = "mismatch";
      gated = true;
      capApplied = profileRole.confidence === "strong" && jobRole.confidence === "strong" ? 24 : 32;
    }
  }

  return {
    profile_family: profileRole.primary,
    profile_label: profileRole.primary ? ROLE_FAMILY_LABELS[profileRole.primary] : null,
    profile_confidence: profileRole.confidence,
    profile_contenders: profileRole.contenders,
    profile_scores: profileRole.scores,
    profile_evidence: profileRole.evidence,
    job_family: jobRole.primary,
    job_label: jobRole.primary ? ROLE_FAMILY_LABELS[jobRole.primary] : null,
    job_confidence: jobRole.confidence,
    job_contenders: jobRole.contenders,
    job_scores: jobRole.scores,
    job_evidence: jobRole.evidence,
    relation,
    gated,
    cap_applied: capApplied,
  };
}

function isGenericKeyword(input: string) {
  const base = normalizeLoose(input);
  if (!base) return false;
  if (GENERIC_KEYWORDS.has(base)) return true;
  const parts = base.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => GENERIC_KEYWORDS.has(p));
}

function isGenericTitle(input: string) {
  const t = normalizeLoose(input);
  if (!t) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length <= 2 && parts.every((p) => GENERIC_TITLE_TOKENS.has(p))) return true;
  if (parts.length === 1 && GENERIC_TITLE_TOKENS.has(parts[0])) return true;
  if (t.length <= 7) return true;
  return false;
}

function computeDataQuality(job: JobLike): DataQualityBreakdown {
  const desc = (job.description ?? "").trim();
  const descLen = desc.length;
  const hasTags = (job.tags ?? []).length > 0;
  const hasSkills =
    (job.job_skills ?? []).length > 0 || (job.required_skills ?? []).length > 0 || (job.optional_skills ?? []).length > 0;
  const hasLocation = Boolean((job.location ?? "").trim() || (job.country ?? "").trim());
  const hasTitle = Boolean((job.title ?? "").trim());
  const hasRemote = Boolean((job.remote_type ?? "").trim());

  const descScore = Math.min(1, descLen / 800);
  let score = 0;
  score += descScore * 0.45;
  score += hasSkills ? 0.2 : 0;
  score += hasTags ? 0.1 : 0;
  score += hasLocation ? 0.1 : 0;
  score += hasTitle ? 0.1 : 0;
  score += hasRemote ? 0.05 : 0;
  score = Math.min(1, Math.max(0, score));

  const level: DataQualityLevel = score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low";

  return {
    score,
    level,
    desc_len: descLen,
    job_is_sparse: descLen < DESC_SPARSE_LEN,
    has_tags: hasTags,
    has_skills: hasSkills,
    has_location: hasLocation,
    has_title: hasTitle,
    has_remote: hasRemote,
  };
}

function computeLayerWeights(jobIsSparse: boolean, metaConsidered: boolean, descConsidered: boolean) {
  const base = jobIsSparse
    ? { title: 0.55, meta: 0.35, desc: 0.1 }
    : { title: 0.25, meta: 0.25, desc: 0.5 };

  const weights = { ...base };
  if (!metaConsidered) weights.meta = 0;
  if (!descConsidered) weights.desc = 0;

  const total = weights.title + weights.meta + weights.desc || 1;
  return {
    title: weights.title / total,
    meta: weights.meta / total,
    desc: weights.desc / total,
  };
}

export function buildGeoPreferences(alerts: AlertLike[]): GeoPreferences {
  if (!alerts?.length) {
    return { allowAllCountries: true, allowedCountries: new Set<string>(), remotePreference: "any" };
  }

  let allowAll = false;
  const set = new Set<string>();
  const remoteScores = { remote: 0, hybrid: 0, onsite: 0 };

  for (const a of alerts) {
    const list = (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : [])
      .map((x) => (x ?? "").trim().toUpperCase())
      .filter(Boolean);

    if (!list.length) {
      allowAll = true;
    } else {
      for (const c of list) set.add(c);
    }

    const text = normalizeLoose([a.name, ...(a.keywords ?? [])].filter(Boolean).join(" "));
    if (text) {
      if (hasAny(text, REMOTE_TERMS.remote)) remoteScores.remote += 1;
      if (hasAny(text, REMOTE_TERMS.hybrid)) remoteScores.hybrid += 1;
      if (hasAny(text, REMOTE_TERMS.onsite)) remoteScores.onsite += 1;
    }
  }

  if (set.size === 0) allowAll = true;

  return {
    allowAllCountries: allowAll,
    allowedCountries: set,
    remotePreference: pickRemotePreference(remoteScores),
  };
}

function classifyJobRemoteType(job: JobLike): RemotePreference | null {
  const text = normalizeLoose([job.remote_type, job.location].filter(Boolean).join(" "));
  if (!text) return null;
  if (hasAny(text, REMOTE_TERMS.remote)) return "remote";
  if (hasAny(text, REMOTE_TERMS.hybrid)) return "hybrid";
  if (hasAny(text, REMOTE_TERMS.onsite)) return "onsite";
  return null;
}

export function buildJobHay(job: JobLike): string {
  return canonicalizeText(
    [
      job.title,
      job.company_name,
      job.location,
      job.country,
      ...getCountryAliases(job.country),
      job.remote_type,
      job.description,
      job.job_family,
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
      ...(job.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function computeGeoRemote(job: JobLike, geoPrefs: GeoPreferences): GeoRemoteBreakdown {
  const jobCountry = (job.country ?? "").trim().toUpperCase();
  let countryMatch: boolean | null = null;

  if (jobCountry && jobCountry.length === 2) {
    countryMatch = geoPrefs.allowAllCountries ? true : geoPrefs.allowedCountries.has(jobCountry);
  }

  const jobRemote = classifyJobRemoteType(job);
  let remoteMatch: boolean | null = null;
  if (geoPrefs.remotePreference !== "any" && jobRemote) {
    if (geoPrefs.remotePreference === "remote") {
      remoteMatch = jobRemote === "remote" || jobRemote === "hybrid";
    } else if (geoPrefs.remotePreference === "hybrid") {
      remoteMatch = jobRemote === "hybrid";
    } else {
      remoteMatch = jobRemote === "onsite";
    }
  }

  const considered = countryMatch !== null || remoteMatch !== null;
  if (!considered) {
    return {
      considered: false,
      country_match: null,
      remote_match: null,
      level: "unknown",
      points_awarded: 0,
    };
  }

  let points = 0;
  let level: GeoRemoteLevel = "none";

  if (countryMatch === true && remoteMatch !== false) {
    points = 2;
    level = "strong";
  } else if (remoteMatch === true || countryMatch === true) {
    points = 1;
    level = "medium";
  } else {
    points = 0;
    level = "none";
  }

  return {
    considered: true,
    country_match: countryMatch,
    remote_match: remoteMatch,
    level,
    points_awarded: points,
  };
}

function computeSkillsQuality(job: JobLike, matchedKeywords: string[]): SkillsQualityBreakdown {
  const requiredSet = new Set((job.required_skills ?? []).map(normalizeKeyword).filter(Boolean));
  const optionalSet = new Set(
    [...(job.optional_skills ?? []), ...(job.job_skills ?? []), ...(job.tags ?? [])]
      .map(normalizeKeyword)
      .filter(Boolean)
  );

  const considered = requiredSet.size > 0 || optionalSet.size > 0;
  if (!considered) {
    return {
      considered: false,
      matched_required_skills: [],
      matched_optional_skills: [],
      points_awarded: 0,
    };
  }

  const matchedRequired: string[] = [];
  const matchedOptional: string[] = [];

  for (const kw of matchedKeywords) {
    if (requiredSet.has(kw)) matchedRequired.push(kw);
    else if (optionalSet.has(kw)) matchedOptional.push(kw);
  }

  const requiredUniq = uniq(matchedRequired);
  const optionalUniq = uniq(matchedOptional);

  let points = 0;
  if (requiredUniq.length >= 3) points = 2;
  else if (requiredUniq.length >= 1) points = 1;
  else if (optionalUniq.length >= 1) points = 0.5;

  return {
    considered: true,
    matched_required_skills: requiredUniq,
    matched_optional_skills: optionalUniq,
    points_awarded: points,
  };
}

export function computeJobMatchScore(params: {
  job: JobLike;
  alertKeywords: string[];
  cvKeywords: string[];
  cvExp: CvExperience;
  geoPrefs: GeoPreferences;
  desiredRole?: string | null;
  hay?: string;
  maxShown?: number;
  topMatchThreshold?: number;
}): MatchScoreResult {
  const {
    job,
    alertKeywords,
    cvKeywords,
    cvExp,
    geoPrefs,
    desiredRole,
    hay = buildJobHay(job),
    maxShown = 2,
    topMatchThreshold = 70,
  } = params;

  const matchedAlert: string[] = [];
  const matchedCvRaw: string[] = [];
  const matchedAlertGeneric: string[] = [];
  const matchedCvGeneric: string[] = [];
  let weightedAlert = 0;
  let weightedCv = 0;

  for (const k of alertKeywords) {
    if (k && hay.includes(k)) {
      matchedAlert.push(k);
      const generic = isGenericKeyword(k);
      if (generic) matchedAlertGeneric.push(k);
      weightedAlert += generic ? WEIGHT_ALERT_GENERIC : WEIGHT_ALERT;
    }
  }

  const cvSkillMatches = detectCvSkillMatches(cvKeywords, job.title ?? "", job.description ?? "");
  const matchedCvDisplayRaw = cvSkillMatches.matches.map((m) => m.display);
  const matchedCvRawAll = cvSkillMatches.matches.map((m) => m.key);
  const matchedAlertSet = new Set(matchedAlert);
  const matchedCvDisplay = matchedCvDisplayRaw.filter((label) => {
    const base = normalizeSkillText(label.replace(/\s*\((titre|desc|titre\+desc)\)\s*$/, "").trim());
    return base && !matchedAlertSet.has(base);
  });
  matchedCvRaw.push(...matchedCvRawAll);
  weightedCv = cvSkillMatches.scoreSum * WEIGHT_CV;

  const shownAlert = matchedAlert.slice(0, maxShown);
  const maxCvShown = Math.min(5, Math.max(3, maxShown));
  const shownCv = matchedCvDisplay.slice(0, maxCvShown);

  const restAlert = Math.max(0, matchedAlert.length - shownAlert.length);
  const restCv = Math.max(0, matchedCvDisplay.length - shownCv.length);

  const matchedAll = uniq([...matchedAlert, ...matchedCvRaw]);
  const skillsQuality = computeSkillsQuality(job, matchedAll);
  const geoRemote = computeGeoRemote(job, geoPrefs);

  const cvExpValue = cvExp?.max ?? cvExp?.min ?? null;
  const jobMin = job.experience_years_min ?? null;
  const jobMax = job.experience_years_max ?? null;
  const expConsidered = cvExpValue != null && (jobMin != null || jobMax != null);
  let expOk = false;
  let expReason: string | null = null;

  if (expConsidered && cvExpValue != null) {
    let ok = true;
    if (jobMin != null) ok = ok && cvExpValue >= jobMin;
    if (jobMax != null) ok = ok && cvExpValue <= jobMax + 2;
    expOk = ok;
    if (ok) {
      if (jobMin != null) expReason = `Exp >= ${jobMin} ans`;
      else if (jobMax != null) expReason = `Exp <= ${jobMax} ans`;
      else expReason = `Exp ${cvExpValue} ans`;
    }
  }

  const dataQuality = computeDataQuality(job);
  const jobIsSparse = dataQuality.job_is_sparse;

  const profileSeedKeywords = desiredRole ? uniq([desiredRole, ...alertKeywords]) : alertKeywords;
  const roleFamily = computeRoleFamilyBreakdown({
    desiredRole,
    alertKeywords,
    cvKeywords,
    job,
  });
  const profileTokens = expandProfileTokens(buildProfileTokens(profileSeedKeywords));
  const titleText = normalizeLoose([job.title, job.company_name].filter(Boolean).join(" "));
  const metaText = normalizeLoose(
    [
      job.job_family,
      ...(job.tags ?? []),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const descText = normalizeLoose(job.description ?? "");

  const profileTextForDomain = [desiredRole, alertKeywords.join(" "), cvKeywords.join(" ")].filter(Boolean).join(" ");
  const jobTextForDomain = [
    job.job_family,
    ...(job.tags ?? []),
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const profileDomainScores = scoreDomains(profileTextForDomain);
  const jobDomainScores = scoreDomains(jobTextForDomain);
  const profileDomains = pickTopDomains(profileDomainScores, 3);
  const jobDomain = pickPrimaryDomain(jobDomainScores);
  const topProfileScore = profileDomains.length ? profileDomainScores[profileDomains[0]] ?? 0 : 0;
  const jobDomainScore = jobDomain ? jobDomainScores[jobDomain] ?? 0 : 0;
  const domainMatch = Boolean(jobDomain && profileDomains.includes(jobDomain));
  const strongMismatch =
    Boolean(jobDomain) && profileDomains.length > 0 && !domainMatch && jobDomainScore >= 2 && topProfileScore >= 2;

  const titleScoreRes = computeTokenScore(profileTokens, titleText);
  const metaScoreRes = metaText ? computeTokenScore(profileTokens, metaText) : { score: 0, matched: [] };
  const descScoreRes = descText ? computeTokenScore(profileTokens, descText) : { score: 0, matched: [] };

  const metaConsidered = metaText.length >= 3;
  const descConsidered = descText.length >= DESC_MIN_LEN;
  const weights = computeLayerWeights(jobIsSparse, metaConsidered, descConsidered);

  let baseScore =
    titleScoreRes.score * weights.title +
    (metaConsidered ? metaScoreRes.score * weights.meta : 0) +
    (descConsidered ? descScoreRes.score * weights.desc : 0);

  baseScore = Math.round(baseScore * 100);

  let capNote: string | null = null;
  if (jobIsSparse && isGenericTitle(job.title ?? "") && !metaConsidered) {
    if (baseScore > 45) {
      baseScore = 45;
      capNote = "generic_title_no_meta";
    }
  } else if (jobIsSparse && isGenericTitle(job.title ?? "")) {
    if (baseScore > 60) {
      baseScore = 60;
      capNote = "generic_title";
    }
  }
  if (strongMismatch) {
    baseScore = Math.min(baseScore, 15);
    capNote = capNote ? `${capNote}|domain_mismatch` : "domain_mismatch";
  }
  if (roleFamily.gated && roleFamily.cap_applied != null) {
    baseScore = Math.min(baseScore, roleFamily.cap_applied);
    capNote = capNote ? `${capNote}|role_family_mismatch` : "role_family_mismatch";
  }

  const cvSkillBonus = Math.min(40, cvSkillMatches.scoreSum * 4);
  const bonus =
    (expOk ? 4 : 0) + geoRemote.points_awarded * 2 + Math.round(skillsQuality.points_awarded * 2) + cvSkillBonus;

  const evidenceTitle = titleScoreRes.matched.length > 0;
  const evidenceMeta = metaScoreRes.matched.length > 0;
  const evidenceDesc = descScoreRes.matched.length > 0;
  const evidenceDomain = domainMatch;
  const evidenceGeo = geoRemote.points_awarded > 0;
  const evidenceExp = expOk;
  const evidenceSkills = skillsQuality.points_awarded > 0;
  const evidenceCvSkills = matchedCvRaw.length > 0;

  const evidenceCount = [
    evidenceTitle,
    evidenceMeta,
    evidenceDesc,
    evidenceDomain,
    evidenceGeo,
    evidenceExp,
    evidenceSkills,
    evidenceCvSkills,
  ].filter(Boolean).length;

  const sparseNeedsStrongTitle = jobIsSparse && !metaConsidered;
  const strongTitle = titleScoreRes.score >= 0.35;
  const titleVeryStrong = titleScoreRes.score >= 0.55 && !isGenericTitle(job.title ?? "");
  const effectiveEvidenceCount = evidenceCount + (titleVeryStrong && evidenceTitle ? 1 : 0);
  const passesEvidenceBase =
    (effectiveEvidenceCount >= 2 && (!sparseNeedsStrongTitle || strongTitle)) ||
    (sparseNeedsStrongTitle && titleVeryStrong);
  const passesEvidence = passesEvidenceBase && !roleFamily.gated;

  const scoreSimple = Math.min(100, Math.max(0, Math.round(baseScore)));
  const scoreSimpleFinal = passesEvidence ? scoreSimple : 0;
  let score = Math.min(100, Math.max(0, Math.round(baseScore + bonus)));
  if (roleFamily.gated && roleFamily.cap_applied != null) {
    score = Math.min(score, roleFamily.cap_applied);
  }

  const kwCount = alertKeywords.length + cvKeywords.length;
  const signalCount =
    kwCount +
    (expConsidered ? 1 : 0) +
    (geoRemote.considered ? 1 : 0) +
    (skillsQuality.considered ? 1 : 0) +
    (matchedCvRaw.length > 0 ? 1 : 0);
  const s = matchedAlert.length + matchedCvRaw.length;

  const genericMatched = uniq([...matchedAlertGeneric, ...matchedCvGeneric]);
  const tags: string[] = [];
  if (expOk && expReason) tags.push(expReason);
  if (geoRemote.considered && geoRemote.points_awarded > 0) tags.push("Geo/remote ok");
  if (matchedCvRaw.length > 0) tags.push("Competences CV detectees");
  if (roleFamily.relation === "match" && roleFamily.job_label) tags.push(`Famille metier: ${roleFamily.job_label}`);
  if (skillsQuality.points_awarded > 0) {
    tags.push(skillsQuality.matched_required_skills.length ? "Competences requises detectees" : "Competences detectees");
  }
  if (genericMatched.length > 0) tags.push("Mots-cles generiques ponderees");

  const reasons: string[] = [];
  if (roleFamily.relation === "match" && roleFamily.job_label) reasons.push(`Famille metier proche: ${roleFamily.job_label}`);
  if (titleScoreRes.matched.length) reasons.push(`Titre proche: ${titleScoreRes.matched[0]}`);
  if (metaScoreRes.matched.length) reasons.push(`Tags/skills: ${metaScoreRes.matched[0]}`);
  if (matchedCvDisplay.length) reasons.push(`CV: ${matchedCvDisplay[0]}`);
  if (skillsQuality.points_awarded > 0) {
    reasons.push(
      skillsQuality.matched_required_skills.length ? "Competences requises detectees" : "Competences detectees"
    );
  }
  if (geoRemote.considered && geoRemote.points_awarded > 0) reasons.push("Localisation/remote compatible");
  if (expOk) reasons.push("Experience compatible");

  if (reasons.length < 3 && shownAlert.length) reasons.push(`Alerte: ${shownAlert[0]}`);

  const missing: string[] = [];
  if (jobIsSparse) {
    missing.push("Description manquante ou courte, analyse basee sur titre/tags.");
  }
  if (roleFamily.gated && roleFamily.profile_label && roleFamily.job_label) {
    missing.push(`Famille metier incoherente: cible ${roleFamily.profile_label}, offre ${roleFamily.job_label}.`);
  }

  const alertDenom = sum(alertKeywords.map((k) => (isGenericKeyword(k) ? WEIGHT_ALERT_GENERIC : WEIGHT_ALERT)));
  const cvDenom = sum(cvKeywords.map((k) => (isGenericKeyword(k) ? WEIGHT_CV_GENERIC : WEIGHT_CV)));
  const denom =
    alertDenom +
    cvDenom +
    (expConsidered ? WEIGHT_EXP : 0) +
    (geoRemote.considered ? WEIGHT_GEO_MAX : 0) +
    (skillsQuality.considered ? WEIGHT_SKILLS_MAX : 0);

  const weighted =
    weightedAlert +
    weightedCv +
    (expOk ? WEIGHT_EXP : 0) +
    geoRemote.points_awarded +
    skillsQuality.points_awarded;

  const whyDetails: MatchWhyDetails = {
    score,
    breakdown: {
      alert: {
        total_keywords: alertKeywords.length,
        matched_keywords: matchedAlert,
        matched_count: matchedAlert.length,
        effective_weight_sum: weightedAlert,
        generic_keywords: matchedAlertGeneric,
      },
      cv: {
        total_keywords: cvKeywords.length,
        matched_keywords: matchedCvRaw,
        matched_count: matchedCvRaw.length,
        effective_weight_sum: weightedCv,
        generic_keywords: matchedCvGeneric,
      },
      experience: {
        considered: expConsidered,
        cv_exp_value: cvExpValue,
        job_min: jobMin,
        job_max: jobMax,
        ok: expOk,
        points_awarded: expOk ? WEIGHT_EXP : 0,
      },
      geo_remote: geoRemote,
      skills_quality: skillsQuality,
      generic_keyword_adjustment: {
        applied: genericMatched.length > 0,
        matched_generic_keywords: genericMatched,
        impact_note: genericMatched.length
          ? `Generic weights: alert ${WEIGHT_ALERT}=>${WEIGHT_ALERT_GENERIC}, cv ${WEIGHT_CV}=>${WEIGHT_CV_GENERIC}`
          : undefined,
      },
      role_family: roleFamily,
      data_quality: dataQuality,
      domain: {
        profile_domains: profileDomains,
        job_domain: jobDomain,
        profile_scores: profileDomainScores,
        job_scores: jobDomainScores,
        strong_mismatch: strongMismatch,
        evidence_count: effectiveEvidenceCount,
        passes_evidence: passesEvidence,
      },
      score_layers: {
        title: Math.round(titleScoreRes.score * 100),
        meta: Math.round(metaScoreRes.score * 100),
        desc: Math.round(descScoreRes.score * 100),
        combined: baseScore,
        cap_applied: capNote,
      },
    },
    debug: {
      denom,
      weighted,
      score_title: Math.round(titleScoreRes.score * 100),
      score_meta: Math.round(metaScoreRes.score * 100),
      score_desc: Math.round(descScoreRes.score * 100),
      data_quality: Math.round(dataQuality.score * 100),
      score_simple: scoreSimpleFinal,
      score_advanced: score,
      thresholds: { topMatch: topMatchThreshold },
    },
  };

  const why: MatchWhySummary = {
    alert: shownAlert,
    cv: shownCv,
    restAlert,
    restCv,
    tags,
    reasons: reasons.slice(0, 6),
    missing,
    details: whyDetails,
  };

  return {
    score,
    scoreSimple: scoreSimpleFinal,
    s,
    kwCount,
    signalCount,
    expOk,
    expConsidered,
    geoRemote,
    skillsQuality,
    dataQuality,
    jobIsSparse,
    evidenceCount: effectiveEvidenceCount,
    passesEvidence,
    domainMatch,
    domainMismatch: strongMismatch,
    roleFamily,
    scoreTitle: Math.round(titleScoreRes.score * 100),
    scoreMeta: Math.round(metaScoreRes.score * 100),
    scoreDesc: Math.round(descScoreRes.score * 100),
    scoreCombined: baseScore,
    why,
  };
}

export function formatMatchWhyTooltip(details: MatchWhyDetails): string {
  const parts = [`Score ${details.score}%`];
  const exp = details.breakdown.experience;
  if (exp.considered) parts.push(exp.ok ? "Exp ok" : "Exp off");
  const geo = details.breakdown.geo_remote;
  if (geo.considered) parts.push(`Geo ${geo.level}`);
  const skills = details.breakdown.skills_quality;
  if (skills.considered) parts.push(`Skills +${skills.points_awarded ?? 0}`);
  const roleFamily = details.breakdown.role_family;
  if (roleFamily.gated) parts.push(`Family cap ${roleFamily.cap_applied ?? 0}%`);
  else if (roleFamily.relation === "match" && roleFamily.job_family) parts.push(`Family ${roleFamily.job_family}`);
  const dq = details.breakdown.data_quality;
  parts.push(`DataQ ${Math.round(dq.score * 100)}%`);
  const layers = details.breakdown.score_layers;
  parts.push(`Title ${layers.title}%`);
  parts.push(`Meta ${layers.meta}%`);
  parts.push(`Desc ${layers.desc}%`);
  if (layers.cap_applied) parts.push(`Cap ${layers.cap_applied}`);
  if (details.breakdown.generic_keyword_adjustment.applied) parts.push("Generic downweight");
  return parts.join(" | ");
}
