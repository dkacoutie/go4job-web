import {
  classifyJobFamily,
  JOB_FAMILY_CLASSIFIER_VERSION,
  type JobFamilyCandidateScore,
  type JobFamilyClassification,
  type JobFamilyClassifierInput,
  type JobFamilyEvidence,
} from "./jobFamilyClassifier.ts";
import {
  JOB_FAMILY_TAXONOMY,
  type JobFamilyKey,
  normalizeTaxonomyText,
} from "./jobFamilyTaxonomy.ts";

export const JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION =
  `${JOB_FAMILY_CLASSIFIER_VERSION}+controlled_edf_v1+territorial_v1+coallia_v1+fnacdarty_v1+hlm_v1+yvelines_v1+cea_v1+hlm_ambiguous_v1+spie_job_ambiguous_v1+source_light_v1`;

type ControlledWriteOverrideMapping = {
  family_key: JobFamilyKey;
  reason: string;
  rule_id?: string;
  rule_source?: string;
  matched_value?: string;
};

type EdfStructuredMapping = ControlledWriteOverrideMapping & {
  segment: string;
};

type TerritorialTitleMapping = ControlledWriteOverrideMapping;
type CoalliaTitleMapping = ControlledWriteOverrideMapping;
type FnacDartyTitleMapping = ControlledWriteOverrideMapping;
type HlmRecruteTitleMapping = ControlledWriteOverrideMapping;
type HlmRecruteAmbiguousTitleMapping = ControlledWriteOverrideMapping;
type SpieJobAmbiguousTitleMapping = ControlledWriteOverrideMapping;
type YvelinesTitleMapping = ControlledWriteOverrideMapping;
type CeaTitleMapping = ControlledWriteOverrideMapping;
type SourceLightRuleMapping = ControlledWriteOverrideMapping & {
  confidence: "high" | "medium" | "low";
};

const EDF_SEGMENT_PATTERNS = [
  /famille professionnelle\s*\/\s*metier\s+(.+?)\s+type de contrat\b/is,
  /famille professionnelle\s+(.+?)\s+type de contrat\b/is,
  /metier\s+(.+?)\s+type de contrat\b/is,
  /famille professionnelle\s*\/\s*metier\s+(.+?)\s+description du poste\b/is,
];
const EDF_SOURCE_CODE = normalizeTaxonomyText("edf_rss");
const EMPLOI_TERRITORIAL_SOURCE_CODE = normalizeTaxonomyText(
  "emploi_territorial_rss",
);
const ADZUNA_SOURCE_CODE = normalizeTaxonomyText("adzuna_api");
const FRANCE_TRAVAIL_SOURCE_CODE = normalizeTaxonomyText("france_travail_api");
const NOFLUFFJOBS_SOURCE_CODE = normalizeTaxonomyText("rss_nofluffjobs");
const REMOTEEYEAH_SOURCE_CODE = normalizeTaxonomyText("rss_remoteyeah_all");
const COALLIA_SOURCE_CODE = normalizeTaxonomyText("coallia_rss");
const FNACDARTY_SOURCE_CODE = normalizeTaxonomyText("fnacdarty_rss");
const HLM_RECRUTE_SOURCE_CODE = normalizeTaxonomyText("hlm_recrute_rss");
const YVELINES_SOURCE_CODE = normalizeTaxonomyText("yvelines_rss");
const CEA_SOURCE_CODE = normalizeTaxonomyText("cea_rss");
const SPIE_JOB_SOURCE_CODE = normalizeTaxonomyText("spie_job_rss");

const TARGET_LIGHT_RULE_SOURCES = new Set([
  ADZUNA_SOURCE_CODE,
  FRANCE_TRAVAIL_SOURCE_CODE,
  NOFLUFFJOBS_SOURCE_CODE,
  REMOTEEYEAH_SOURCE_CODE,
  EMPLOI_TERRITORIAL_SOURCE_CODE,
]);

