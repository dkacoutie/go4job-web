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
        title: "Bon début. On voit déjà plus clair sur ce que tu cherches.",
        description: "J'ai préparé un premier profil de recherche à partir de tes réponses. Regarde s'il te correspond — tu peux l'ajuster en quelques secondes.",
        ctaLabel: "Voir mes offres",
        tone: "focus",
      };

    case "onboarding-preview":
      if (preset.mode === "match") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres te correspondent déjà bien.",
          description: "Ton objectif est clair. Continue, et j'irai chercher plus loin pour élargir cette sélection.",
          ctaLabel: "Débloquer toutes les offres",
          tone: "success",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ces offres se rapprochent de ce que tu cherches.",
        description: preset.hasCv
          ? "Ton profil est déjà utile. Avec quelques ajustements, je peux faire remonter les offres qui te correspondent vraiment."
          : "Ton profil est déjà utile. Ajoute ton CV et je pourrai cibler bien plus précisément.",
        ctaLabel: preset.hasCv ? "Ajuster mes critères" : "Ajouter mon CV",
        tone: "focus",
      };

    case "cv":
      if (preset.status === "analyzed") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est prêt. La suite logique, ce sont tes alertes.",
          description: "Tout ce qu'il faut est en place. Active tes alertes et je continue à chercher pendant que tu avances sur autre chose.",
          ctaLabel: "Activer mes alertes",
          tone: "success",
        };
      }

      if (preset.status === "ready_to_analyze") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est bien reçu.",
          description: "Lance l'analyse : ça m'aide à mieux comprendre ton profil pour trouver les bonnes offres.",
          ctaLabel: "Analyser mon CV",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ajoute ton CV, ça change tout pour la suite.",
        description: "Je m'en sers pour comprendre ton parcours et repérer les offres qui te ressemblent vraiment, pas juste des mots-clés qui correspondent.",
        ctaLabel: "Téléverser mon CV",
        tone: "focus",
      };

    case "alerts":
      if (preset.mode === "checkout") {
        return {
          eyebrow: DEFAULT_EYEBROW,
        title: "Tes alertes sont prêtes.",
          description: "Il ne manque qu'un pass pour que je commence à surveiller les offres pour toi.",
          ctaLabel: "Voir les pass disponibles",
          tone: "neutral",
        };
      }

      if (preset.mode === "onboarding") {
        return {
          eyebrow: DEFAULT_EYEBROW,
        title: "Active tes alertes, je surveille la suite pour toi.",
        description: "Elles sont prêtes à repérer les nouvelles offres pendant que tu avances sur le reste.",
          ctaLabel: "Voir mes alertes prêtes",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes alertes surveillent les offres pour toi.",
        description: "Plus une alerte est précise, plus vite je peux te prévenir quand une offre qui te correspond sort.",
        ctaLabel: "Créer une alerte",
        tone: "neutral",
      };

    case "feed":
      if (preset.mode === "needs_cv") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Il me manque une info importante.",
          description: "Ajoute ton CV, ça m'aide à distinguer les offres vraiment proches de ton objectif.",
          ctaLabel: "Ajouter mon CV",
          tone: "focus",
        };
      }

      if (preset.mode === "needs_alerts") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres sont proches de ta recherche.",
          description: "Avec une alerte plus précise, je peux faire remonter ce qui compte vraiment pour toi.",
          ctaLabel: "Ajuster mes alertes",
          tone: "neutral",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes offres se précisent. On peut encore mieux cibler.",
        description: "Quelques ajustements de profil suffisent souvent à faire remonter les offres les plus adaptées.",
        ctaLabel: "Ajuster mon profil",
        tone: "neutral",
      };
  }
}
