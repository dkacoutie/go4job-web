import DOMPurify from "dompurify";

/**
 * Normalisation et rendu sécurisé des descriptions d'offres JobRadar.
 *
 * Deux entrées possibles selon la source :
 * - du HTML déjà fourni par la source (description_html / job_json) : on le
 *   sanitize et on l'affiche tel quel, sans y ajouter de structure inventée.
 * - du texte brut (description_text / official_desc) : la majorité des
 *   sources (France Travail, Adzuna, Emploi.ci, Emploi Senegal, ...) ne
 *   fournissent aucun HTML. Ce texte peut contenir des marqueurs de
 *   structure réels (retours a la ligne, puces "-", "*", "•", intitules de
 *   rubrique suivis de ":") qui doivent etre reconnus et rendus, sans
 *   jamais inventer de rubrique absente du texte source.
 *
 * Tout HTML produit ici, qu'il vienne de la source ou de ce normaliseur,
 * passe par le meme sanitizer strict avant affichage.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "hr",
  "sub",
  "sup",
  "code",
  "pre",
];

const ALLOWED_ATTR = ["href", "class"];

/** Sanitize un HTML de source externe (déjà structuré) avant affichage. */
export function sanitizeHtmlBasic(html: string): string {
  const clean = DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, "text/html");
    doc.body.querySelectorAll("a").forEach((el) => {
      el.setAttribute("rel", "noopener noreferrer");
      el.setAttribute("target", "_blank");
    });
    return doc.body.innerHTML;
  } catch {
    return clean;
  }
}

export function stripHtmlToText(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return (html ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Transforme les URLs nues d'un texte déjà échappé en liens sûrs. */
function linkifyEscaped(escapedText: string): string {
  return escapedText.replace(URL_RE, (url) => {
    // url provient du texte déjà échappé : les caractères &<>"' y sont déjà des entités,
    // donc `url` matché ici ne contient plus ces caractères actifs.
    const trimmed = url.replace(/[.,;:!?]+$/, "");
    const trailing = url.slice(trimmed.length);
    return `<a href="${trimmed}" rel="noopener noreferrer" target="_blank">${trimmed}</a>${trailing}`;
  });
}

const BULLET_RE = /^\s*([-*•▪‣●]|\d{1,2}[.)])\s+(.*)$/;

// Intitulés de rubrique connus, observés réellement dans les offres JobRadar
// (France Travail, Agence Emploi Jeunes, sources RSS internationales). Liste
// volontairement bornée : un intitulé absent de cette liste ne devient
// jamais un titre inventé, il reste un paragraphe normal.
const KNOWN_SECTION_LABELS = [
  "missions",
  "vos missions",
  "missions principales",
  // "principales missions" (ordre inverse) volontairement absent : cette
  // suite de mots apparaît aussi comme sous-chaîne de tournures courantes
  // ("vos principales missions"), qui deviendraient à tort une rubrique
  // coupée après "vos". "missions principales" couvre l'intitulé isolé.
  "profil",
  "profil recherché",
  "votre profil",
  "compétences",
  "compétences requises",
  "compétences techniques",
  "conditions",
  "conditions de travail",
  "ce que nous proposons",
  "ce que nous offrons",
  "avantages",
  "formation",
  "formation requise",
  "expérience",
  "expérience requise",
  "qualifications requises",
  "informations pratiques",
  "présentation du poste",
  "présentation de l'entreprise",
  "présentation du pôle",
  "à propos de l'entreprise",
  "à propos du poste",
  "à propos de la mission",
  "responsibilities",
  "requirements",
  "qualifications",
  "benefits",
  "what we offer",
  "about the role",
  "about you",
  "about us",
  "skills",
  "nice to have",
  // Intitulés observés sur les sources à champs structurés (Talentsoft et
  // similaires) : label suivi de ":" sur sa propre ligne (ou isolable par
  // reflowFlattenedSectionLabels), valeur en clair juste après.
  "domaine d'activités et famille de métier",
  "description du poste",
  "intitulé de poste",
  "intitulé du poste",
  "nature du contrat",
  "type de contrat",
  "durée du contrat",
  "temps de travail",
  "niveau de diplôme",
  "niveau d'études",
  "niveau d'étude",
  "expérience souhaitée",
  "expérience demandée",
  "salaire",
  "rémunération",
  "date de prise de poste",
  "date de début",
  "secteur d'activité",
  "lieu",
];

// Traité du plus long au plus court : évite qu'un intitulé court générique
// ("missions") ne capture prématurément une partie d'un intitulé plus long
// et plus précis ("vos missions", "missions principales").
const LABELS_BY_LENGTH_DESC = [...KNOWN_SECTION_LABELS].sort((a, b) => b.length - a.length);

// Repli "libellé collé à ce qui le PRÉCÈDE" (ex: "test.Profil recherché :")
// : un intitulé d'un seul mot y est trop risqué, il peut capturer la fin
// d'une tournure plus longue qui n'a rien à voir (ex: "missions" dans "Vos
// principales missions :" — la phrase se ferait couper après "principales").
// Le repli "libellé collé à ce qui le SUIT sur la même ligne" (ex:
// "Lieu : Rennes") n'a pas ce risque : il n'y a rien à regarder en arrière,
// donc les intitulés courts y restent admis.
const GLUE_BEFORE_LABELS = LABELS_BY_LENGTH_DESC.filter((label) => label.includes(" "));

function isKnownSectionLabel(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.endsWith(":") || trimmed.length > 70) return false;
  const label = trimmed.slice(0, -1).trim().toLowerCase();
  return KNOWN_SECTION_LABELS.includes(label);
}