const SOURCE_LIGHT_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  confidence: "high" | "medium" | "low";
  title_patterns?: RegExp[];
  text_patterns?: RegExp[];
  source_codes?: string[];
}> = [
  {
    family_key: "tech_data_product_design",
    reason: "tech_remote_title",
    confidence: "medium",
    source_codes: [NOFLUFFJOBS_SOURCE_CODE, REMOTEEYEAH_SOURCE_CODE],
    title_patterns: [
      /\b(?:senior\s+|lead\s+|principal\s+)?(?:software|frontend|front end|backend|back end|full stack|fullstack|mobile|ios|android|java|python|php|ruby|go|golang|node|react|angular|vue|scala|kotlin|cloud|devops|sre|qa|test automation|data|machine learning|ml|ai|ux|ui)\b.*\b(?:engineer|developer|dev|architect|analyst|scientist|designer|manager|owner)\b/,
      /\b(?:developpeur|developpeuse|ingenieur logiciel|ingenieur devops|data analyst|data engineer|data scientist|ux designer|ui designer)\b/,
      /\b(?:technical product manager|product engineer|product engineering|product platform)\b/,
      /\b(?:product manager|product owner)\b.*\b(?:software|data|ai|ia|saas|platform|plateforme|api|cloud|backend|frontend|fullstack|engineer|engineering|security|cybersecurity|dev|developer|mobile|app|digital|ux|ui|product engineering|product platform)\b/,
      /\b(?:software|data|ai|ia|saas|platform|plateforme|api|cloud|backend|frontend|fullstack|engineer|engineering|security|cybersecurity|dev|developer|mobile|app|digital|ux|ui|product engineering|product platform)\b.*\b(?:product manager|product owner)\b/,
      /\b(?:cyber|cybersecurity|application security|security architect|security analyst|cloud security|soc|iam|devsecops)\b/,
      /\bdriver\b.*\b(?:engineer|c\+\+|c|software|kernel|nvidia|embedded|developer|backend|frontend|qa|devops|firmware|linux)\b/,
      /\b(?:engineer|c\+\+|c|software|kernel|nvidia|embedded|developer|backend|frontend|qa|devops|firmware|linux)\b.*\bdriver\b/,
    ],
    text_patterns: [
      /\b(?:typescript|javascript|python|java|kubernetes|docker|aws|azure|gcp|react|node js|sql|machine learning|figma)\b/,
    ],
  },
  {
    family_key: "tech_data_product_design",
    reason: "adzuna_it_category",
    confidence: "medium",
    source_codes: [ADZUNA_SOURCE_CODE],
    text_patterns: [
      /\bit jobs\b/,
      /\b(?:software|data|devops|frontend|backend|full stack|ux|ui|technical product manager|product engineering|product platform)\b/,
    ],
  },
  {
    family_key: "finance_accounting_audit",
    reason: "finance_accounting_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:comptable|chef comptable|directeur comptable|directeur financier|controleur de gestion|auditeur|accountant|financial controller|finance manager|bookkeeper|payroll accountant)\b/,
    ],
  },
  {
    family_key: "hr_recruitment_training",
    reason: "hr_recruitment_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:charge de recrutement|responsable rh|gestionnaire rh|recruiter|talent acquisition|hr business partner|training coordinator|formateur)\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "commercial_customer_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:business developer|business development|sales developer|developpement commercial|account executive|account manager|customer success|commercial terrain|directeur commercial|charge d affaires|conseiller clientele|teleconseiller|sales representative|sales manager)\b/,
    ],
  },
  {
    family_key: "retail_sales_checkout",
    reason: "retail_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:vendeur|vendeuse|conseiller de vente|employe commercial|hote de caisse|hotesse de caisse|caissier|caissiere|directeur de magasin|directeur supermarche|directeur retail|store manager|sales assistant)\b/,
    ],
  },
  {
    family_key: "admin_support",
    reason: "admin_support_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:assistant administratif|assistante administrative|secretaire|agent administratif|gestionnaire administratif|office assistant|administrative assistant|receptionniste)\b/,
    ],
  },
  {
    family_key: "healthcare_social_care",
    reason: "health_social_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:infirmier|infirmiere|aide soignant|aide soignante|auxiliaire de vie|medecin|educateur specialise|travailleur social|assistant social|moniteur educateur|nurse|caregiver|social worker)\b/,
    ],
  },
  {
    family_key: "hospitality_food_tourism",
    reason: "hospitality_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:cuisinier|cuisiniere|commis de cuisine|chef de cuisine|chef de partie|chef de rang|serveur|serveuse|receptionniste hotel|femme de chambre|valet de chambre|barman|barmaid|waiter|cook)\b/,
    ],
  },
  {
    family_key: "logistics_supply_warehouse",
    reason: "logistics_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:magasinier|cariste|preparateur de commandes|gestionnaire de stock|agent logistique|responsable logistique|chef d equipe logistique|warehouse|supply chain|procurement officer)\b/,
    ],
  },
  {
    family_key: "transport_delivery_driving",
    reason: "driving_delivery_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:chauffeur|conducteur routier|conducteur poids lourd|livreur|coursier|delivery driver)\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "construction_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:conducteur de travaux|chef de chantier|macon|coffreur|ferrailleur|grutier|plaquiste|charpentier|couvreur|dessinateur projeteur|economiste de la construction|site engineer|civil engineer)\b/,
    ],
  },
  {
    family_key: "craft_maintenance_repair",
    reason: "maintenance_repair_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:technicien de maintenance|technicien maintenance|electromecanicien|mecanicien|electricien|plombier|frigoriste|technicien sav|maintenance technician|service technician)\b/,
    ],
  },
  {
    family_key: "industry_production",
    reason: "industry_production_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:operateur de production|operatrice de production|agent de production|technicien production|conducteur de ligne|chef d equipe production|manufacturing engineer|production supervisor)\b/,
    ],
  },
  {
    family_key: "security_safety",
    reason: "security_safety_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:agent de securite|vigile|policier municipal|police municipale|agent de surete|gardiennage|surveillance physique|securite incendie|hse officer|security guard|security officer)\b/,
    ],
  },
  {
    family_key: "cleaning_hygiene",
    reason: "cleaning_hygiene_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:agent d entretien|agent de proprete|technicien de surface|agent de nettoyage|femme de chambre|valet de chambre|cleaner|housekeeper)\b/,
    ],
  },
  {
    family_key: "legal_compliance",
    reason: "legal_compliance_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:juriste|responsable juridique|legal counsel|compliance officer|compliance manager|contract manager|privacy officer)\b/,
    ],
  },
  {
    family_key: "marketing_communication_content",
    reason: "marketing_communication_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:charge de communication|community manager|content manager|social media manager|brand manager|marketing manager|traffic manager|copywriter)\b/,
    ],
  },
  {
    family_key: "education_research",
    reason: "education_research_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:enseignant|professeur|formateur|atsem|animateur enfance|teacher|lecturer|research assistant|research officer)\b/,
    ],
  },
  {
    family_key: "agriculture_agro",
    reason: "agriculture_agro_title",
    confidence: "medium",
    title_patterns: [
      /\b(?:ouvrier agricole|technicien agricole|responsable exploitation agricole|agronome|farm manager|agriculture officer)\b/,
    ],
  },
];

