export type JobRadarShadowProfileMode = "rich" | "alerts_only" | "cv_only" | "cold_start";
export type JobRadarShadowPrimarySurfaceStrategy =
  | "ranking_primary"
  | "alerts_guided_discovery"
  | "skills_family_guided_matching"
  | "recent_quality_discovery";

export type JobRadarShadowMeta = {
  profile_mode: JobRadarShadowProfileMode;
  primary_surface_strategy: JobRadarShadowPrimarySurfaceStrategy;
  fallback_reason: string | null;
};

export type JobRadarShadowBucketName = "top_match" | "for_you" | "explore";

export type JobRadarShadowRoleRelation = "match" | "adjacent" | "mismatch" | "unknown";

export type JobRadarShadowJob = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  contract_type?: string | null;
  seniority?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  description_text?: string | null;
  official_desc?: string | null;
  tags?: string[] | string | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  job_family?: string | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
  quality_status?: string | null;
};

export type JobRadarShadowBreakdown = {
  total?: number;
  title_role?: number;
  title_fallback?: number;
  meta?: number;
  alert?: number;
  skills?: number;
  geo?: number;
  experience?: number;
  role_family?: number;
  seniority_balance?: number;
  quality?: number;
  freshness?: number;
  evidence_count?: number;
  data_quality?: number;
  matched_role_terms?: string[];
  matched_alert_keywords?: string[];
  matched_required_skills?: string[];
  matched_optional_skills?: string[];
  candidate_paths?: string[];
  profile_family?: string | null;
  job_family_detected?: string | null;
  role_relation?: JobRadarShadowRoleRelation;
  penalties?: string[];
  caps?: string[];
  flags?: {
    job_non_enriched?: boolean;
    strong_underqualified?: boolean;
    overqualified_operational?: boolean;
    role_family_mismatch?: boolean;
    explicit_geo_mismatch?: boolean;
  };
};

export type JobRadarShadowExplanation = {
  summary?: string;
  reasons?: string[];
  warnings?: string[];
  breakdown?: JobRadarShadowBreakdown;
};

export type JobRadarShadowScoredCandidate = {
  job: JobRadarShadowJob;
  score: number;
  candidate_paths?: string[];
  explanation?: JobRadarShadowExplanation;
  breakdown?: JobRadarShadowBreakdown;
};

export type JobRadarShadowInvokeResponse = {
  ok?: boolean;
  profile_mode?: JobRadarShadowProfileMode;
  primary_surface_strategy?: JobRadarShadowPrimarySurfaceStrategy;
  fallback_reason?: string | null;
  top_match?: JobRadarShadowScoredCandidate[];
  for_you?: JobRadarShadowScoredCandidate[];
  explore?: JobRadarShadowScoredCandidate[];
  debug?: {
    profile_mode?: JobRadarShadowProfileMode;
    primary_surface_strategy?: JobRadarShadowPrimarySurfaceStrategy;
    candidate_pool_count?: number;
    candidate_path_counts?: Record<string, number>;
    candidate_budgets?: Record<string, number>;
    fallback_applied?: boolean;
    scored_count?: number;
    applied_excluded_count?: number;
    dismissed_excluded_count?: number;
    top_match_count?: number;
    for_you_count?: number;
    explore_count?: number;
  };
};

export type JobRadarShadowUiConfig = {
  profileMode: JobRadarShadowProfileMode | null;
  heroTitle: string;
  heroDescription: string;
  showStrictTab: boolean;
  showOnlyVeryRelevantToggle: boolean;
  largeTabLabel: string;
  preferredMode: "strict" | "large";
  suppressNoAlertsEmptyState: boolean;
  guidanceCard: {
    title: string;
    message: string;
    primaryActionLabel: string;
    primaryActionTo: string;
  } | null;
};

function humanizeFallbackReason(reason: string | null | undefined): string {
  switch (reason) {
    case "alert_signals_are_directional_but_not_strong_enough_for_high_confidence_top_match":
      return "Tes alertes donnent une bonne direction, mais il manque encore un signal fort pour construire de vrais Top Match.";
    case "cv_skills_help_detect_domain_fit_but_role_intent_is_still_implicit":
      return "Tes compÃ©tences permettent dÃ©jÃ  de repÃ©rer un domaine pertinent, mais ton rÃ´le cible reste encore implicite.";
    case "not_enough_personalization_signals_yet_for_strong_ranking":
      return "Il nâ€™y a pas encore assez dâ€™indices pour te proposer des recommandations trÃ¨s personnalisÃ©es.";
    default:
      return "";
  }
}

