export const PARTNER_PROGRAM_ENTRY_URL = "https://jobradar.go4jobapp.com/devenir-partenaire";

export type PartnerProgramMessage = {
  label: string;
  subject?: string;
  preview: string;
  paragraphs: string[];
};

export type PartnerProgramFaqItem = {
  question: string;
  answers: string[];
};

export type PartnerProgramTemplateValues = {
  partner_name?: string | null;
  partner_email?: string | null;
  program_entry_url?: string | null;
  partner_referral_url?: string | null;
};

export const PARTNER_PROGRAM_MESSAGES = {
  outreach: {
    label: "Message de prospection",
    subject: "Programme partenaires JobRadar",
    preview: "Premier contact pour présenter le programme partenaires JobRadar à un profil ou une structure ciblée.",
    paragraphs: [
      "Bonjour {{partner_name}},",
      "Je vous contacte car votre audience est très proche du public que JobRadar aide chaque semaine à trouver plus vite des offres pertinentes et à mieux suivre ses candidatures.",
      "Nous ouvrons progressivement notre programme partenaires à quelques profils et structures capables de recommander JobRadar de façon simple et crédible à leur communauté.",
      "Le principe est clair : chaque partenaire dispose d'un lien personnel et d'un code partenaire, et la commission s'applique sur le premier pass payé du client recommandé.",
      "Si le sujet vous intéresse, je peux vous envoyer le lien officiel pour rejoindre le programme et vous montrer concrètement comment cela fonctionne.",
      "Bien à vous,",
      "L'équipe JobRadar by Go4Job",
    ],
  },
  followUpInvitation: {
    label: "Message de relance / invitation avec lien",
    subject: "Votre accès au programme partenaires JobRadar",
    preview: "Relance courte avec le lien officiel d'entrée vers le programme partenaires.",
    paragraphs: [
      "Bonjour {{partner_name}},",
      "Comme convenu, voici le lien officiel pour rejoindre le programme partenaires JobRadar : {{program_entry_url}}",
      "Cette page sert uniquement à rejoindre le programme. Une fois l'accès activé, votre espace partenaire vous donnera votre lien personnel et votre code partenaire à partager.",
      "Le cadre reste volontairement simple : commission sur le premier pass payé du client recommandé, suivi dans un espace partenaire dédié, et activation immédiate après inscription.",
      "Si vous voulez, je peux aussi vous renvoyer un récap rapide des étapes juste après votre inscription.",
      "Bien à vous,",
      "L'équipe JobRadar by Go4Job",
    ],
  },
  postSignup: {
    label: "Message automatique post-inscription",
    preview: "Message de bienvenue à afficher ou réutiliser juste après l'activation partenaire.",
    paragraphs: [
      "Bienvenue {{partner_name}},",
      "Votre accès partenaire JobRadar est maintenant actif.",
      "Votre première action utile est simple : récupérer votre lien personnel et votre code partenaire depuis votre espace, puis partager en priorité votre lien avec votre audience.",
      "Le lien /devenir-partenaire sert uniquement à rejoindre le programme. Pour vos recommandations, utilisez bien votre lien personnel, car c'est lui qui porte votre code partenaire pour le suivi.",
      "Vous pourrez ensuite suivre vos ventes attribuées, vos commissions et vos paiements directement dans votre espace partenaire.",
      "Si vous avez besoin d'un point rapide avant vos premiers partages, l'équipe Go4Job peut vous accompagner.",
    ],
  },
} satisfies Record<"outreach" | "followUpInvitation" | "postSignup", PartnerProgramMessage>;

export const PARTNER_PROGRAM_FAQ: PartnerProgramFaqItem[] = [
  {
    question: "À quoi sert exactement la page /devenir-partenaire ?",
    answers: [
      "La page /devenir-partenaire sert uniquement à rejoindre le programme partenaires JobRadar.",
      "Une fois l'accès activé, votre espace partenaire devient votre point de travail principal pour récupérer votre lien personnel, votre code partenaire et suivre votre activité.",
    ],
  },
  {
    question: "Que reçoit-on après l'activation ?",
    answers: [
      "Après activation, vous recevez un accès à votre espace partenaire avec votre lien personnel et votre code partenaire.",
      "C'est ce lien personnel qui doit ensuite être partagé avec votre audience pour le suivi des recommandations.",
    ],
  },
  {
    question: "Comment fonctionne la commission ?",
    answers: [
      "La commission porte sur le premier pass payé du client recommandé.",
      "Les renouvellements ne sont pas commissionnés dans la version actuelle du programme.",
    ],
  },
  {
    question: "Faut-il partager la page /devenir-partenaire à son audience ?",
    answers: [
      "Non. Cette page est un point d'entrée pour rejoindre le programme, pas le lien de recommandation à diffuser à votre audience.",
      "Pour vos partages publics ou directs, il faut utiliser votre lien personnel partenaire.",
    ],
  },
  {
    question: "Peut-on partager aussi le code partenaire sans le lien ?",
    answers: [
      "Oui, le code partenaire peut servir dans certains échanges directs.",
      "Mais le plus propre reste de partager d'abord le lien personnel, car il embarque déjà le code et simplifie le tracking.",
    ],
  },
  {
    question: "Où suivre les ventes, commissions et paiements ?",
    answers: [
      "Tout se suit dans l'espace partenaire une fois le compte activé.",
      "Vous y retrouvez vos ventes attribuées, vos commissions et vos paiements sans sortir de l'environnement JobRadar.",
    ],
  },
];

function replaceTemplateTokens(text: string, values: PartnerProgramTemplateValues) {
  return text.replace(/\{\{\s*(partner_name|partner_email|program_entry_url|partner_referral_url)\s*\}\}/g, (_, key) => {
    const value = values[key as keyof PartnerProgramTemplateValues];
    return (value ?? "").trim();
  });
}

export function renderPartnerProgramMessage(
  message: PartnerProgramMessage,
  values: PartnerProgramTemplateValues
) {
  return {
    ...message,
    subject: message.subject ? replaceTemplateTokens(message.subject, values) : undefined,
    paragraphs: message.paragraphs.map((paragraph) => replaceTemplateTokens(paragraph, values)),
  };
}
