export type JobRadarAdvisorTone = "neutral" | "focus" | "success";

export type JobRadarAdvisorCopy = {
  eyebrow?: string;
  title: string;
  description?: string;
  ctaLabel?: string;
  tone?: JobRadarAdvisorTone;
};

type JobRadarAdvisorPreset =
  | { key: "onboarding-preferences" }
  | { key: "onboarding-preview"; mode: "match" | "nearby"; hasCv: boolean }
  | { key: "cv"; status: "empty" | "ready_to_analyze" | "analyzed" }
  | { key: "alerts"; mode: "onboarding" | "default" | "checkout" }
  | { key: "feed"; mode: "needs_cv" | "needs_alerts" | "needs_profile" };

const DEFAULT_EYEBROW = "Conseiller JobRadar";

export function getJobRadarAdvisorCopy(preset: JobRadarAdvisorPreset): JobRadarAdvisorCopy {
  switch (preset.key) {
    case "onboarding-preferences":
      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Bon début : ta recherche devient plus précise.",
        description: "JobRadar a déjà préparé un profil de recherche utile pour toi. Tu peux le garder tel quel ou l’ajuster en quelques secondes.",
        ctaLabel: "Voir mes offres",
        tone: "focus",
      };

    case "onboarding-preview":
      if (preset.mode === "match") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres semblent déjà bien alignées.",
          description: "Ton objectif ressort déjà clairement. En continuant, JobRadar pourra élargir cette sélection.",
          ctaLabel: "Débloquer toutes les offres",
          tone: "success",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ces offres sont proches de ton objectif.",
        description: preset.hasCv
          ? "Tu as déjà un profil de recherche utile. Quelques ajustements peuvent maintenant faire ressortir les offres les plus adaptées."
          : "Tu as déjà un profil de recherche utile. Ajoute ton CV pour obtenir des offres mieux ciblées.",
        ctaLabel: preset.hasCv ? "Ajuster mes critères" : "Ajouter mon CV",
        tone: "focus",
      };

    case "cv":
      if (preset.status === "analyzed") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est pret. Active maintenant tes alertes.",
          description: "Les informations utiles sont déjà en place. L’étape la plus utile maintenant est de lancer tes alertes.",
          ctaLabel: "Activer mes alertes",
          tone: "success",
        };
      }

      if (preset.status === "ready_to_analyze") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est déjà en place.",
          description: "Lance l'analyse pour transformer ce document en informations utiles.",
          ctaLabel: "Analyser mon CV",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ajoute ton CV pour affiner encore tes resultats.",
        description: "JobRadar l'utilise pour mieux comprendre ton parcours et mieux classer les offres qui te ressemblent.",
        ctaLabel: "Téléverser mon CV",
        tone: "focus",
      };

    case "alerts":
      if (preset.mode === "checkout") {
        return {
          eyebrow: DEFAULT_EYEBROW,
        title: "Tes alertes sont prêtes.",
          description: "Active un pass pour les lancer.",
          ctaLabel: "Voir les pass disponibles",
          tone: "neutral",
        };
      }

      if (preset.mode === "onboarding") {
        return {
          eyebrow: DEFAULT_EYEBROW,
        title: "Active tes alertes pour suivre les nouvelles opportunités.",
        description: "Tes alertes préparées peuvent surveiller les offres pendant que tu avances dans ton démarrage.",
          ctaLabel: "Voir les alertes pretes",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes alertes surveillent les offres pour toi.",
        description: "Une alerte précise t’aide à repérer au bon moment les opportunités qui correspondent à ta recherche.",
        ctaLabel: "Creer une alerte",
        tone: "neutral",
      };

    case "feed":
      if (preset.mode === "needs_cv") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Il manque encore une information utile.",
          description: "Ajoute ton CV pour mieux distinguer les offres proches de ton objectif.",
          ctaLabel: "Ajouter mon CV",
          tone: "focus",
        };
      }

      if (preset.mode === "needs_alerts") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres sont proches de ta recherche.",
          description: "Une alerte plus précise peut faire remonter ce qui compte vraiment pour toi.",
          ctaLabel: "Ajuster mes alertes",
          tone: "neutral",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes offres se précisent et peuvent être encore mieux ciblées.",
        description: "Quelques ajustements de profil suffisent souvent à faire ressortir les offres les plus adaptées.",
        ctaLabel: "Ajuster mon profil",
        tone: "neutral",
      };
  }
}