export function buildJobRadarShadowUi(meta: JobRadarShadowMeta | null, topCount: number): JobRadarShadowUiConfig {
  if (!meta) {
    return {
      profileMode: null,
      heroTitle: "DÃ©couvre les opportunitÃ©s du moment",
      heroDescription: "On affine l'affichage selon les signaux dÃ©jÃ  disponibles dans ton profil.",
      showStrictTab: false,
      showOnlyVeryRelevantToggle: false,
      largeTabLabel: "Explorer",
      preferredMode: "large",
      suppressNoAlertsEmptyState: false,
      guidanceCard: null,
    };
  }

  const preferredMode =
    meta.primary_surface_strategy === "alerts_guided_discovery" ||
      meta.primary_surface_strategy === "recent_quality_discovery"
      ? "large"
      : "strict";

  if (meta.profile_mode === "alerts_only") {
    return {
      profileMode: meta.profile_mode,
      heroTitle: "DÃ©couvre des offres basÃ©es sur tes alertes",
      heroDescription:
        humanizeFallbackReason(meta.fallback_reason) ||
        "On met en avant une sÃ©lection guidÃ©e par tes alertes en attendant un signal plus fort.",
      showStrictTab: false,
      showOnlyVeryRelevantToggle: false,
      largeTabLabel: "BasÃ© sur tes alertes",
      preferredMode,
      suppressNoAlertsEmptyState: true,
      guidanceCard: {
        title: "BasÃ© sur tes alertes",
        message:
          humanizeFallbackReason(meta.fallback_reason) ||
          "Ajoute un rÃ´le cible pour transformer cette dÃ©couverte guidÃ©e en recommandations plus prÃ©cises.",
        primaryActionLabel: "DÃ©finir mon rÃ´le cible",
        primaryActionTo: "/jobradar/profile",
      },
    };
  }

  if (meta.profile_mode === "cv_only") {
    return {
      profileMode: meta.profile_mode,
      heroTitle: "Des offres alignÃ©es avec tes compÃ©tences",
      heroDescription:
        humanizeFallbackReason(meta.fallback_reason) ||
        "On met en avant les offres cohÃ©rentes avec ton CV, puis on Ã©largit pour explorer davantage.",
      showStrictTab: true,
      showOnlyVeryRelevantToggle: topCount > 0,
      largeTabLabel: "Explorer",
      preferredMode,
      suppressNoAlertsEmptyState: true,
      guidanceCard: {
        title: "Affiner le rÃ´le cible",
        message:
          humanizeFallbackReason(meta.fallback_reason) ||
          "Ajoute un rÃ´le cible pour rendre les recommandations encore plus prÃ©cises.",
        primaryActionLabel: "Ajouter un rÃ´le cible",
        primaryActionTo: "/jobradar/profile",
      },
    };
  }

  if (meta.profile_mode === "cold_start") {
    return {
      profileMode: meta.profile_mode,
      heroTitle: "OpportunitÃ©s rÃ©centes pour dÃ©marrer",
      heroDescription:
        humanizeFallbackReason(meta.fallback_reason) ||
        "ComplÃ¨te ton profil pour recevoir des recommandations plus prÃ©cises.",
      showStrictTab: false,
      showOnlyVeryRelevantToggle: false,
      largeTabLabel: "OpportunitÃ©s rÃ©centes",
      preferredMode,
      suppressNoAlertsEmptyState: true,
      guidanceCard: {
        title: "ComplÃ¨te ton profil JobRadar",
        message:
          humanizeFallbackReason(meta.fallback_reason) ||
          "Plus ton profil est prÃ©cis, plus les recommandations seront utiles.",
        primaryActionLabel: "ComplÃ©ter le profil",
        primaryActionTo: "/jobradar/profile",
      },
    };
  }

  return {
    profileMode: meta.profile_mode,
    heroTitle: "PrioritÃ© aux meilleures opportunitÃ©s",
    heroDescription: "Voici les offres les plus adaptÃ©es Ã  ton profil.",
    showStrictTab: true,
    showOnlyVeryRelevantToggle: true,
    largeTabLabel: "Explorer",
    preferredMode,
    suppressNoAlertsEmptyState: true,
    guidanceCard: null,
  };
}

export function getJobRadarShadowPillLabel(meta: JobRadarShadowMeta | null, forYouCount: number): string {
  if (!meta) {
    return "Personnalisation en cours";
  }
  if (meta.profile_mode === "rich") {
    return `${forYouCount} offre${forYouCount > 1 ? "s" : ""} pour toi`;
  }
  if (meta.profile_mode === "alerts_only") return "BasÃ© sur tes alertes";
  if (meta.profile_mode === "cv_only") return "CompÃ©tences dÃ©tectÃ©es";
  return "Profil Ã  complÃ©ter";
}

export function getJobRadarShadowSubline(
  meta: JobRadarShadowMeta | null,
  matchMode: "strict" | "large"
): string {
  if (!meta) {
    return "Explorer : sÃ©lection affichÃ©e sans personnalisation forte tant que ton profil est en cours d'analyse.";
  }
  if (meta.profile_mode === "rich") {
    return matchMode === "strict"
      ? "Pour toi : offres triÃ©es par pertinence."
      : "Explorer : sÃ©lection plus large, sans filtres trop stricts.";
  }
  if (meta.profile_mode === "alerts_only") {
    return matchMode === "large"
      ? "BasÃ© sur tes alertes : une sÃ©lection de dÃ©couverte guidÃ©e pour Ã©largir les opportunitÃ©s."
      : "Pour toi : disponible quand ton profil devient plus prÃ©cis.";
  }
  if (meta.profile_mode === "cv_only") {
    return matchMode === "strict"
      ? "Pour toi : offres triÃ©es dâ€™aprÃ¨s tes compÃ©tences et ton domaine probable."
      : "Explorer : opportunitÃ©s adjacentes pour Ã©largir la recherche.";
  }
  return matchMode === "large"
    ? "OpportunitÃ©s rÃ©centes : une sÃ©lection de dÃ©part en attendant un profil plus complet."
    : "Pour toi : disponible quand ton profil est plus complet.";
}