type Block =
  | { type: "heading"; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "paragraph"; text: string };

/**
 * Segmente un texte déjà pourvu de vrais retours à la ligne (source qui les
 * préserve, ou texte réparé) en blocs paragraphe / liste / rubrique.
 */
function segmentLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraphBuf: string[] = [];
  let listBuf: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraphBuf.length) {
      blocks.push({ type: "paragraph", text: paragraphBuf.join(" ").trim() });
      paragraphBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length) {
      blocks.push({ type: "list", items: listBuf, ordered: listOrdered });
      listBuf = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      flushParagraph();
      listOrdered = /\d/.test(bulletMatch[1]);
      listBuf.push(bulletMatch[2].trim());
      continue;
    }

    if (isKnownSectionLabel(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: line.slice(0, -1).trim() });
      continue;
    }

    flushList();
    paragraphBuf.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

/**
 * Répare, avec une seule règle spécifique et vérifiée (pas une liste de
 * regex ad hoc), les blobs sans aucun retour à la ligne dans lesquels une
 * liste à puces a été aplatie : le motif " * item" reste identifiable même
 * après la perte des retours à la ligne (observé sur France Travail).
 * N'agit que si le motif apparaît au moins deux fois, pour éviter de couper
 * un texte contenant un astérisque isolé sans rapport avec une liste.
 */
function reflowFlattenedAsterisks(text: string): string {
  const occurrences = text.match(/\s\*\s+/g);
  if (!occurrences || occurrences.length < 2) return text;
  return text.replace(/\s\*\s+/g, "\n* ");
}

/**
 * Même logique que reflowFlattenedAsterisks, pour les listes à tirets
 * aplaties (ex: "- Aider à la pose - Préparer le matériel - Participer aux
 * raccordements", observé sur France Travail). Un tiret simple est trop
 * ambigu en français (mots composés, plages de dates/salaires, tiret
 * incise) pour être coupé partout : on ne coupe que devant un " - " suivi
 * d'une majuscule (convention observée dans toutes les listes réelles
 * échantillonnées), et seulement si le motif apparaît au moins trois fois,
 * pour rester nettement au-dessus du bruit d'un tiret isolé.
 */
function reflowFlattenedDashes(text: string): string {
  const DASH_ITEM_RE = /\s-\s+(?=[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ])/g;
  const occurrences = text.match(DASH_ITEM_RE);
  if (!occurrences || occurrences.length < 3) return text;
  return text.replace(DASH_ITEM_RE, "\n- ");
}

/**
 * Répare, avec la même prudence, les intitulés de rubrique connus lorsqu'ils
 * apparaissent au milieu d'un texte sans isolement propre (ex: "...test.
 * Profil recherché : Formation en..."). N'insère une coupure que devant/
 * après un intitulé de la liste fermée ci-dessus, jamais autour d'un mot
 * quelconque. Deux passes indépendantes : on isole le libellé de la phrase
 * qui le précède, puis du contenu qui le suit sur la même ligne, pour que
 * "Profil recherché :" devienne une ligne à lui seul (condition nécessaire
 * pour être reconnu comme rubrique par segmentLines).
 */
// Une seule regex à alternatives (triées du plus long au plus court) par
// passe, plutôt qu'une regex par intitulé rejouée sur tout le texte à
// chaque itération : ça évite qu'un intitulé court ("missions") ne vienne
// re-couper un intitulé plus long déjà correctement isolé ("vos missions").
const SECTION_LABEL_ALTERNATION = LABELS_BY_LENGTH_DESC.map(escapeRegExp).join("|");
const GLUE_BEFORE_ALTERNATION = GLUE_BEFORE_LABELS.map(escapeRegExp).join("|");

function reflowFlattenedSectionLabels(text: string): string {
  const beforeRe = new RegExp(`([^\\n\\s])[ \\t]+(${GLUE_BEFORE_ALTERNATION})(\\s*:)`, "gi");
  let out = text.replace(beforeRe, (_m, before, label, colon) => `${before}\n${label}${colon}`);

  const afterRe = new RegExp(`(${SECTION_LABEL_ALTERNATION})(\\s*:)[ \\t]+(\\S)`, "gi");
  out = out.replace(afterRe, (_m, label, colon, after) => `${label}${colon}\n${after}`);

  return out;
}

