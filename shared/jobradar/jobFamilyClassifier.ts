import {
  findJobFamilyByAlias,
  getJobFamilyDefinition,
  JOB_FAMILY_ORDER,
  JOB_FAMILY_TAXONOMY,
  JOB_FAMILY_TAXONOMY_VERSION,
  type JobFamilyDefinition,
  type JobFamilyKey,
  normalizeTaxonomyText,
} from "./jobFamilyTaxonomy.ts";

export const JOB_FAMILY_CLASSIFIER_VERSION = "job_family_classifier_v2_3";

export type JobFamilyInputSource =
  | "title"
  | "legacy_job_family"
  | "required_skills"
  | "job_skills"
  | "optional_skills"
  | "tags"
  | "official_desc"
  | "description"
  | "company_name"
  | "source_code"
  | "cross_signal";

export type JobFamilyClassifierInput = {
  title?: string | null;
  job_family?: string | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  job_skills?: string[] | null;
  tags?: string[] | string | null;
  official_desc?: string | null;
  description?: string | null;
  company_name?: string | null;
  source_code?: string | null;
  job_json?: Record<string, unknown> | null;
};

export type JobFamilyEvidence = {
  family_key: JobFamilyKey;
  family_label: string;
  source: JobFamilyInputSource;
  term: string;
  weight: number;
};

export type JobFamilyCandidateScore = {
  family_key: JobFamilyKey;
  family_label: string;
  score: number;
  source_scores: Record<JobFamilyInputSource, number>;
  matched_terms: JobFamilyEvidence[];
  evidence_count: number;
  strong_title_hits: number;
  source_count: number;
};

export type JobFamilyConfidence =
  | "high"
  | "medium"
  | "low"
  | "ambiguous"
  | "uncategorized";
export type JobFamilyDecision = "classified" | "ambiguous" | "uncategorized";
export type JobFamilyRuleTrace = {
  job_family: JobFamilyKey;
  confidence: JobFamilyConfidence;
  rule_id: string;
  rule_source: string;
  matched_value: string;
};

export type JobFamilyClassification = {
  family_key: JobFamilyKey;
  family_label: string;
  confidence: JobFamilyConfidence;
  decision: JobFamilyDecision;
  score: number;
  margin: number;
  runner_version: string;
  taxonomy_version: string;
  top_candidates: JobFamilyCandidateScore[];
  evidence: JobFamilyEvidence[];
  rule_trace: JobFamilyRuleTrace;
};

type TextSource = {
  source: Exclude<JobFamilyInputSource, "cross_signal">;
  text: string;
};

type SourceConfig = {
  strong_title_aliases: number;
  aliases: number;
  context_aliases: number;
  skill_aliases: number;
  company_hints: number;
  source_hints: number;
  legacy_hints: number;
  cap: number;
};

type ClassificationContext = {
  normalized_title: string;
  normalized_source_code: string;
  normalized_official_desc: string;
  normalized_description: string;
  normalized_company_name: string;
  poor_title: boolean;
  rich_description: boolean;
  rich_official_desc: boolean;
  edf_structured_segment: string;
  is_edf_source: boolean;
};

const SOURCE_CONFIG: Record<TextSource["source"], SourceConfig> = {
  title: {
    strong_title_aliases: 12,
    aliases: 8,
    context_aliases: 6,
    skill_aliases: 4,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 30,
  },
  required_skills: {
    strong_title_aliases: 0,
    aliases: 4,
    context_aliases: 3,
    skill_aliases: 5,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 15,
  },
  job_skills: {
    strong_title_aliases: 0,
    aliases: 3,
    context_aliases: 2,
    skill_aliases: 4,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 12,
  },
  optional_skills: {
    strong_title_aliases: 0,
    aliases: 2,
    context_aliases: 2,
    skill_aliases: 3,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 10,
  },
  tags: {
    strong_title_aliases: 0,
    aliases: 2,
    context_aliases: 2,
    skill_aliases: 3,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 10,
  },
  official_desc: {
    strong_title_aliases: 5,
    aliases: 4,
    context_aliases: 3,
    skill_aliases: 3,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 16,
  },
  description: {
    strong_title_aliases: 4,
    aliases: 3,
    context_aliases: 2,
    skill_aliases: 2,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 0,
    cap: 12,
  },
  company_name: {
    strong_title_aliases: 0,
    aliases: 0,
    context_aliases: 0,
    skill_aliases: 0,
    company_hints: 2,
    source_hints: 0,
    legacy_hints: 0,
    cap: 4,
  },
  source_code: {
    strong_title_aliases: 0,
    aliases: 0,
    context_aliases: 0,
    skill_aliases: 0,
    company_hints: 0,
    source_hints: 2,
    legacy_hints: 0,
    cap: 4,
  },
  legacy_job_family: {
    strong_title_aliases: 0,
    aliases: 0,
    context_aliases: 0,
    skill_aliases: 0,
    company_hints: 0,
    source_hints: 0,
    legacy_hints: 4,
    cap: 4,
  },
};

