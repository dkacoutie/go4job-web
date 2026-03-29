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
    preview: "Premier contact pour presenter le programme partenaires JobRadar a un profil ou une structure cible.",
    paragraphs: [
      "Bonjour {{partner_name}},",
      "Je vous contacte car votre audience est tres proche du public que JobRadar aide chaque semaine a trouver plus vite des offres pertinentes et a mieux suivre ses candidatures.",
      "Nous ouvrons progressivement notre programme partenaires a quelques profils et structures capables de recommander JobRadar de facon simple et credible a leur communaute.",
      "Le principe est clair : chaque partenaire dispose d'un lien personnel et d'un code partenaire, et la commission s'applique sur le premier abonnement paye du client recommande.",
      "Si le sujet vous interesse, je peux vous envoyer le lien officiel pour rejoindre le programme et vous montrer concretement comment cela fonctionne.",
      "Bien a vous,",
      "L'equipe JobRadar by Go4Job",
    ],
  },
  followUpInvitation: {
    label: "Message de relance / invitation avec lien",
    subject: "Votre acces au programme partenaires JobRadar",
    preview: "Relance courte avec le lien officiel d'entree vers le programme partenaires.",
    paragraphs: [
      "Bonjour {{partner_name}},",
      "Comme convenu, voici le lien officiel pour rejoindre le programme partenaires JobRadar : {{program_entry_url}}",
      "Cette page sert uniquement a rejoindre le programme. Une fois l'acces active, votre espace partenaire vous donnera votre lien personnel et votre code partenaire a partager.",
      "Le cadre reste volontairement simple : commission sur le premier abonnement paye du client recommande, suivi dans un espace partenaire dedie, et activation immediate apres inscription.",
      "Si vous voulez, je peux aussi vous renvoyer un recap rapide des etapes juste apres votre inscription.",
      "Bien a vous,",
      "L'equipe JobRadar by Go4Job",
    ],
  },
  postSignup: {
    label: "Message automatique post-inscription",
    preview: "Message de bienvenue a afficher ou reutiliser juste apres l'activation partenaire.",
    paragraphs: [
      "Bienvenue {{partner_name}},",
      "Votre acces partenaire JobRadar est maintenant actif.",
      "Votre premiere action utile est simple : recuperer votre lien personnel et votre code partenaire depuis votre espace, puis partager en priorite votre lien avec votre audience.",
      "Le lien /devenir-partenaire sert uniquement a rejoindre le programme. Pour vos recommandations, utilisez bien votre lien personnel, car c'est lui qui porte votre code partenaire pour le suivi.",
      "Vous pourrez ensuite suivre vos ventes attribuees, vos commissions et vos paiements directement dans votre espace partenaire.",
      "Si vous avez besoin d'un point rapide avant vos premiers partages, l'equipe Go4Job peut vous accompagner.",
    ],
  },
} satisfies Record<"outreach" | "followUpInvitation" | "postSignup", PartnerProgramMessage>;

export const PARTNER_PROGRAM_FAQ: PartnerProgramFaqItem[] = [
  {
    question: "A quoi sert exactement la page /devenir-partenaire ?",
    answers: [
      "La page /devenir-partenaire sert uniquement a rejoindre le programme partenaires JobRadar.",
      "Une fois l'acces active, votre espace partenaire devient votre point de travail principal pour recuperer votre lien personnel, votre code partenaire et suivre votre activite.",
    ],
  },
  {
    question: "Que recoit-on apres l'activation ?",
    answers: [
      "Apres activation, vous recevez un acces a votre espace partenaire avec votre lien personnel et votre code partenaire.",
      "C'est ce lien personnel qui doit ensuite etre partage avec votre audience pour le suivi des recommandations.",
    ],
  },
  {
    question: "Comment fonctionne la commission ?",
    answers: [
      "La commission porte sur le premier abonnement paye du client recommande.",
      "Les renouvellements ne sont pas commissionnes dans la version actuelle du programme.",
    ],
  },
  {
    question: "Faut-il partager la page /devenir-partenaire a son audience ?",
    answers: [
      "Non. Cette page est un point d'entree pour rejoindre le programme, pas le lien de recommandation a diffuser a votre audience.",
      "Pour vos partages publics ou directs, il faut utiliser votre lien personnel partenaire.",
    ],
  },
  {
    question: "Peut-on partager aussi le code partenaire sans le lien ?",
    answers: [
      "Oui, le code partenaire peut servir dans certains echanges directs.",
      "Mais le plus propre reste de partager d'abord le lien personnel, car il embarque deja le code et simplifie le tracking.",
    ],
  },
  {
    question: "Ou suivre les ventes, commissions et paiements ?",
    answers: [
      "Tout se suit dans l'espace partenaire une fois le compte active.",
      "Vous y retrouvez vos ventes attribuees, vos commissions et vos paiements sans sortir de l'environnement JobRadar.",
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
