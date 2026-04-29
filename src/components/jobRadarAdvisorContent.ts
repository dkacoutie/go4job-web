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
        title: "Bon debut : ta recherche devient plus precise.",
        description: "JobRadar a deja prepare un profil de recherche utile pour toi. Tu peux le garder tel quel ou l'ajuster en quelques secondes.",
        ctaLabel: "Voir mes offres",
        tone: "focus",
      };

    case "onboarding-preview":
      if (preset.mode === "match") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres semblent deja bien alignees.",
          description: "Ton cap ressort deja clairement. En continuant, JobRadar pourra etendre ce niveau de pertinence.",
          ctaLabel: "Debloquer toutes les offres",
          tone: "success",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ces offres sont proches de ton objectif.",
        description: preset.hasCv
          ? "Tu as deja un profil de recherche utile. Quelques ajustements peuvent maintenant faire ressortir les offres les plus adaptees."
          : "Tu as deja un profil de recherche utile. Ajoute ton CV pour obtenir des offres mieux ciblees.",
        ctaLabel: preset.hasCv ? "Ajuster mes criteres" : "Ajouter mon CV",
        tone: "focus",
      };

    case "cv":
      if (preset.status === "analyzed") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est pret. Active maintenant tes alertes.",
          description: "Les informations utiles sont deja en place. L'etape la plus utile maintenant est de lancer tes alertes.",
          ctaLabel: "Activer mes alertes",
          tone: "success",
        };
      }

      if (preset.status === "ready_to_analyze") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ton CV est deja en place.",
          description: "Lance l'analyse pour transformer ce document en informations utiles.",
          ctaLabel: "Analyser mon CV",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Ajoute ton CV pour affiner encore tes resultats.",
        description: "JobRadar l'utilise pour mieux comprendre ton parcours et mieux classer les offres qui te ressemblent.",
        ctaLabel: "Televerser mon CV",
        tone: "focus",
      };

    case "alerts":
      if (preset.mode === "checkout") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Tes alertes sont pretes.",
          description: "Active un pass pour les lancer.",
          ctaLabel: "Voir les pass disponibles",
          tone: "neutral",
        };
      }

      if (preset.mode === "onboarding") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Active tes alertes pour ne rien laisser passer.",
          description: "Tes alertes preparees peuvent prendre le relais pendant que tu avances dans le parcours.",
          ctaLabel: "Voir les alertes pretes",
          tone: "focus",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes alertes gardent le rythme pour toi.",
        description: "Une bonne alerte t'evite de revenir trop tard sur une opportunite vraiment interessante.",
        ctaLabel: "Creer une alerte",
        tone: "neutral",
      };

    case "feed":
      if (preset.mode === "needs_cv") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Il manque encore une info utile.",
          description: "Ajoute ton CV pour mieux distinguer les offres vraiment proches de ton objectif.",
          ctaLabel: "Ajouter mon CV",
          tone: "focus",
        };
      }

      if (preset.mode === "needs_alerts") {
        return {
          eyebrow: DEFAULT_EYEBROW,
          title: "Ces offres sont proches, pas encore nettes.",
          description: "Une alerte plus precise peut aider a faire remonter ce qui compte vraiment pour toi.",
          ctaLabel: "Ajuster mes alertes",
          tone: "neutral",
        };
      }

      return {
        eyebrow: DEFAULT_EYEBROW,
        title: "Tes offres se precisent, mais peuvent etre encore mieux ciblees.",
        description: "Quelques ajustements de profil suffisent souvent a faire ressortir les offres les plus adaptees.",
        ctaLabel: "Ajuster mon profil",
        tone: "neutral",
      };
  }
}