type WorkingCandidate = {
  family_key: JobFamilyKey;
  family_label: string;
  source_scores: Record<JobFamilyInputSource, number>;
  matched_terms: JobFamilyEvidence[];
  matched_term_keys: Set<string>;
  strong_title_hits: number;
};

function buildEmptySourceScores(): Record<JobFamilyInputSource, number> {
  return {
    title: 0,
    legacy_job_family: 0,
    required_skills: 0,
    job_skills: 0,
    optional_skills: 0,
    tags: 0,
    official_desc: 0,
    description: 0,
    company_name: 0,
    source_code: 0,
    cross_signal: 0,
  };
}

function toTextArray(
  value: JobFamilyClassifierInput["tags"] | string[] | null | undefined,
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .replace(/^\{|\}$/g, "")
      .split(/[,;|\n]/)
      .map((item) => item.replace(/^"+|"+$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

function hasWholeTerm(text: string, term: string): boolean {
  if (!text || !term) return false;
  return ` ${text} `.includes(` ${term} `);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function clearCandidateScore(candidate: WorkingCandidate): void {
  for (const source of Object.keys(candidate.source_scores) as JobFamilyInputSource[]) {
    candidate.source_scores[source] = 0;
  }
  candidate.strong_title_hits = 0;
}

function countAlphaCharacters(text: string): number {
  return Array.from(text).filter((char) => /[a-z]/i.test(char)).length;
}

function isPoorTitle(text: string): boolean {
  if (!text) return true;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return true;
  if (/^\d{4}[-/]\d{3,6}$/.test(compact)) return true;
  if (/^[\d\-_/]+$/.test(compact)) return true;

  const alphaCount = countAlphaCharacters(compact);
  const digitCount = Array.from(compact).filter((char) => /\d/.test(char))
    .length;
  const tokenCount = compact.split(" ").filter(Boolean).length;

  if (alphaCount < 4) return true;
  if (digitCount > alphaCount && tokenCount <= 2) return true;
  return false;
}

function buildContext(input: JobFamilyClassifierInput): ClassificationContext {
  const normalized_title = normalizeTaxonomyText(input.title);
  const normalized_official_desc = normalizeTaxonomyText(input.official_desc);
  const normalized_description = normalizeTaxonomyText(input.description);
  const normalized_source_code = normalizeTaxonomyText(input.source_code);
  const edf_structured_segment = extractEdfStructuredSegment(
    `${normalized_official_desc} ${normalized_description}`.trim(),
  );

  return {
    normalized_title,
    normalized_source_code,
    normalized_official_desc,
    normalized_description,
    normalized_company_name: normalizeTaxonomyText(input.company_name),
    poor_title: isPoorTitle(normalized_title),
    rich_description: normalized_description.length >= 140,
    rich_official_desc: normalized_official_desc.length >= 120,
    edf_structured_segment,
    is_edf_source: normalized_source_code === "edf_rss",
  };
}

function extractEdfStructuredSegment(text: string): string {
  if (!text) return "";
  const match = text.match(
    /famille professionnelle \/ metier\s+(.+?)\s+type de contrat\b/,
  );
  return (match?.[1] ?? "").trim();
}

function getSourceConfig(
  source: TextSource["source"],
  context: ClassificationContext,
): SourceConfig {
  const base = SOURCE_CONFIG[source];
  if (!context.poor_title) return base;

  if (source === "official_desc") {
    return {
      ...base,
      strong_title_aliases: base.strong_title_aliases + 1,
      aliases: base.aliases + 2,
      context_aliases: base.context_aliases + 2,
      skill_aliases: base.skill_aliases + 2,
      cap: base.cap + 8,
    };
  }

  if (source === "description") {
    return {
      ...base,
      strong_title_aliases: base.strong_title_aliases + 2,
      aliases: base.aliases + 2,
      context_aliases: base.context_aliases + 2,
      skill_aliases: base.skill_aliases + 2,
      cap: base.cap + 10,
    };
  }

  if (source === "source_code") {
    return {
      ...base,
      source_hints: base.source_hints + 1,
      cap: base.cap + 2,
    };
  }

  return base;
}

function getAliasTerms(definition: JobFamilyDefinition): string[] {
  return [
    definition.label,
    definition.short_label,
    ...definition.aliases_fr,
    ...definition.aliases_en,
  ]
    .map((item) => normalizeTaxonomyText(item))
    .filter(Boolean);
}

function countStrongSources(
  source_scores: Record<JobFamilyInputSource, number>,
): number {
  return [
    source_scores.title,
    source_scores.required_skills,
    source_scores.job_skills,
    source_scores.optional_skills,
    source_scores.tags,
    source_scores.official_desc,
    source_scores.description,
  ].filter((value) => value > 0).length;
}

function addEvidence(
  candidate: WorkingCandidate,
  source: JobFamilyInputSource,
  term: string,
  weight: number,
): void {
  const normalizedTerm = normalizeTaxonomyText(term);
  const dedupeKey = `${source}:${normalizedTerm}`;
  if (!normalizedTerm || candidate.matched_term_keys.has(dedupeKey)) return;

  candidate.matched_term_keys.add(dedupeKey);
  candidate.matched_terms.push({
    family_key: candidate.family_key,
    family_label: candidate.family_label,
    source,
    term,
    weight,
  });
}

function scoreBucket(
  candidate: WorkingCandidate,
  source: TextSource["source"],
  text: string,
  terms: string[],
  weight: number,
): number {
  let score = 0;
  if (weight <= 0) return score;

  for (const term of terms) {
    const normalizedTerm = normalizeTaxonomyText(term);
    if (!normalizedTerm || !hasWholeTerm(text, normalizedTerm)) continue;
    score += weight;
    addEvidence(candidate, source, term, weight);
    if (source === "title" && weight >= 12) candidate.strong_title_hits += 1;
  }

  return score;
}

function scoreSource(
  candidate: WorkingCandidate,
  definition: JobFamilyDefinition,
  payload: TextSource,
  context: ClassificationContext,
): void {
  if (!payload.text) return;
  const config = getSourceConfig(payload.source, context);
  let score = 0;

  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.strong_title_aliases,
    config.strong_title_aliases,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    getAliasTerms(definition),
    config.aliases,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.context_aliases,
    config.context_aliases,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.skill_aliases,
    config.skill_aliases,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.company_hints,
    config.company_hints,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.source_hints,
    config.source_hints,
  );
  score += scoreBucket(
    candidate,
    payload.source,
    payload.text,
    definition.legacy_hints,
    config.legacy_hints,
  );

  candidate.source_scores[payload.source] += Math.min(config.cap, score);
}

function applyCrossSignalBonus(
  candidate: WorkingCandidate,
  context: ClassificationContext,
): void {
  const hasTitle = candidate.source_scores.title > 0;
  const hasSkillSignal = candidate.source_scores.required_skills > 0 ||
    candidate.source_scores.job_skills > 0 ||
    candidate.source_scores.optional_skills > 0 ||
    candidate.source_scores.tags > 0;
  const hasDesc = candidate.source_scores.official_desc > 0 ||
    candidate.source_scores.description > 0;
  const strongSources = countStrongSources(candidate.source_scores);

  let bonus = 0;
  if (hasTitle && hasSkillSignal) bonus += 4;
  if (hasTitle && hasDesc) bonus += 3;
  if (strongSources >= 2) bonus += 2;
  if (strongSources >= 3) bonus += 1;
  if (!hasTitle && context.poor_title && hasDesc) bonus += 3;
  if (
    context.poor_title &&
    candidate.source_scores.official_desc > 0 &&
    candidate.source_scores.description > 0
  ) {
    bonus += 2;
  }

  candidate.source_scores.cross_signal += Math.min(6, bonus);
}

function addBonus(
  candidate: WorkingCandidate,
  source: JobFamilyInputSource,
  term: string,
  weight: number,
): void {
  if (weight <= 0) return;
  candidate.source_scores[source] += weight;
  addEvidence(candidate, source, term, weight);
}

function applyTitleDisambiguation(
  candidate: WorkingCandidate,
  context: ClassificationContext,
): void {
  const title = context.normalized_title.replaceAll("/", " ");
  const combinedText = normalizeTaxonomyText([
    context.normalized_title,
    context.normalized_company_name,
    context.normalized_source_code,
    context.normalized_official_desc,
    context.normalized_description,
  ].join(" ")).replaceAll("/", " ");
  const hasBusinessDevelopmentTitle = matchesAny(title, [
    /\b(?:business developer|business development|sales developer|developpement commercial)\b/,
  ]);
  const hasCommercialContext = matchesAny(combinedText, [
    /\b(?:commercial|sales|business|vente|client|customer|account|prospection|crm|secteur|marche|market)\b/,
  ]);
  const hasProductManagerTitle = matchesAny(title, [
    /\b(?:product manager|product owner)\b/,
  ]);
  const hasProductTitle = hasProductManagerTitle || matchesAny(title, [
    /\b(?:product|produit)\b/,
  ]);
  const hasExplicitProductTechTitleSignal = matchesAny(title, [
    /\b(?:software|saas|ai|ia|data science|data engineer|analytics|platform|plateforme|api|cloud|backend|frontend|fullstack|engineer|engineering|security|cybersecurity|mobile|app|ux|ui|digital|technical product)\b/,
  ]);
  const hasExplicitProductTechSignal = matchesAny(combinedText, [
    /\b(?:software|data|ai|ia|saas|platform|plateforme|api|cloud|backend|frontend|fullstack|engineer|engineering|security|cybersecurity|dev|developer|mobile|app|digital|ux|ui|product engineering|product platform|data science|technical product)\b/,
  ]);
  const hasNonTechProductSignal = matchesAny(combinedText, [
    /\b(?:equipement|outillage|distribution|post purchase|assurance|actuariat|finance|automotive|retail|supply|logistics|logistique|magasin|commerce)\b/,
    /\bhardware\b(?!.*\b(?:software|firmware|embedded|computer|informatique)\b)/,
  ]);
  const hasNonTechStrongTitleSignal = matchesAny(title, [
    /\b(?:actuariat|assurance|assurance de personnes|offre de conseil|finance|comptabilite|audit|banque|immobilier|juridique|rh|marketing|commercial|distribution|retail|outillage|equipement)\b/,
  ]);
  const hasExplicitDataTechTitle = matchesAny(title, [
    /\b(?:data engineer|data scientist|data analyst|data science|analytics engineer|bi developer|machine learning|ml engineer)\b/,
  ]);

  if (candidate.family_key === "public_ngo_development") {
    const hasExplicitNgoSignal = matchesAny(combinedText, [
      /\b(?:ong|ngo|humanitaire|institutionnel|cooperation|developpement international|programme social|association|bailleur|projet de developpement|solidarite|aide humanitaire|public sector|donor|united nations|grant|monitoring and evaluation)\b/,
    ]);
    if (!hasExplicitNgoSignal) clearCandidateScore(candidate);
    return;
  }

  if (candidate.family_key === "security_safety") {
    const hasTechSecurityTitle = matchesAny(title, [
      /\b(?:cyber|cybersecurity|application security|security architect|security analyst|cloud security|soc|iam|devsecops)\b/,
    ]);
    const hasPhysicalSecurityTitle = matchesAny(title, [
      /\b(?:agent de securite|gardiennage|surete|surveillance physique|vigile|securite incendie|security guard|security officer|hse officer)\b/,
    ]);
    if (hasTechSecurityTitle && !hasPhysicalSecurityTitle) {
      clearCandidateScore(candidate);
    }
    return;
  }

  if (candidate.family_key === "transport_delivery_driving") {
    const hasDriver = /\bdriver\b/.test(title);
    const hasTechDriverContext = matchesAny(title, [
      /\b(?:engineer|c\+\+|c|software|kernel|nvidia|embedded|developer|backend|frontend|qa|devops|firmware|linux)\b/,
    ]);
    if (hasDriver && hasTechDriverContext) clearCandidateScore(candidate);
    return;
  }

  if (candidate.family_key === "tech_data_product_design") {
    if (hasBusinessDevelopmentTitle && hasCommercialContext) {
      clearCandidateScore(candidate);
      return;
    }

    if (
      hasProductTitle &&
      (!hasExplicitProductTechTitleSignal ||
        (hasProductManagerTitle && hasNonTechProductSignal))
    ) {
      clearCandidateScore(candidate);
      return;
    }

    if (
      /\bdata\b/.test(title) &&
      hasNonTechStrongTitleSignal &&
      !hasExplicitDataTechTitle
    ) {
      clearCandidateScore(candidate);
      return;
    }

    if (hasProductTitle && hasExplicitProductTechSignal) {
      addBonus(candidate, "title", "tech_product_title", 12);
      candidate.strong_title_hits += 1;
    }

    if (
      matchesAny(title, [
        /\b(?:cyber|cybersecurity|application security|security architect|security analyst|cloud security|soc|iam|devsecops)\b/,
      ])
    ) {
      addBonus(candidate, "cross_signal", "tech_security_title", 8);
    }

    if (
      /\bdriver\b/.test(title) &&
      matchesAny(title, [
        /\b(?:engineer|c\+\+|c|software|kernel|nvidia|embedded|developer|backend|frontend|qa|devops|firmware|linux)\b/,
      ])
    ) {
      addBonus(candidate, "cross_signal", "tech_driver_title", 12);
    }
    return;
  }

  if (
    candidate.family_key === "commercial_business_customer" &&
    hasBusinessDevelopmentTitle &&
    hasCommercialContext
  ) {
    addBonus(candidate, "cross_signal", "business_development_commercial", 8);
  }
}

function applyBoilerplatePenalties(
  candidate: WorkingCandidate,
  context: ClassificationContext,
): void {
  if (!context.poor_title) return;

  const onlyDescDriven = candidate.source_scores.title === 0 &&
    candidate.source_scores.required_skills === 0 &&
    candidate.source_scores.job_skills === 0 &&
    candidate.source_scores.optional_skills === 0 &&
    candidate.source_scores.tags === 0 &&
    candidate.source_scores.company_name === 0;

  if (!onlyDescDriven) return;

  if (
    candidate.family_key === "legal_compliance" &&
    candidate.source_scores.description > 0
  ) {
    candidate.source_scores.description = Math.max(
      0,
      candidate.source_scores.description - 6,
    );
  }

  if (
    candidate.family_key === "security_safety" &&
    candidate.source_scores.description > 0 &&
    candidate.source_scores.official_desc === 0
  ) {
    candidate.source_scores.description = Math.max(
      0,
      candidate.source_scores.description - 2,
    );
  }
}

function applySourceSpecificHeuristics(
  candidate: WorkingCandidate,
  context: ClassificationContext,
): void {
  if (!context.poor_title) return;
  const combinedText =
    `${context.normalized_official_desc} ${context.normalized_description}`
      .trim();
  if (!combinedText) return;

  const isSpie = context.normalized_source_code.includes("spie");
  if (!isSpie) return;

  if (candidate.family_key === "craft_maintenance_repair") {
    const maintenanceSignals = [
      "maintenance",
      "troubleshooting",
      "cmms",
      "turbine",
      "compressor",
      "generator",
      "turbo generator",
      "turbo compressor",
      "field technician",
      "rotating equipment",
    ];
    const matched = maintenanceSignals.filter((term) =>
      hasWholeTerm(combinedText, normalizeTaxonomyText(term))
    );
    if (matched.length >= 2) {
      addBonus(
        candidate,
        "cross_signal",
        `spie_maintenance:${matched[0]}`,
        Math.min(8, 3 + matched.length),
      );
    }
  }

  if (candidate.family_key === "logistics_supply_warehouse") {
    const logisticsSignals = [
      "lifting operations",
      "rigging",
      "offloading",
      "crane",
      "winch",
      "forklift",
      "material transfer",
      "support vessel",
    ];
    const matched = logisticsSignals.filter((term) =>
      hasWholeTerm(combinedText, normalizeTaxonomyText(term))
    );
    if (matched.length >= 2) {
      addBonus(
        candidate,
        "cross_signal",
        `spie_logistics:${matched[0]}`,
        Math.min(8, 3 + matched.length),
      );
    }
  }

  if (candidate.family_key === "industry_production") {
    const industrySignals = [
      "production",
      "plant",
      "process",
      "operations",
      "auxiliary systems",
    ];
    const matched = industrySignals.filter((term) =>
      hasWholeTerm(combinedText, normalizeTaxonomyText(term))
    );
    if (matched.length >= 3) {
      addBonus(
        candidate,
        "cross_signal",
        `spie_industry:${matched[0]}`,
        4,
      );
    }
  }
}

function toCandidateScore(
  candidate: WorkingCandidate,
): JobFamilyCandidateScore {
  const score = Object.values(candidate.source_scores).reduce(
    (sum, value) => sum + value,
    0,
  );
  return {
    family_key: candidate.family_key,
    family_label: candidate.family_label,
    score,
    source_scores: candidate.source_scores,
    matched_terms: candidate.matched_terms.slice(0, 16),
    evidence_count: candidate.matched_terms.length,
    strong_title_hits: candidate.strong_title_hits,
    source_count: countStrongSources(candidate.source_scores),
  };
}

function normalizeRuleIdPart(value: string): string {
  return normalizeTaxonomyText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function buildRuleTrace(
  familyKey: JobFamilyKey,
  confidence: JobFamilyConfidence,
  fallbackRuleId: string,
  fallbackRuleSource: string,
  fallbackMatchedValue: string,
  evidence: JobFamilyEvidence[],
): JobFamilyRuleTrace {
  const firstEvidence = evidence[0] ?? null;
  const ruleSource = firstEvidence?.source ?? fallbackRuleSource;
  const matchedValue = firstEvidence?.term ?? fallbackMatchedValue;
  const ruleId = firstEvidence
    ? `${ruleSource}_${normalizeRuleIdPart(matchedValue)}`
    : fallbackRuleId;

  return {
    job_family: familyKey,
    confidence,
    rule_id: ruleId,
    rule_source: ruleSource,
    matched_value: matchedValue,
  };
}

function buildPayloads(input: JobFamilyClassifierInput): TextSource[] {
  return [
    { source: "title", text: normalizeTaxonomyText(input.title) },
    {
      source: "legacy_job_family",
      text: normalizeTaxonomyText(input.job_family),
    },
    {
      source: "required_skills",
      text: normalizeTaxonomyText(toTextArray(input.required_skills).join(" ")),
    },
    {
      source: "job_skills",
      text: normalizeTaxonomyText(toTextArray(input.job_skills).join(" ")),
    },
    {
      source: "optional_skills",
      text: normalizeTaxonomyText(toTextArray(input.optional_skills).join(" ")),
    },
    {
      source: "tags",
      text: normalizeTaxonomyText(toTextArray(input.tags).join(" ")),
    },
    {
      source: "official_desc",
      text: normalizeTaxonomyText(input.official_desc),
    },
    { source: "description", text: normalizeTaxonomyText(input.description) },
    { source: "company_name", text: normalizeTaxonomyText(input.company_name) },
    { source: "source_code", text: normalizeTaxonomyText(input.source_code) },
  ];
}

function isAdjacent(primary: JobFamilyKey, secondary: JobFamilyKey): boolean {
  return JOB_FAMILY_TAXONOMY[primary].adjacent_families.includes(secondary);
}

type EdfStructuredMapping = {
  family_key: JobFamilyKey;
  reason: string;
  segment: string;
};

function getEdfStructuredSearchText(context: ClassificationContext): string {
  return normalizeTaxonomyText([
    context.edf_structured_segment,
    context.normalized_official_desc,
    context.normalized_description,
  ].join(" "))
    .replaceAll("/", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapEdfStructuredSegment(
  context: ClassificationContext,
): EdfStructuredMapping | null {
  if (
    !context.is_edf_source || !context.poor_title ||
    !context.edf_structured_segment
  ) {
    return null;
  }

  const edfSearchText = getEdfStructuredSearchText(context);
  const segment = context.edf_structured_segment.replaceAll("/", " ");

  const hasHrSignal = edfSearchText.includes("support rh") ||
    edfSearchText.includes("ressources humaines") ||
    edfSearchText.includes("relations sociales") ||
    edfSearchText.includes("recrutement") ||
    edfSearchText.includes("formation");

  const hasExplicitManagementSignal =
    edfSearchText.includes("appui au management") ||
    edfSearchText.includes("management de projet") ||
    edfSearchText.includes("gestion de projet") ||
    edfSearchText.includes("responsable d equipe") ||
    edfSearchText.includes("chef d equipe") ||
    edfSearchText.includes("encadrement");

  const constructionSignals = [
    "etudes real ouvr res elec",
    "realisation d ouvrages",
    "etudes d ouvrages",
    "etudes ouvrages",
    "genie civil",
    "travaux",
    "chantier",
    "lots techniques",
    "etudes d execution",
    "renovation energetique",
    "maitrise de realisation",
    "surveillance de realisation",
    "ingenierie de conception",
  ];
  for (const signal of constructionSignals) {
    if (segment.includes(signal)) {
      return {
        family_key: "construction_trades",
        reason: `edf_segment:${signal}`,
        segment: context.edf_structured_segment,
      };
    }
  }

  const maintenanceSignals = [
    "interventions reseau elec",
    "interventions specialisees",
    "interventions de proximite",
    "exploitation conduite fonctionnement",
    "surveillance et intervention",
    "meca chaudronnerie robinetterie materiaux",
    "maintenance",
    "chaudronnerie",
    "robinetterie",
    "automatismes electronique info indust",
    "automatismes",
    "electrotechnique",
    "intervention",
    "efficacite energetique",
  ];
  for (const signal of maintenanceSignals) {
    if (segment.includes(signal)) {
      return {
        family_key: "craft_maintenance_repair",
        reason: `edf_segment:${signal}`,
        segment: context.edf_structured_segment,
      };
    }
  }

  if (hasHrSignal) {
    return {
      family_key: "hr_recruitment_training",
      reason: "edf_segment:rh",
      segment: context.edf_structured_segment,
    };
  }

  if (hasExplicitManagementSignal) {
    return {
      family_key: "management_project",
      reason: "edf_segment:explicit_management",
      segment: context.edf_structured_segment,
    };
  }

  return null;
}

function buildEdfStructuredOverride(
  context: ClassificationContext,
  primary: JobFamilyCandidateScore | undefined,
  secondary: JobFamilyCandidateScore | undefined,
  top_candidates: JobFamilyCandidateScore[],
  margin: number,
): JobFamilyClassification | null {
  const mapping = mapEdfStructuredSegment(context);
  if (!mapping) return null;

  const shouldOverride = !primary ||
    margin < 5 ||
    primary.family_key === "management_project" ||
    primary.family_key === "hr_recruitment_training" ||
    primary.family_key === "other_uncategorized";
  if (!shouldOverride) return null;

  const competitor = primary?.family_key === mapping.family_key
    ? secondary
    : primary;
  const resolvedMargin = Math.max(
    5,
    primary?.family_key === mapping.family_key
      ? margin
      : (primary?.score ?? 0) > 0
      ? 18 - (primary?.score ?? 0)
      : 5,
  );

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, primary?.score ?? 0, (competitor?.score ?? 0) + 5),
    margin: resolvedMargin,
    runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
    taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
    top_candidates,
    evidence: [
      {
        family_key: mapping.family_key,
        family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
        source: "cross_signal",
        term: mapping.reason,
        weight: 8,
      },
    ],
    rule_trace: {
      job_family: mapping.family_key,
      confidence: "medium",
      rule_id: mapping.reason.replace(/[^a-zA-Z0-9]+/g, "_").replace(
        /^_+|_+$/g,
        "",
      ),
      rule_source: "edf_segment",
      matched_value: mapping.segment,
    },
  };
}

export function classifyJobFamily(
  input: JobFamilyClassifierInput,
): JobFamilyClassification {
  const context = buildContext(input);
  const payloads = buildPayloads(input);

  const candidates = JOB_FAMILY_ORDER
    .filter((familyKey) => familyKey !== "other_uncategorized")
    .map((familyKey) => {
      const definition = getJobFamilyDefinition(familyKey);
      const working: WorkingCandidate = {
        family_key: familyKey,
        family_label: definition.label,
        source_scores: buildEmptySourceScores(),
        matched_terms: [],
        matched_term_keys: new Set<string>(),
        strong_title_hits: 0,
      };

      for (const payload of payloads) {
        scoreSource(working, definition, payload, context);
      }
      applyTitleDisambiguation(working, context);
      applySourceSpecificHeuristics(working, context);
      applyBoilerplatePenalties(working, context);
      applyCrossSignalBonus(working, context);

      return toCandidateScore(working);
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.strong_title_hits !== left.strong_title_hits) {
        return right.strong_title_hits - left.strong_title_hits;
      }
      return right.evidence_count - left.evidence_count;
    });

  const top_candidates = candidates.slice(0, 3);
  const primary = top_candidates[0];
  const secondary = top_candidates[1];
  const margin = primary && secondary
    ? primary.score - secondary.score
    : primary?.score ?? 0;
  const mappedLegacy = findJobFamilyByAlias(input.job_family);
  const strongSourceCount = primary ? primary.source_count : 0;
  const descScore = primary
    ? primary.source_scores.official_desc + primary.source_scores.description
    : 0;
  const edfStructuredOverride = buildEdfStructuredOverride(
    context,
    primary,
    secondary,
    top_candidates,
    margin,
  );
  const hasStrongEvidence = Boolean(
    primary &&
      (primary.strong_title_hits > 0 ||
        primary.source_scores.required_skills >= 5 ||
        primary.source_scores.job_skills >= 8 ||
        strongSourceCount >= 2 ||
        (context.poor_title && descScore >= 12)),
  );
  const adjacentCompetition = Boolean(
    primary && secondary &&
      isAdjacent(primary.family_key, secondary.family_key),
  );

  if (edfStructuredOverride) return edfStructuredOverride;

  if (!primary || primary.score < 10 || !hasStrongEvidence) {
    return {
      family_key: "other_uncategorized",
      family_label: JOB_FAMILY_TAXONOMY.other_uncategorized.label,
      confidence: "uncategorized",
      decision: "uncategorized",
      score: primary?.score ?? 0,
      margin: primary ? margin : 0,
      runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
      taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
      top_candidates,
      evidence: top_candidates.flatMap((candidate) => candidate.matched_terms)
        .slice(0, 12),
      rule_trace: buildRuleTrace(
        "other_uncategorized",
        "uncategorized",
        "uncategorized_no_strong_signal",
        "classifier",
        "",
        top_candidates.flatMap((candidate) => candidate.matched_terms).slice(
          0,
          12,
        ),
      ),
    };
  }

  if (
    primary.score >= 24 && margin >= 8 &&
    (strongSourceCount >= 2 || primary.strong_title_hits > 0)
  ) {
    return {
      family_key: primary.family_key,
      family_label: primary.family_label,
      confidence: "high",
      decision: "classified",
      score: primary.score,
      margin,
      runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
      taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
      top_candidates,
      evidence: primary.matched_terms.slice(0, 12),
      rule_trace: buildRuleTrace(
        primary.family_key,
        "high",
        "classifier_high_score",
        "classifier",
        primary.family_label,
        primary.matched_terms.slice(0, 12),
      ),
    };
  }

  if (
    primary.score >= 16 && margin >= 5 &&
    (
      strongSourceCount >= 2 ||
      primary.strong_title_hits > 0 ||
      (context.poor_title && descScore >= 14)
    )
  ) {
    return {
      family_key: primary.family_key,
      family_label: primary.family_label,
      confidence: "medium",
      decision: "classified",
      score: primary.score,
      margin,
      runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
      taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
      top_candidates,
      evidence: primary.matched_terms.slice(0, 12),
      rule_trace: buildRuleTrace(
        primary.family_key,
        "medium",
        "classifier_medium_score",
        "classifier",
        primary.family_label,
        primary.matched_terms.slice(0, 12),
      ),
    };
  }

  if (
    primary.score >= 12 && margin >= 3 &&
    (strongSourceCount >= 2 || primary.strong_title_hits > 0 ||
      (context.poor_title && descScore >= 10) ||
      (adjacentCompetition && margin >= 2))
  ) {
    return {
      family_key: primary.family_key,
      family_label: primary.family_label,
      confidence: "low",
      decision: "classified",
      score: primary.score,
      margin,
      runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
      taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
      top_candidates,
      evidence: primary.matched_terms.slice(0, 12),
      rule_trace: buildRuleTrace(
        primary.family_key,
        "low",
        "classifier_low_score",
        "classifier",
        primary.family_label,
        primary.matched_terms.slice(0, 12),
      ),
    };
  }

  const ambiguousEvidence = top_candidates.flatMap((candidate) =>
    candidate.matched_terms
  ).slice(0, 12);
  const ambiguousFamily = mappedLegacy && mappedLegacy !== "other_uncategorized"
    ? mappedLegacy
    : "other_uncategorized";
  const ambiguousConfidence = "ambiguous";
  return {
    family_key: ambiguousFamily,
    family_label: JOB_FAMILY_TAXONOMY[ambiguousFamily].label,
    confidence: ambiguousConfidence,
    decision: "ambiguous",
    score: primary.score,
    margin,
    runner_version: JOB_FAMILY_CLASSIFIER_VERSION,
    taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
    top_candidates,
    evidence: ambiguousEvidence,
    rule_trace: buildRuleTrace(
      ambiguousFamily,
      ambiguousConfidence,
      "ambiguous_competing_signals",
      "classifier",
      primary.family_label,
      ambiguousEvidence,
    ),
  };
}