const FRANCE_TRAVAIL_ROME_LABEL_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "tech_data_product_design",
    reason: "rome_label_tech",
    patterns: [
      /\b(?:informatique|logiciel|developpement|data|systemes d information|reseaux telecom)\b/,
    ],
  },
  {
    family_key: "finance_accounting_audit",
    reason: "rome_label_finance",
    patterns: [
      /\b(?:comptabilite|finance|audit|controle de gestion|banque|assurance)\b/,
    ],
  },
  {
    family_key: "hr_recruitment_training",
    reason: "rome_label_hr",
    patterns: [
      /\b(?:ressources humaines|recrutement|formation professionnelle)\b/,
    ],
  },
  {
    family_key: "marketing_communication_content",
    reason: "rome_label_marketing",
    patterns: [
      /\b(?:marketing|communication|publicite|edition|media|contenu)\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "rome_label_commercial",
    patterns: [
      /\b(?:force de vente|relation client|commercial|vente a distance|conseil clientele)\b/,
    ],
  },
  {
    family_key: "retail_sales_checkout",
    reason: "rome_label_retail",
    patterns: [
      /\b(?:commerce de detail|mise en rayon|encaissement|vente en magasin)\b/,
    ],
  },
  {
    family_key: "admin_support",
    reason: "rome_label_admin",
    patterns: [
      /\b(?:secretariat|assistanat|support administratif|gestion administrative|accueil)\b/,
    ],
  },
  {
    family_key: "healthcare_social_care",
    reason: "rome_label_health_social",
    patterns: [
      /\b(?:sante|soins|medical|paramedical|action sociale|aide a la personne|educateur specialise)\b/,
    ],
  },
  {
    family_key: "hospitality_food_tourism",
    reason: "rome_label_hospitality",
    patterns: [
      /\b(?:hotellerie|restauration|cuisine|tourisme|service en salle)\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "rome_label_construction",
    patterns: [
      /\b(?:batiment|travaux publics|genie civil|chantier|second oeuvre|gros oeuvre)\b/,
    ],
  },
  {
    family_key: "craft_maintenance_repair",
    reason: "rome_label_maintenance",
    patterns: [
      /\b(?:maintenance|installation|reparation|depannage|electricite|plomberie|froid et climatisation)\b/,
    ],
  },
  {
    family_key: "industry_production",
    reason: "rome_label_industry",
    patterns: [
      /\b(?:industrie|production|conduite d equipement|fabrication|usinage|qualite industrielle)\b/,
    ],
  },
  {
    family_key: "logistics_supply_warehouse",
    reason: "rome_label_logistics",
    patterns: [
      /\b(?:logistique|magasinage|manutention|preparation de commandes|achats|approvisionnement|stock)\b/,
    ],
  },
  {
    family_key: "transport_delivery_driving",
    reason: "rome_label_transport",
    patterns: [
      /\b(?:transport|conduite|livraison|chauffeur|conducteur routier)\b/,
    ],
  },
  {
    family_key: "security_safety",
    reason: "rome_label_security",
    patterns: [
      /\b(?:securite|surete|gardiennage|police municipale|surveillance)\b/,
    ],
  },
  {
    family_key: "cleaning_hygiene",
    reason: "rome_label_cleaning",
    patterns: [
      /\b(?:nettoyage|proprete|hygiene des locaux|entretien des locaux)\b/,
    ],
  },
  {
    family_key: "agriculture_agro",
    reason: "rome_label_agriculture",
    patterns: [
      /\b(?:agriculture|elevage|agroalimentaire|viticulture|horticulture)\b/,
    ],
  },
];

const FRANCE_TRAVAIL_ROME_PREFIX_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  pattern: RegExp;
}> = [
  {
    family_key: "construction_trades",
    reason: "rome_prefix_f",
    pattern: /^f/i,
  },
  {
    family_key: "hospitality_food_tourism",
    reason: "rome_prefix_g",
    pattern: /^g/i,
  },
  {
    family_key: "industry_production",
    reason: "rome_prefix_h",
    pattern: /^h/i,
  },
  {
    family_key: "craft_maintenance_repair",
    reason: "rome_prefix_i",
    pattern: /^i/i,
  },
  {
    family_key: "healthcare_social_care",
    reason: "rome_prefix_j",
    pattern: /^j/i,
  },
  {
    family_key: "transport_delivery_driving",
    reason: "rome_prefix_n4",
    pattern: /^n4/i,
  },
  {
    family_key: "logistics_supply_warehouse",
    reason: "rome_prefix_n1_n3",
    pattern: /^n[13]/i,
  },
];

