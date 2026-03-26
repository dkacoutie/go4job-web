import { getCountryLabel, type EmploymentType, type ExperienceLevel, type OnboardingAlertDraft, type WorkMode } from "./jobradarOnboarding";

export const ALL_COUNTRIES_CODE = "ALL";

type RolePreset = {
  id: string;
  match: RegExp;
  defaultKeywords: string[];
  sectors: string[];
  alertThemes: Array<{ name: string; keywords: string[] }>;
};

const STOP_WORDS = new Set([
  "de", "des", "du", "la", "le", "les", "un", "une", "et", "en", "a", "au", "aux", "pour", "avec", "sans", "sur", "dans", "chez", "ou",
  "poste", "emploi", "job", "role", "mission", "cdi", "cdd", "stage", "alternance", "junior", "senior", "lead", "manager", "remote", "teletravail", "hybride", "site",
]);

const ROLE_PRESETS: RolePreset[] = [
  {
    id: "data",
    match: /\b(data|analyst|analytics|analyse|bi|power\s?bi|tableau|sql|reporting|dashboard)\b/i,
    defaultKeywords: ["data analyst", "analyste data", "sql", "power bi", "reporting", "dashboard", "kpi"],
    sectors: ["Data & IA", "Finance & Ops"],
    alertThemes: [
      { name: "Analyse & reporting", keywords: ["sql", "reporting", "dashboard", "kpi"] },
      { name: "BI & visualisation", keywords: ["power bi", "tableau", "business intelligence", "data visualisation"] },
    ],
  },
  {
    id: "hr",
    match: /\b(rh|ressources?\s+humaines?|human\s+resources?|recrut|talent|paie|payroll)\b/i,
    defaultKeywords: ["ressources humaines", "recrutement", "talent acquisition", "paie", "administration du personnel"],
    sectors: ["RH & Administration", "ONG & Développement"],
    alertThemes: [
      { name: "Recrutement & talent", keywords: ["recrutement", "talent acquisition", "sourcing", "entretiens"] },
      { name: "Gestion RH", keywords: ["ressources humaines", "paie", "administration du personnel", "formation"] },
    ],
  },
  {
    id: "finance",
    match: /\b(finance|financial|audit|comptable|comptabilite|controller|controle|treasury|tresorerie)\b/i,
    defaultKeywords: ["finance", "audit", "comptabilite", "controle de gestion", "tresorerie", "reporting financier"],
    sectors: ["Finance & Ops", "ONG & Développement"],
    alertThemes: [
      { name: "Audit & contrôle", keywords: ["audit", "controle interne", "compliance", "reporting financier"] },
      { name: "Comptabilité & trésorerie", keywords: ["comptabilite", "tresorerie", "bilan", "cloture"] },
    ],
  },
  {
    id: "ngo",
    match: /\b(ong|ngo|humanitarian|programme|program|development|developpement|suivi|evaluation|monitoring|m&e)\b/i,
    defaultKeywords: ["ong", "programme", "suivi-évaluation", "reporting bailleurs", "terrain", "coordination"],
    sectors: ["ONG & Développement", "Éducation"],
    alertThemes: [
      { name: "Programmes & terrain", keywords: ["programme", "coordination", "terrain", "partenaires"] },
      { name: "Suivi-évaluation", keywords: ["suivi-évaluation", "indicateurs", "baseline", "reporting bailleurs"] },
    ],
  },
  {
    id: "marketing",
    match: /\b(marketing|growth|communication|content|seo|sea|social\s+media|brand)\b/i,
    defaultKeywords: ["marketing", "growth", "communication", "content", "seo", "social media"],
    sectors: ["Marketing & Growth", "Sales & BizDev"],
    alertThemes: [
      { name: "Acquisition & growth", keywords: ["growth", "acquisition", "seo", "campagnes"] },
      { name: "Contenu & marque", keywords: ["content", "communication", "brand", "social media"] },
    ],
  },
  {
    id: "sales",
    match: /\b(sales|commercial|business\s+developer|bizdev|account\s+manager|vente)\b/i,
    defaultKeywords: ["business development", "sales", "commercial", "prospection", "crm", "closing"],
    sectors: ["Sales & BizDev", "Marketing & Growth"],
    alertThemes: [
      { name: "Prospection & comptes", keywords: ["prospection", "crm", "account manager", "pipeline"] },
      { name: "Développement commercial", keywords: ["business development", "vente", "negociation", "closing"] },
    ],
  },
  {
    id: "product-tech",
    match: /\b(product|frontend|backend|fullstack|developer|developpeur|software|engineer|react|node|devops|cloud)\b/i,
    defaultKeywords: ["product", "software", "typescript", "api", "react", "node", "delivery"],
    sectors: ["Tech & Produit", "Data & IA"],
    alertThemes: [
      { name: "Produit & delivery", keywords: ["product", "delivery", "roadmap", "agile"] },
      { name: "Build & plateforme", keywords: ["react", "node", "api", "cloud"] },
    ],
  },
  {
    id: "ops-admin",
    match: /\b(operations|operations? manager|ops|office|admin|administration|procurement|supply|logistique)\b/i,
    defaultKeywords: ["operations", "administration", "logistique", "procurement", "coordination", "support"],
    sectors: ["Finance & Ops", "Industrie & Supply"],
    alertThemes: [
      { name: "Coordination & support", keywords: ["operations", "coordination", "support", "administration"] },
      { name: "Achats & logistique", keywords: ["procurement", "logistique", "supply", "fournisseurs"] },
    ],
  },
];

