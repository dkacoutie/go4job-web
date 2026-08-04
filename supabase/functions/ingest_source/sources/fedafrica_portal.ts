import {
  type CommercialSourceConfig,
  type CommercialSourceJob,
  fetchCommercialSourceDryRun,
} from "./west_africa_source_common.ts";

// Fed Africa (fedafrica.com) — cabinet de recrutement cadres/dirigeants pour
// l'Afrique et le Moyen-Orient (bureaux Paris/Abidjan). Une seule page
// listing (/offres) regroupe TOUTES les offres, tous pays confondus (Cote
// d'Ivoire, Guinee, RDC, etc.), sans filtre pays fiable dans l'URL. Audite le
// 30/07/2026 en direct : 20 offres affichees sur la page, dont 12 reellement
// ouvertes en Cote d'Ivoire (toutes a Abidjan) ; 7 marquees "Offre pourvue"
// (poste deja attribue, sans date ni lieu affiches) a exclure explicitement.
//
// Aucune structure HTML brute n'a pu etre inspectee depuis cet environnement
// (web_fetch ne donne que du texte nettoye) : le parseur ci-dessous capture
// chaque lien de titre d'offre (/offres/<slug>) puis analyse le texte brut
// qui suit jusqu'au prochain titre pour detecter "Offre pourvue" et la
// mention "Abidjan". A confirmer/ajuster au premier dry-run reel, meme
// methode que eburka_portal.ts.
//
// Le nom de l'employeur reel est presque toujours confidentiel ("l'un de nos
// clients") : company_name est fixe a "Fed Africa" (le cabinet), pas
// invente.

const SOCIAL_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "whatsapp.com",
  "wa.me",
];

function stripHtml(value: string): string {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&eacute;|&#233;/gi, "e")
    .replace(/&egrave;|&#232;/gi, "e")
    .replace(/&agrave;|&#224;/gi, "a")
    .replace(/&ocirc;|&#244;/gi, "o")
    .replace(/&ccedil;|&#231;/gi, "c")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSocialUrl(rawUrl: string) {
  const lowerUrl = rawUrl.toLowerCase();
  if (/(sharer\.php|\/share\b|share=|whatsapp|linkedin|facebook|twitter)/i.test(lowerUrl)) {
    return true;
  }
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return SOCIAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function normalizeFedAfricaJobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value || isSocialUrl(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "fedafrica.com") return null;
    if (!/^\/offres\/[a-z0-9][a-z0-9-]*$/i.test(pathname)) return null;
    return `https://www.fedafrica.com${pathname}`;
  } catch {
    return null;
  }
}

// Chaque offre a deux liens vers la meme URL sur la page listing : le titre
// (h3) et le CTA "Consulter cette offre" plus bas dans la carte. On ne garde
// que la premiere occurrence (le titre) par URL, et on utilise le texte brut
// entre ce titre et le prochain titre d'offre comme "bloc" pour y chercher
// le statut (Offre pourvue) et le lieu (Abidjan).
function parseFedAfricaJobs(
  html: string,
  config: CommercialSourceConfig,
  pageUrl: string,
): CommercialSourceJob[] {
  const anchorRegex = /<a\b[^>]*href=["']([^"']*\/offres\/[a-z0-9][a-z0-9-]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const rawMatches = Array.from(html.matchAll(anchorRegex)).map((match) => ({
    href: match[1] ?? "",
    text: stripHtml(match[2] ?? ""),
    index: match.index ?? 0,
  }));

  const titleOccurrences = rawMatches.filter((m) =>
    m.text.length >= 5 && !/^consulter cette offre$/i.test(m.text) && !/^en savoir plus$/i.test(m.text)
  );

  const seenHref = new Set<string>();
  const jobs: CommercialSourceJob[] = [];
  let itemIndex = 0;

  for (let i = 0; i < titleOccurrences.length; i++) {
    const current = titleOccurrences[i];
    if (seenHref.has(current.href)) continue;
    seenHref.add(current.href);

    const nextTitle = titleOccurrences[i + 1];
    const blockEnd = nextTitle ? nextTitle.index : Math.min(html.length, current.index + 3000);
    const blockRaw = html.slice(current.index, blockEnd);
    const blockText = stripHtml(blockRaw);

    const sourceUrl = current.href.startsWith("http")
      ? current.href
      : `${config.baseUrl}${current.href.startsWith("/") ? "" : "/"}${current.href}`;

    jobs.push({
      external_id: `${config.sourceCode}:${sourceUrl}`,
      title: current.text,
      company_name: "Fed Africa",
      country: config.country,
      location: config.country,
      source_url: sourceUrl,
      apply_url: sourceUrl,
      published_at: null,
      expires_at: null,
      description_text: blockText,
      tags: [config.country, config.sourceFamily],
      payload: { source_kind: "html", page_url: pageUrl },
    });
    itemIndex++;
  }

  return jobs;
}

function improveFedAfrica(job: CommercialSourceJob): CommercialSourceJob {
  const normalizedUrl = normalizeFedAfricaJobUrl(job.source_url);
  const baseJob = normalizedUrl
    ? {
      ...job,
      external_id: `fedafrica_portal:${normalizedUrl}`,
      source_url: normalizedUrl,
      apply_url: normalizedUrl,
    }
    : job;
  return {
    ...baseJob,
    country: "Cote d'Ivoire",
    country_codes: ["CI"],
    location: "Abidjan",
    tags: ["Cote d'Ivoire", "fedafrica_portal"],
  };
}

function rejectFedAfrica(job: CommercialSourceJob) {
  if (!job.source_url || isSocialUrl(job.source_url)) {
    return "rejected_social_url_count";
  }
  if (!normalizeFedAfricaJobUrl(job.source_url)) {
    return "rejected_invalid_job_url_count";
  }
  const block = (job.description_text ?? "").toLowerCase();
  if (block.includes("offre pourvue")) {
    return "rejected_position_filled_count";
  }
  if (!block.includes("abidjan")) {
    return "rejected_not_ivory_coast_count";
  }
  return null;
}

export async function fetchFedAfricaPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://www.fedafrica.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "fedafrica_portal",
    sourceFamily: "fedafrica_portal",
    baseUrl,
    country: "Cote d'Ivoire",
    maxItems: options?.limit ?? 30,
    startUrls: [`${baseUrl}/offres`],
    maxPages: 1,
    alwaysFetchStartPages: true,
    htmlOnly: true,
    pageDelayMs: 0,
    // jobUrlIncludes/linkInclude ne sont pas utilises par le parseur
    // personnalise ci-dessous (parseFedAfricaJobs filtre lui-meme sur le
    // motif /offres/<slug> dans sa regex) ; conserves pour coherence avec
    // les autres connecteurs et au cas ou un repli generique serait active.
    linkInclude: "fedafrica.com",
    jobUrlIncludes: ["/offres/"],
    parseHtmlJobs: parseFedAfricaJobs,
    postProcessJob: improveFedAfrica,
    rejectJobReason: rejectFedAfrica,
    stoppedReasonWhenEmpty: "fedafrica_requires_specific_static_endpoint",
  });
}