const EMPLOI_TERRITORIAL_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "craft_maintenance_repair",
    reason: "agent_technique_polyvalent",
    patterns: [
      /\bagent des interventions techniques polyvalent(?: en milieu rural)?\b/,
      /\bagent technique polyvalent\b/,
    ],
  },
  {
    family_key: "healthcare_social_care",
    reason: "auxiliaire_puericulture",
    patterns: [
      /\bauxiliaire de puericulture\b/,
      /\bauxiliaire en puericulture\b/,
    ],
  },
  {
    family_key: "education_research",
    reason: "atsem_animation_enfance",
    patterns: [
      /\batsem\b/,
      /\bagent territorial specialise des ecoles maternelles\b/,
      /\banimateur enfance\b/,
      /\banimateur petite enfance\b/,
    ],
  },
  {
    family_key: "security_safety",
    reason: "policier_municipal",
    patterns: [
      /\bpolicier municipal\b/,
      /\bpolice municipale\b/,
    ],
  },
];

const COALLIA_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "healthcare_social_care",
    reason: "social_action",
    patterns: [
      /\bintervenant d action sociale\b/,
      /\btravailleur social\b/,
      /\btechnicien d action sociale\b/,
      /\bias\b/,
    ],
  },
  {
    family_key: "management_project",
    reason: "social_coordination",
    patterns: [
      /\bchef de service social\b/,
      /\bcoordinateur equipe sociale\b/,
      /\bcoordinateur\b.*\bsocial\b/,
      /\bcoordo\b.*\b(ias|social)\b/,
      /\bcoordo\b/,
      /\bcds\b.*\bcph\b/,
    ],
  },
  {
    family_key: "education_research",
    reason: "animation_socioculturelle",
    patterns: [
      /\banimateur socio culturel\b/,
      /\banimateur\b.*\bsocio[- ]culturel\b/,
      /\bsocio[- ]culturel\b/,
    ],
  },
];

const FNACDARTY_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "craft_maintenance_repair",
    reason: "technicien_sav_electromenager",
    patterns: [
      /\btechnicien\b.*\bsav\b.*\belectromenager\b/,
      /\btechnicien\b.*\breparateur\b.*\belectromenager\b/,
    ],
  },
  {
    family_key: "logistics_supply_warehouse",
    reason: "magasinier_cariste",
    patterns: [
      /\bmagasinier\b/,
      /\bcariste\b/,
    ],
  },
  {
    family_key: "retail_sales_checkout",
    reason: "vendeur_explicit",
    patterns: [
      /\bvendeur(?:\s+se)?\b/,
    ],
  },
  {
    family_key: "retail_sales_checkout",
    reason: "stage_vente",
    patterns: [
      /\bstage\s+vente\b/,
    ],
  },
];

const HLM_RECRUTE_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "commercial_business_customer",
    reason: "charge_clientele",
    patterns: [
      /\bconseiller\b.*\bcharge\b.*\bclientele\b/,
      /\bcharge\b.*\bclientele\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "charge_secteur",
    patterns: [
      /\bcharge(?:\s+e)?\s+de\s+secteur\b/,
      /\bcharge\s+e\s+de\s+secteur\b/,
    ],
  },
  {
    family_key: "admin_support",
    reason: "moyens_generaux",
    patterns: [
      /\bcharge\s+des\s+moyens\s+generaux\b/,
    ],
  },
  {
    family_key: "legal_compliance",
    reason: "gestionnaire_assurance",
    patterns: [
      /\bgestionnaire\s+assurance(?:s)?\b/,
    ],
  },
];

const HLM_RECRUTE_AMBIGUOUS_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "admin_support",
    reason: "assistant_ventes",
    patterns: [
      /\bassistant ventes\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "assistant_relogement",
    patterns: [
      /\bassistant(?:\s+e)?\s+relogement\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "attache_commercial_locatif",
    patterns: [
      /\battache commercial locatif\b/,
    ],
  },
  {
    family_key: "admin_support",
    reason: "assistant_attribution",
    patterns: [
      /\bassistant attribution\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "charge_operations_patrimoine",
    patterns: [
      /\bcharge d operations patrimoine\b/,
    ],
  },
  {
    family_key: "public_ngo_development",
    reason: "coordonnateur_animation_sociale",
    patterns: [
      /\bcoordonnateur(?:\s+rice)?\b.*\banimation sociale\b/,
    ],
  },
];

const YVELINES_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "commercial_business_customer",
    reason: "teleconseiller_autonomie",
    patterns: [
      /\bteleconseiller(?:s)?\b.*\ballo autonomie\b/,
    ],
  },
  {
    family_key: "admin_support",
    reason: "assistant_admin_aides_sociales",
    patterns: [
      /\bassistant administratif\b.*\baides sociales\b/,
    ],
  },
  {
    family_key: "commercial_business_customer",
    reason: "charge_gestion_locative",
    patterns: [
      /\bcharge de gestion locative\b/,
    ],
  },
  {
    family_key: "healthcare_social_care",
    reason: "educateur_specialise",
    patterns: [
      /\beducateur specialise\b/,
    ],
  },
  {
    family_key: "finance_accounting_audit",
    reason: "assistant_referent_comptable",
    patterns: [
      /\bassistant comptable\b/,
      /\breferent comptable\b/,
    ],
  },
  {
    family_key: "security_safety",
    reason: "agent_accueil_securite",
    patterns: [
      /\bagent d accueil\b.*\bsecurite\b/,
      /\bagent d accueil et securite\b/,
    ],
  },
];