function normalizeText(input: string) {
  return (input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function uniq(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const cleaned = item.trim();
    const key = normalizeText(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function pickRolePreset(desiredRole: string) {
  return ROLE_PRESETS.find((preset) => preset.match.test(desiredRole)) ?? null;
}

function extractRoleTokens(desiredRole: string) {
  return uniq(
    normalizeText(desiredRole)
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  ).slice(0, 4);
}

function getExperienceKeywords(level: ExperienceLevel) {
  if (level === "starter") return ["débutant", "entry level", "premier poste"];
  if (level === "junior") return ["junior", "associate"];
  if (level === "intermediate") return ["confirmé", "autonome"];
  if (level === "senior") return ["senior", "lead"];
  if (level === "executive") return ["manager", "head of", "leadership"];
  return [];
}

function getEmploymentKeywords(types: EmploymentType[]) {
  const keywords: string[] = [];
  if (types.includes("cdi")) keywords.push("long terme");
  if (types.includes("contract")) keywords.push("mission");
  if (types.includes("internship")) keywords.push("stage", "alternance");
  if (types.includes("freelance")) keywords.push("freelance", "consultant");
  if (types.includes("part-time")) keywords.push("temps partiel");
  return keywords;
}

export function getWorkModeLabel(mode: WorkMode) {
  if (mode === "remote") return "Télétravail";
  if (mode === "hybrid") return "Hybride";
  return "Sur site";
}

function getWorkModeKeywords(modes: WorkMode[]) {
  return modes.map((mode) => normalizeText(getWorkModeLabel(mode)));
}

export function isAllCountriesSelection(countryCodes: string[]) {
  return countryCodes.includes(ALL_COUNTRIES_CODE);
}

export function buildCountrySelectionLabel(countryCodes: string[]) {
  if (!countryCodes.length || isAllCountriesSelection(countryCodes)) return "Tous pays";
  if (countryCodes.length === 1) return getCountryLabel(countryCodes[0]);
  return `${countryCodes.length} zones`;
}

function buildGeographyKeywords(countryCodes: string[]) {
  if (!countryCodes.length || isAllCountriesSelection(countryCodes)) return ["international", "multi-pays"];
  return countryCodes.map((code) => normalizeText(getCountryLabel(code)));
}

function buildSuggestionSignature(params: {
  desiredRole: string;
  experienceLevel: ExperienceLevel;
  countryCodes: string[];
  employmentTypes: EmploymentType[];
}) {
  return JSON.stringify({
    role: normalizeText(params.desiredRole),
    experience: params.experienceLevel,
    countries: [...params.countryCodes].sort(),
    employmentTypes: [...params.employmentTypes].sort(),
  });
}

export function buildAlertDraftSignature(draft: Pick<OnboardingAlertDraft, "name" | "keywords" | "countries" | "frequency">) {
  return JSON.stringify({
    name: normalizeText(draft.name),
    keywords: draft.keywords.map(normalizeText).sort(),
    countries: draft.countries ? [...draft.countries].sort() : null,
    frequency: draft.frequency,
  });
}

export function buildOnboardingSuggestions(params: {
  desiredRole: string;
  experienceLevel: ExperienceLevel;
  countryCodes: string[];
  employmentTypes: EmploymentType[];
  workModes?: WorkMode[];
  existingKeywords?: string[];
  existingSectors?: string[];
}) {
  const desiredRole = params.desiredRole.trim();
  const preset = pickRolePreset(desiredRole);
  const roleTokens = extractRoleTokens(desiredRole);
  const experienceKeywords = getExperienceKeywords(params.experienceLevel);
  const employmentKeywords = getEmploymentKeywords(params.employmentTypes);
  const workModeKeywords = getWorkModeKeywords(params.workModes ?? []);
  const geographyKeywords = buildGeographyKeywords(params.countryCodes);
  const geoLabel = buildCountrySelectionLabel(params.countryCodes);
  const selectedSectors = params.existingSectors?.length ? params.existingSectors : preset?.sectors ?? [];
  const baseKeywords = uniq([
    desiredRole,
    ...(params.existingKeywords ?? []),
    ...(preset?.defaultKeywords ?? []),
    ...roleTokens,
    ...experienceKeywords,
    ...employmentKeywords,
    ...workModeKeywords,
    ...geographyKeywords,
  ]).slice(0, 9);

  const sectors = uniq([...(preset?.sectors ?? []), ...(params.existingSectors ?? [])]).slice(0, 3);
  const focusA = preset?.alertThemes[0] ?? {
    name: "Opportunités ciblées",
    keywords: uniq([desiredRole, ...roleTokens]).slice(0, 4),
  };
  const focusB = preset?.alertThemes[1] ?? {
    name: isAllCountriesSelection(params.countryCodes) ? "Veille internationale" : "Veille locale",
    keywords: uniq([...roleTokens, ...geographyKeywords, ...workModeKeywords]).slice(0, 4),
  };

  const alertDrafts: OnboardingAlertDraft[] = [
    {
      id: "core-role",
      name: `${desiredRole}${params.experienceLevel ? ` • ${params.experienceLevel === "executive" ? "leadership" : params.experienceLevel}` : ""}`,
      keywords: uniq([desiredRole, ...focusA.keywords, ...experienceKeywords]).slice(0, 5),
      countries: isAllCountriesSelection(params.countryCodes) ? null : params.countryCodes,
      frequency: "daily" as const,
      rationale: `Un radar centré sur le cœur du poste recherché en ${geoLabel.toLowerCase()}.`,
    },
    {
      id: "focus-role",
      name: `${focusB.name} • ${geoLabel}`,
      keywords: uniq([
        ...(selectedSectors.length ? [selectedSectors[0]] : []),
        ...focusB.keywords,
        ...workModeKeywords,
        ...employmentKeywords,
      ]).slice(0, 5),
      countries: isAllCountriesSelection(params.countryCodes) ? null : params.countryCodes,
      frequency: (isAllCountriesSelection(params.countryCodes) ? "weekly" : "daily") as "weekly" | "daily",
      rationale: isAllCountriesSelection(params.countryCodes)
        ? "Une alerte plus ouverte pour capter les opportunités multi-pays sans surcharger le radar."
        : "Une alerte plus ciblée pour suivre rapidement les opportunités les plus proches de ton contexte.",
    },
  ].map((draft, index) => ({ ...draft, id: `${draft.id}-${index + 1}` }));

  return {
    suggestionSignature: buildSuggestionSignature(params),
    keywords: baseKeywords,
    sectors,
    alertDrafts,
  };
}