/**
 * Répare le cas où le marqueur de puce est seul sur sa ligne et le texte de
 * l'item suit sur la ligne d'après (observé sur Talentsoft : "- " puis
 * "Assurer le quittancement..." sur la ligne suivante). Sans ce repli, la
 * puce vide disparaît au filtrage et l'item redevient un paragraphe normal
 * au lieu d'un élément de liste.
 */
function joinLoneBulletMarkerWithNextLine(text: string): string {
  return text.replace(/^([ \t]*[-*•▪‣●][ \t]*)\n[ \t]*/gm, "$1 ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderBlocksToHtml(blocks: Block[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      const escaped = linkifyEscaped(escapeHtml(block.text));
      parts.push(`<p class="jd-desc-heading">${escaped}</p>`);
    } else if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .filter((item) => item.trim().length > 0)
        .map((item) => `<li>${linkifyEscaped(escapeHtml(item))}</li>`)
        .join("");
      if (items) parts.push(`<${tag}>${items}</${tag}>`);
    } else {
      const text = block.text.trim();
      if (text) parts.push(`<p>${linkifyEscaped(escapeHtml(text))}</p>`);
    }
  }
  return parts.join("");
}

/**
 * Transforme un texte brut de description d'offre en HTML structuré et sûr,
 * sans jamais inventer de contenu ni de rubrique absente du texte source.
 * Le résultat passe par le même sanitizer strict que le HTML natif.
 */
/**
 * Certaines sources (Talentsoft et similaires) fournissent du HTML
 * "faussement structuré" : des libellés en <b>/<strong> suivis de ":" et des
 * <br /> comme seule séparation, sans le moindre <p>/<ul>/<table> — donc du
 * texte à plat malgré les balises. Traiter ce cas comme du HTML "déjà
 * structuré" produit un unique bloc illisible. On le détecte pour le
 * rerouter vers le même pipeline texte que les sources sans HTML, plutôt que
 * de l'afficher tel quel.
 */
function looksWeaklyStructuredHtml(html: string): boolean {
  const hasBlockStructure = /<\s*(p|ul|ol|table|h[1-6])[\s>]/i.test(html);
  const hasLineBreakTags = /<\s*br\s*\/?>/i.test(html);
  return hasLineBreakTags && !hasBlockStructure;
}

/** Convertit ce HTML à plat en texte porteur de vrais retours à la ligne,
 * pour pouvoir le repasser dans le même pipeline que le texte brut. */
function weaklyStructuredHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr)\s*>/gi, "\n");
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(withBreaks, "text/html");
    return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return withBreaks.replace(/<\/?[^>]+(>|$)/g, "").trim();
  }
}

/**
 * Point d'entrée pour le HTML fourni par une source : passe par le
 * sanitizer strict si le HTML est réellement structuré, ou re-route vers le
 * pipeline texte (reconstruction sûre) s'il ne l'est qu'en apparence.
 */
export function formatSourceHtml(htmlRaw: string): string {
  const trimmed = (htmlRaw ?? "").trim();
  if (!trimmed) return "";
  if (looksWeaklyStructuredHtml(trimmed)) {
    const text = weaklyStructuredHtmlToText(trimmed);
    return text ? formatPlainDescriptionToHtml(text) : sanitizeHtmlBasic(trimmed);
  }
  return sanitizeHtmlBasic(trimmed);
}

export function formatPlainDescriptionToHtml(rawText: string): string {
  const text = (rawText ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";

  // Les heuristiques ci-dessous ne coupent qu'à des motifs répétés (seuil
  // >= 2 ou >= 3 occurrences, cf. leur doc), donc rester sûres même sur un
  // texte qui contient déjà quelques vrais retours à la ligne : un texte
  // avec seulement quelques \n épars (un par champ, par exemple) restait
  // sinon un unique bloc pour tout le corps de l'offre, faute de repli sur
  // les listes/rubriques aplaties qu'il contient malgré tout.
  const bulletsJoined = joinLoneBulletMarkerWithNextLine(text);
  const bulletsFixed = reflowFlattenedDashes(reflowFlattenedAsterisks(bulletsJoined));
  const prepared = reflowFlattenedSectionLabels(bulletsFixed);

  const lines = prepared.split("\n");
  const blocks = segmentLines(lines);

  // Si la segmentation n'a produit qu'un seul paragraphe (aucune structure
  // détectée), on ne force rien : c'est un texte simple, affiché tel quel.
  const html = renderBlocksToHtml(blocks);
  return sanitizeHtmlBasic(html);
}