const CEA_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "tech_data_product_design",
    reason: "mesures_nucleaires",
    patterns: [
      /\btechnicien\b.*\bmesures nucleaires\b/,
      /\bingenieur\b.*\bmesures nucleaires\b/,
    ],
  },
  {
    family_key: "craft_maintenance_repair",
    reason: "charge_etudes_cvc",
    patterns: [
      /\bcharge d etudes\b.*\bcvc\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "dessinateur_cao",
    patterns: [
      /\bdessinateur\b.*\bcao\b/,
    ],
  },
];

const SPIE_JOB_AMBIGUOUS_TITLE_RULES: Array<{
  family_key: JobFamilyKey;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    family_key: "construction_trades",
    reason: "chef_chantier_electricite",
    patterns: [
      /\bchef de chantier electricite\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "chef_equipe_electricite",
    patterns: [
      /\bchef d equipe electricite\b/,
    ],
  },
  {
    family_key: "craft_maintenance_repair",
    reason: "technicien_maintenance_courants_faibles",
    patterns: [
      /\btechnicien de maintenance\b.*\bcourants faibles\b/,
    ],
  },
  {
    family_key: "construction_trades",
    reason: "chef_chantier_cvc",
    patterns: [
      /\bchef de chantier cvc\b/,
    ],
  },
];

