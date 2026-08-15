// JR-SEO : contenu editorial CapCarriere ("Conseils carriere").
//
// Decision produit du 13/08/2026 (voir claude/netlinking-strategie-jobradar.md) :
// une seule section d'articles, a une seule adresse (/conseils-carriere),
// plutot que du contenu duplique sur JobRadar et CapCarriere -- le
// contenu duplique a deux URL dilue l'autorite SEO au lieu de la
// concentrer. Rattache a l'identite CapCarriere (sujets CV/entretien),
// mais relie depuis la navigation JobRadar partagee (PublicHeader,
// SiteFooter) pour que les deux publics y accedent.
//
// Pas de CMS : contenu statique versionne dans le depot, meme approche
// que jobRadarAdvisorContent.ts / partnerProgramContent.ts pour du
// contenu structure long. Chaque article est un tableau de blocs simples
// (paragraphe, titre de section, liste) -- suffisant pour ce format,
// pas besoin d'un moteur de rendu markdown pour 2 (puis quelques)
// articles.

export type CareerArticleBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] };

export type CareerArticle = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // YYYY-MM-DD, affiche et utilise pour le sitemap
  intro: string;
  blocks: CareerArticleBlock[];
};

export const CAREER_ARTICLES: CareerArticle[] = [
  {
    slug: "guide-cv-afrique-francophone",
    title: "Le guide du CV qui décroche des entretiens en Afrique francophone (et au-delà)",
    description:
      "Structure de CV, erreurs les plus fréquentes, et ce qui change pour une candidature remote depuis la Côte d'Ivoire ou le Sénégal.",
    publishedAt: "2026-08-13",
    intro:
      "Chercher un emploi en Côte d'Ivoire, au Sénégal ou ailleurs en Afrique francophone ressemble de moins en moins à ce que décrivent les guides génériques trouvés en ligne. Les recruteurs locaux, les grands groupes internationaux présents sur le continent et les employeurs qui embauchent en remote pour des équipes basées en Europe n'attendent pas exactement le même CV. Ce guide fait le tri.",
    blocks: [
      { kind: "h2", text: "Une seule règle avant toutes les autres : le CV répond à une offre, pas à une biographie" },
      {
        kind: "p",
        text: "Le réflexe le plus courant, et le plus coûteux, consiste à écrire un CV une fois puis à l'envoyer partout tel quel. Un CV qui fonctionne est réécrit à chaque candidature, dans sa première moitié au moins : le titre, le résumé en tête de page, et l'ordre des expériences mises en avant. Le contenu factuel (dates, entreprises, diplômes) ne change pas ; la mise en avant, si.",
      },
      {
        kind: "p",
        text: "Concrètement, avant d'ouvrir un CV existant pour l'adapter, il vaut mieux relire l'offre et noter trois à cinq mots-clés qui reviennent dans les missions demandées. Ce sont ceux-là qui doivent apparaître, littéralement, dans le CV.",
      },
      { kind: "h2", text: "Structure qui fonctionne pour la plupart des candidatures" },
      {
        kind: "ol",
        items: [
          "En-tête : nom, ville (et pays si la candidature est internationale ou remote), téléphone, email professionnel, lien LinkedIn à jour. Pas de photo pour les candidatures vers l'Europe ou l'Amérique du Nord ; une photo reste courante et acceptée pour de nombreuses candidatures locales en Afrique francophone — à adapter selon la destination.",
          "Résumé en 2-3 lignes : ce que le candidat fait, pour qui, avec quel résultat mesurable si possible. Pas une liste de qualités (\"dynamique, rigoureux\") mais une phrase factuelle.",
          "Expériences, de la plus récente à la plus ancienne, avec pour chaque poste : intitulé, entreprise, période, et 2 à 4 lignes qui décrivent un résultat plutôt qu'une liste de tâches. \"Responsable de la gestion des stocks\" est une tâche. \"Réduction de 18% des ruptures de stock en 6 mois via un nouveau système de suivi\" est un résultat.",
          "Formation, sans surcharger si l'expérience professionnelle est déjà solide.",
          "Compétences techniques et langues, avec un niveau réel (pas \"courant\" par défaut si ce n'est pas vrai — les entretiens en anglais pour des postes remote le révèlent vite).",
        ],
      },
      { kind: "p", text: "Deux pages maximum, une seule si l'expérience est inférieure à 5 ans." },
      { kind: "h2", text: "Les erreurs qui reviennent le plus souvent" },
      {
        kind: "p",
        text: "Un CV trop long dilue l'attention du recruteur, qui passe en moyenne quelques dizaines de secondes sur un premier tri. Un CV sans aucun résultat chiffré ne se distingue pas des dizaines d'autres qui listent les mêmes tâches génériques. Une adresse email peu professionnelle ou un numéro sans indicatif international quand la candidature vise l'étranger crée une friction inutile dès le premier contact. Et un CV qui ne mentionne jamais le nom de l'entreprise ou du secteur visé donne l'impression, souvent à juste titre, d'un envoi en masse.",
      },
      { kind: "h2", text: "Candidater à un poste remote depuis l'Afrique francophone : ce qui change" },
      {
        kind: "p",
        text: "Les recruteurs qui embauchent en remote, souvent basés en Europe ou aux États-Unis, cherchent des signaux précis que le candidat sait travailler à distance : mention explicite d'outils de collaboration (Slack, Notion, Trello ou équivalents), exemples de coordination avec des équipes dans d'autres fuseaux horaires, autonomie démontrée par des résultats plutôt que par la supervision directe d'un manager. Préciser le fuseau horaire et la disponibilité de chevauchement avec l'équipe cible (par exemple, un candidat basé à Abidjan qui précise pouvoir couvrir jusqu'à 3 heures de recouvrement avec une équipe à Londres) rassure un recruteur qui n'a pas l'habitude de gérer des équipes distribuées.",
      },
      { kind: "h2", text: "Avant d'envoyer" },
      {
        kind: "p",
        text: "Trois vérifications rapides évitent l'essentiel des refus liés à la forme plutôt qu'au fond : le CV s'appelle-t-il \"CV_Prénom_Nom.pdf\" plutôt que \"cv final v3 (2).docx\" ; le format est-il un PDF, qui préserve la mise en page contrairement à un fichier Word envoyé tel quel ; et la lettre de motivation, si elle est demandée, répond-elle spécifiquement à l'offre plutôt que de recycler un texte générique.",
      },
    ],
  },
  {
    slug: "reussir-entretien-embauche",
    title: "Réussir un entretien d'embauche en Afrique francophone (et pour un poste remote à l'international)",
    description:
      "Comment préparer un entretien en présentiel à Abidjan, Dakar ou Douala, ou un entretien vidéo avec un recruteur basé à Paris, Londres ou New York.",
    publishedAt: "2026-08-13",
    intro:
      "Un CV ouvre la porte, mais c'est l'entretien qui décide. Beaucoup de candidats préparent longuement leur CV puis arrivent en entretien avec seulement quelques idées générales en tête. Ce guide couvre la préparation concrète, pour un entretien en présentiel à Abidjan, Dakar ou Douala comme pour un entretien vidéo avec un recruteur basé à Paris, Londres ou New York.",
    blocks: [
      { kind: "h2", text: "Avant l'entretien : ce qui fait la différence en dix minutes de préparation" },
      {
        kind: "p",
        text: "Relire l'offre une dernière fois la veille, en notant les trois compétences ou missions qui reviennent le plus souvent. Ce sont celles-là que le recruteur va sonder en premier. Chercher rapidement l'entreprise : son secteur, sa taille, un événement récent (levée de fonds, nouveau marché, actualité presse) donne matière à poser une question pertinente en fin d'entretien plutôt que le silence gêné du \"non, je n'ai pas de question\".",
      },
      {
        kind: "p",
        text: "Préparer trois exemples concrets tirés de son parcours, chacun avec une situation, une action prise et un résultat mesurable. Ce sont ces exemples qui remplaceront les réponses vagues (\"je suis quelqu'un de motivé\") par des réponses vérifiables. Un exemple bien préparé se réutilise pour plusieurs questions différentes (\"parlez-moi d'un échec\", \"parlez-moi d'une réussite\", \"comment gérez-vous la pression\") sans être récité mot pour mot.",
      },
      { kind: "h2", text: "Les questions qui reviennent presque toujours" },
      {
        kind: "p",
        text: "\"Parlez-moi de vous\" n'est pas une invitation à raconter une vie entière : une réponse de 60 à 90 secondes qui relie le parcours au poste visé suffit. \"Pourquoi ce poste, pourquoi cette entreprise\" attend une réponse spécifique à l'offre, pas une phrase qui marcherait pour n'importe quel poste similaire ailleurs. \"Quel est votre principal défaut\" se répond mieux avec un vrai axe de travail suivi d'une action concrète entreprise pour le corriger, plutôt qu'une fausse qualité déguisée (\"je suis trop perfectionniste\").",
      },
      {
        kind: "p",
        text: "Sur la rémunération, donner une fourchette plutôt qu'un chiffre unique, basée sur une recherche réelle du marché plutôt qu'une estimation approximative — ce sujet est détaillé plus loin dans un guide dédié à la négociation salariale.",
      },
      { kind: "h2", text: "Ce qui change pour un entretien vidéo avec un recruteur à l'étranger" },
      {
        kind: "p",
        text: "Un entretien vidéo pour un poste remote juge, en creux, la capacité à travailler à distance : connexion stable testée à l'avance (pas découverte en direct), fond neutre ou virtuel propre, éclairage face à soi plutôt que derrière, casque ou écouteurs pour éviter l'écho. Ces détails semblent mineurs mais un recruteur qui gère une équipe distribuée y voit un premier signal d'autonomie et de sérieux.",
      },
      {
        kind: "p",
        text: "Le décalage horaire mérite d'être anticipé et mentionné explicitement plutôt que découvert en cours d'échange : préciser sa disponibilité de recouvrement avec l'équipe (par exemple, un candidat basé à Abidjan qui peut couvrir jusqu'à 15h ou 16h heure de Londres) répond par avance à une inquiétude fréquente côté recruteur. Sur le niveau d'anglais, mieux vaut une auto-évaluation honnête (\"je peux échanger à l'écrit sans difficulté, l'oral technique demande un effort\") qu'une survente qui se découvre en dix minutes d'échange.",
      },
      { kind: "h2", text: "Après l'entretien" },
      {
        kind: "p",
        text: "Un message de remerciement court, envoyé dans les 24 heures, qui reprend un point précis discuté pendant l'échange plutôt qu'une formule générique, laisse une impression plus nette qu'un simple \"merci pour votre temps\". Si aucune nouvelle n'arrive dans le délai annoncé par le recruteur, une relance polie une fois ce délai dépassé reste appropriée — le silence côté candidat n'aide personne.",
      },
    ],
  },
];

export function getCareerArticleBySlug(slug: string | undefined): CareerArticle | undefined {
  if (!slug) return undefined;
  return CAREER_ARTICLES.find((a) => a.slug === slug);
}