function extractEdfStructuredSegment(
  description: string | null | undefined,
): string | null {
  const normalized = normalizeTaxonomyText(description);
  for (const pattern of EDF_SEGMENT_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function includesAny(
  segment: string,
  terms: string[],
): string | null {
  return terms.find((term) => segment.includes(term)) ?? null;
}

function mapEdfStructuredSegment(
  segment: string | null,
): EdfStructuredMapping | null {
  if (!segment) return null;
  const compactSegment = segment.replaceAll("/", " ");

  const constructionReason = includesAny(compactSegment, [
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
  ]);
  if (constructionReason) {
    return {
      family_key: "construction_trades",
      reason: constructionReason,
      segment,
    };
  }

  const maintenanceReason = includesAny(compactSegment, [
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
  ]);
  if (maintenanceReason) {
    return {
      family_key: "craft_maintenance_repair",
      reason: maintenanceReason,
      segment,
    };
  }

  const hrReason = includesAny(compactSegment, [
    "support rh",
    "ressources humaines",
    "relations sociales",
    "recrutement",
    "formation",
  ]);
  if (hrReason) {
    return {
      family_key: "hr_recruitment_training",
      reason: hrReason,
      segment,
    };
  }

  const managementReason = includesAny(compactSegment, [
    "appui au management",
    "management de projet",
    "gestion de projet",
    "encadrement",
  ]);
  if (managementReason) {
    return {
      family_key: "management_project",
      reason: managementReason,
      segment,
    };
  }

  return null;
}

function matchEmploiTerritorialTitle(
  title: string | null | undefined,
): TerritorialTitleMapping | null {
  const normalizedTitle = normalizeTaxonomyText(title).replaceAll("/", " ");
  if (!normalizedTitle) return null;

  for (const rule of EMPLOI_TERRITORIAL_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedTitle))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchCoalliaTitle(
  title: string | null | undefined,
  companyName: string | null | undefined,
): CoalliaTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(
    `${title ?? ""} ${companyName ?? ""}`.replaceAll("/", " "),
  );
  if (!normalizedText) return null;

  for (const rule of COALLIA_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchFnacDartyTitle(
  title: string | null | undefined,
  companyName: string | null | undefined,
): FnacDartyTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(
    `${title ?? ""} ${companyName ?? ""}`.replaceAll("/", " "),
  );
  if (!normalizedText) return null;

  for (const rule of FNACDARTY_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchHlmRecruteTitle(
  companyName: string | null | undefined,
): HlmRecruteTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(companyName).replaceAll(
    "/",
    " ",
  );
  if (!normalizedText) return null;

  for (const rule of HLM_RECRUTE_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchHlmRecruteAmbiguousTitle(
  companyName: string | null | undefined,
): HlmRecruteAmbiguousTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(companyName).replaceAll(
    "/",
    " ",
  );
  if (!normalizedText) return null;

  for (const rule of HLM_RECRUTE_AMBIGUOUS_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchYvelinesTitle(
  companyName: string | null | undefined,
): YvelinesTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(companyName).replaceAll(
    "/",
    " ",
  );
  if (!normalizedText) return null;

  for (const rule of YVELINES_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchCeaTitle(
  companyName: string | null | undefined,
): CeaTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(companyName).replaceAll(
    "/",
    " ",
  );
  if (!normalizedText) return null;

  for (const rule of CEA_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function matchSpieJobAmbiguousTitle(
  companyName: string | null | undefined,
): SpieJobAmbiguousTitleMapping | null {
  const normalizedText = normalizeTaxonomyText(companyName).replaceAll(
    "/",
    " ",
  );
  if (!normalizedText) return null;

  for (const rule of SPIE_JOB_AMBIGUOUS_TITLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectStringValues(
  value: unknown,
  keys: string[],
  depth = 0,
): string[] {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item, keys, depth + 1));
  }

  const record = asRecord(value);
  if (!record) return [];

  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const values: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase())) {
      values.push(...collectStringValues(entry, keys, depth + 1));
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      values.push(...collectStringValues(entry, keys, depth + 1));
    }
  }
  return values;
}

function extractJobJsonSearchText(input: JobFamilyClassifierInput): string {
  const jobJson = asRecord(input.job_json);
  if (!jobJson) return "";

  const values = collectStringValues(jobJson, [
    "category",
    "codeROME",
    "codeRome",
    "romeCode",
    "rome_code",
    "romeLibelle",
    "rome_label",
    "appellationlibelle",
    "appellationLibelle",
    "libelle",
    "metier",
    "secteurActivite",
    "typeContrat",
    "contract_time",
    "contract_type",
  ]);

  return normalizeTaxonomyText(values.join(" ")).replaceAll("/", " ");
}

function extractFranceTravailRomeCodes(
  input: JobFamilyClassifierInput,
): string[] {
  const jobJson = asRecord(input.job_json);
  if (!jobJson) return [];

  return collectStringValues(jobJson, [
    "codeROME",
    "codeRome",
    "romeCode",
    "rome_code",
  ])
    .map((value) => normalizeTaxonomyText(value).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

function findFirstRegexMatch(
  text: string,
  patterns: RegExp[] | undefined,
): string | null {
  if (!text || !patterns?.length) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return null;
}

function collectJobJsonFieldValues(
  input: JobFamilyClassifierInput,
  keys: string[],
): string[] {
  const jobJson = asRecord(input.job_json);
  if (!jobJson) return [];
  return collectStringValues(jobJson, keys)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function matchFranceTravailRome(
  input: JobFamilyClassifierInput,
): SourceLightRuleMapping | null {
  if (normalizeTaxonomyText(input.source_code) !== FRANCE_TRAVAIL_SOURCE_CODE) {
    return null;
  }

  const jsonText = extractJobJsonSearchText(input);
  const romeLabels = collectJobJsonFieldValues(input, [
    "romeLibelle",
    "rome_label",
    "appellationlibelle",
    "appellationLibelle",
    "libelle",
    "metier",
  ]);
  for (const rule of FRANCE_TRAVAIL_ROME_LABEL_RULES) {
    const matchedLabel = romeLabels.find((label) =>
      rule.patterns.some((pattern) =>
        pattern.test(normalizeTaxonomyText(label))
      )
    ) ?? findFirstRegexMatch(jsonText, rule.patterns);
    if (matchedLabel) {
      return {
        family_key: rule.family_key,
        reason: rule.reason,
        confidence: "medium",
        rule_id: rule.reason,
        rule_source: "romeLibelle",
        matched_value: matchedLabel,
      };
    }
  }

  const romeCodes = extractFranceTravailRomeCodes(input);
  const prefixMatches = FRANCE_TRAVAIL_ROME_PREFIX_RULES.filter((rule) =>
    romeCodes.some((code) => rule.pattern.test(code))
  );
  const distinctFamilies = new Set(
    prefixMatches.map((rule) => rule.family_key),
  );
  if (distinctFamilies.size !== 1) return null;
  const match = prefixMatches[0];
  if (!match) return null;
  const matchedCode = romeCodes.find((code) => match.pattern.test(code)) ?? "";

  return {
    family_key: match.family_key,
    reason: match.reason,
    confidence: "low",
    rule_id: matchedCode
      ? `rome_code_${matchedCode.toUpperCase()}`
      : match.reason,
    rule_source: "romeCode",
    matched_value: matchedCode.toUpperCase(),
  };
}

function matchSourceLightRules(
  input: JobFamilyClassifierInput,
): SourceLightRuleMapping | null {
  const sourceCode = normalizeTaxonomyText(input.source_code);
  if (!TARGET_LIGHT_RULE_SOURCES.has(sourceCode)) return null;

  const romeMapping = matchFranceTravailRome(input);
  if (romeMapping) return romeMapping;

  const title = normalizeTaxonomyText(input.title).replaceAll("/", " ");
  const combinedText = normalizeTaxonomyText([
    input.title,
    input.company_name,
    input.job_family,
    input.official_desc,
    input.description,
    Array.isArray(input.tags) ? input.tags.join(" ") : input.tags,
    extractJobJsonSearchText(input),
  ].join(" ")).replaceAll("/", " ");

  const matches = SOURCE_LIGHT_RULES.flatMap((rule) => {
    if (rule.source_codes && !rule.source_codes.includes(sourceCode)) {
      return [];
    }
    const titleMatch = findFirstRegexMatch(title, rule.title_patterns);
    if (titleMatch) {
      return [{
        family_key: rule.family_key,
        reason: rule.reason,
        confidence: rule.confidence,
        rule_id: `title_keyword_${normalizeRuleIdPart(titleMatch)}`,
        rule_source: "title",
        matched_value: titleMatch,
      }];
    }

    const textMatch = findFirstRegexMatch(combinedText, rule.text_patterns);
    if (!textMatch) return [];
    const isAdzunaItCategory = rule.reason === "adzuna_it_category" &&
      textMatch === "it jobs";
    return [{
      family_key: rule.family_key,
      reason: rule.reason,
      confidence: rule.confidence,
      rule_id: isAdzunaItCategory ? "adzuna_category_it" : rule.reason,
      rule_source: isAdzunaItCategory ? "category.label" : "text",
      matched_value: isAdzunaItCategory ? "IT Jobs" : textMatch,
    }];
  });
  const distinctFamilies = new Set(matches.map((match) => match.family_key));
  if (distinctFamilies.size !== 1) return null;

  const best = matches[0];
  if (!best) return null;
  return {
    family_key: best.family_key,
    reason: best.reason,
    confidence: best.confidence,
  };
}

function buildOverrideEvidence(
  prefix: string,
  mapping: ControlledWriteOverrideMapping,
  baseEvidence: JobFamilyEvidence[],
): JobFamilyEvidence[] {
  return [
    {
      family_key: mapping.family_key,
      family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
      source: "cross_signal",
      term: `${prefix}:${mapping.reason}`,
      weight: 8,
    },
    ...baseEvidence.slice(0, 11),
  ];
}

function normalizeRuleIdPart(value: string): string {
  return normalizeTaxonomyText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function buildOverrideRuleTrace(
  prefix: string,
  mapping: ControlledWriteOverrideMapping,
  confidence: "high" | "medium" | "low",
) {
  return {
    job_family: mapping.family_key,
    confidence,
    rule_id: mapping.rule_id ??
      `${prefix}_${normalizeRuleIdPart(mapping.reason)}`,
    rule_source: mapping.rule_source ?? prefix,
    matched_value: mapping.matched_value ?? mapping.reason,
  };
}

function buildOverrideTopCandidates(
  mapping: ControlledWriteOverrideMapping,
  base: JobFamilyClassification,
): JobFamilyCandidateScore[] {
  const current = base.top_candidates.find((candidate) =>
    candidate.family_key === mapping.family_key
  );
  const overrideCandidate: JobFamilyCandidateScore = current ?? {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    score: Math.max(18, base.score),
    source_scores: {
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
      cross_signal: 8,
    },
    matched_terms: [],
    evidence_count: 0,
    strong_title_hits: 0,
    source_count: 1,
  };

  return [
    {
      ...overrideCandidate,
      score: Math.max(18, overrideCandidate.score, base.score),
    },
    ...base.top_candidates.filter((candidate) =>
      candidate.family_key !== mapping.family_key
    ),
  ].slice(0, 3);
}

function shouldApplyEdfOverride(
  base: JobFamilyClassification,
  mapping: EdfStructuredMapping,
): boolean {
  const top1 = base.top_candidates[0]?.family_key ?? null;
  const top2 = base.top_candidates[1]?.family_key ?? null;
  const coreTarget = mapping.family_key === "construction_trades" ||
    mapping.family_key === "craft_maintenance_repair";

  return base.decision === "ambiguous" ||
    base.confidence === "low" ||
    base.decision === "uncategorized" ||
    (
      coreTarget &&
      (
        base.family_key === "management_project" ||
        base.family_key === "hr_recruitment_training" ||
        top1 === "management_project" ||
        top1 === "hr_recruitment_training" ||
        top2 === "management_project" ||
        top2 === "hr_recruitment_training"
      )
    );
}

function buildEmploiTerritorialOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (
    normalizeTaxonomyText(input.source_code) !== EMPLOI_TERRITORIAL_SOURCE_CODE
  ) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchEmploiTerritorialTitle(input.title);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence(
      "emploi_territorial_title",
      mapping,
      base.evidence,
    ),
    rule_trace: buildOverrideRuleTrace(
      "emploi_territorial_title",
      mapping,
      "medium",
    ),
  };
}

function buildSourceLightOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (base.decision === "classified" && base.confidence !== "low") return null;

  const mapping = matchSourceLightRules(input);
  if (!mapping) return null;

  const competingFamilies = new Set(
    base.top_candidates
      .filter((candidate) => candidate.score >= Math.max(10, base.score - 2))
      .map((candidate) => candidate.family_key),
  );
  if (
    competingFamilies.size > 1 && !competingFamilies.has(mapping.family_key)
  ) {
    return null;
  }

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: mapping.confidence,
    decision: "classified",
    score: Math.max(mapping.confidence === "medium" ? 18 : 14, base.score),
    margin: Math.max(mapping.confidence === "medium" ? 5 : 3, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence(
      "source_light_rule",
      mapping,
      base.evidence,
    ),
    rule_trace: buildOverrideRuleTrace(
      "source_light_rule",
      mapping,
      mapping.confidence,
    ),
  };
}

function buildCoalliaOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== COALLIA_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchCoalliaTitle(input.title, input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence("coallia_title", mapping, base.evidence),
    rule_trace: buildOverrideRuleTrace("coallia_title", mapping, "medium"),
  };
}

function buildFnacDartyOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== FNACDARTY_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchFnacDartyTitle(input.title, input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence("fnacdarty_title", mapping, base.evidence),
    rule_trace: buildOverrideRuleTrace("fnacdarty_title", mapping, "medium"),
  };
}

function buildHlmRecruteOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== HLM_RECRUTE_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchHlmRecruteTitle(input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence(
      "hlm_recrute_title",
      mapping,
      base.evidence,
    ),
    rule_trace: buildOverrideRuleTrace("hlm_recrute_title", mapping, "medium"),
  };
}

function buildHlmRecruteAmbiguousOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== HLM_RECRUTE_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "ambiguous") return null;

  const mapping = matchHlmRecruteAmbiguousTitle(input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence(
      "hlm_recrute_ambiguous_title",
      mapping,
      base.evidence,
    ),
    rule_trace: buildOverrideRuleTrace(
      "hlm_recrute_ambiguous_title",
      mapping,
      "medium",
    ),
  };
}

function buildYvelinesOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== YVELINES_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchYvelinesTitle(input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence("yvelines_title", mapping, base.evidence),
    rule_trace: buildOverrideRuleTrace("yvelines_title", mapping, "medium"),
  };
}

function buildCeaOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== CEA_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "uncategorized") return null;

  const mapping = matchCeaTitle(input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence("cea_title", mapping, base.evidence),
    rule_trace: buildOverrideRuleTrace("cea_title", mapping, "medium"),
  };
}

function buildSpieJobAmbiguousOverride(
  input: JobFamilyClassifierInput,
  base: JobFamilyClassification,
): JobFamilyClassification | null {
  if (normalizeTaxonomyText(input.source_code) !== SPIE_JOB_SOURCE_CODE) {
    return null;
  }
  if (base.decision !== "ambiguous") return null;

  const mapping = matchSpieJobAmbiguousTitle(input.company_name);
  if (!mapping) return null;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence(
      "spie_job_ambiguous_title",
      mapping,
      base.evidence,
    ),
    rule_trace: buildOverrideRuleTrace(
      "spie_job_ambiguous_title",
      mapping,
      "medium",
    ),
  };
}

export function classifyJobFamilyForControlledWrite(
  input: JobFamilyClassifierInput,
): JobFamilyClassification {
  const base = classifyJobFamily(input);
  const territorialOverride = buildEmploiTerritorialOverride(input, base);
  if (territorialOverride) return territorialOverride;
  const coalliaOverride = buildCoalliaOverride(input, base);
  if (coalliaOverride) return coalliaOverride;
  const fnacDartyOverride = buildFnacDartyOverride(input, base);
  if (fnacDartyOverride) return fnacDartyOverride;
  const hlmRecruteOverride = buildHlmRecruteOverride(input, base);
  if (hlmRecruteOverride) return hlmRecruteOverride;
  const hlmRecruteAmbiguousOverride = buildHlmRecruteAmbiguousOverride(
    input,
    base,
  );
  if (hlmRecruteAmbiguousOverride) return hlmRecruteAmbiguousOverride;
  const yvelinesOverride = buildYvelinesOverride(input, base);
  if (yvelinesOverride) return yvelinesOverride;
  const ceaOverride = buildCeaOverride(input, base);
  if (ceaOverride) return ceaOverride;
  const spieJobAmbiguousOverride = buildSpieJobAmbiguousOverride(input, base);
  if (spieJobAmbiguousOverride) return spieJobAmbiguousOverride;
  const sourceLightOverride = buildSourceLightOverride(input, base);
  if (sourceLightOverride) return sourceLightOverride;

  if (normalizeTaxonomyText(input.source_code) !== EDF_SOURCE_CODE) return base;

  const segment = extractEdfStructuredSegment(input.description);
  const mapping = mapEdfStructuredSegment(segment);
  if (!mapping || !shouldApplyEdfOverride(base, mapping)) return base;

  return {
    family_key: mapping.family_key,
    family_label: JOB_FAMILY_TAXONOMY[mapping.family_key].label,
    confidence: "medium",
    decision: "classified",
    score: Math.max(18, base.score),
    margin: Math.max(5, base.margin),
    runner_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: base.taxonomy_version,
    top_candidates: buildOverrideTopCandidates(mapping, base),
    evidence: buildOverrideEvidence("edf_segment", mapping, base.evidence),
    rule_trace: buildOverrideRuleTrace("edf_segment", mapping, "medium"),
  };
}
