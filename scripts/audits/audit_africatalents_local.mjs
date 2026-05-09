#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_PAGES = 2;
const FETCH_DELAY_MS = 750;
const PAGE_TIMEOUT_MS = 30000;
const REPORT_PATH = path.join(
  "docs",
  "audits",
  `africatalents-priority-audit-${new Date().toISOString().slice(0, 10)}.md`,
);

const COUNTRIES = [
  {
    name: "Senegal",
    label: "Sénégal",
    code: "SN",
    sourcePrefix: "emploisenegal_portal",
    baseUrl: "https://www.emploisenegal.com",
    listingPath: "/recherche-jobs-senegal",
    offerPathNeedle: "/offre-emploi-senegal/",
  },
  {
    name: "Cameroon",
    label: "Cameroun",
    code: "CM",
    sourcePrefix: "emploi_cm_portal",
    baseUrl: "https://www.emploi.cm",
    listingPath: "/recherche-jobs-cameroun",
    offerPathNeedle: "/offre-emploi-cameroun/",
  },
  {
    name: "Morocco",
    label: "Maroc",
    code: "MA",
    sourcePrefix: "emploi_ma_portal",
    baseUrl: "https://www.emploi.ma",
    listingPath: "/recherche-jobs-maroc",
    offerPathNeedle: "/offre-emploi-maroc/",
  },
];

const SUSPICIOUS_TERMS = [
  "betting",
  "casino",
  "gambling",
  "affiliate",
  "affilié",
  "affilie",
  "mlm",
  "multi level marketing",
  "crypto",
  "cryptomonnaie",
  "cryptocurrency",
  "1xbet",
  "melbet",
];

function pageUrl(country, page) {
  const firstPage = `${country.baseUrl}${country.listingPath}`;
  return page <= 1 ? firstPage : `${firstPage}?page=${page - 1}`;
}

function absUrl(country, href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${country.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&eacute;/gi, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&egrave;/gi, "e")
    .replace(/&agrave;/gi, "a")
    .replace(/&ocirc;/gi, "o")
    .replace(/&icirc;/gi, "i")
    .replace(/&ccedil;/gi, "c")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_all, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function stripHtml(html = "") {
  return decodeHtmlEntities(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return stripHtml(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractAttr(html, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  return cleanText(html.match(re)?.[1]);
}

function extractFirst(html, re) {
  return cleanText(html.match(re)?.[1]);
}

function extractStrongAfterLabel(segment, labelPattern) {
  const re = new RegExp(
    `<li[^>]*>[\\s\\S]*?${labelPattern}[\\s\\S]*?<strong>([\\s\\S]*?)<\\/strong>[\\s\\S]*?<\\/li>`,
    "i",
  );
  return cleanText(segment.match(re)?.[1]);
}

function extractTotalFound(html) {
  const text = cleanText(html);
  const raw = cleanText(text.match(/([\d\s]+)\s+Offres d'emploi trouvées/i)?.[1]);
  return raw ? Number(raw.replace(/\s/g, "")) : null;
}

function extractMaxPage(html, country) {
  let maxPage = 1;
  const escapedPath = country.listingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedPath}\\?page=(\\d+)`, "gi");
  let match;
  while ((match = re.exec(html)) !== null) {
    maxPage = Math.max(maxPage, Number(match[1]) + 1);
  }
  return maxPage;
}

function extractNumericId(url) {
  return url.match(/-(\d+)(?:[/?#].*)?$/)?.[1] ?? null;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildExternalId(country, item) {
  const numericId = extractNumericId(item.source_url);
  if (numericId) return `${country.sourcePrefix}:${numericId}`;
  const hash = await sha256Hex(
    `${item.title}|${item.company_name ?? ""}|${item.published_at ?? ""}|${item.source_url}`,
  );
  return `${country.sourcePrefix}:${hash}`;
}

function detectSuspiciousTerms(item) {
  const haystack = normalize(
    `${item.title} ${item.company_name ?? ""} ${item.description_short ?? ""}`,
  );
  return SUSPICIOUS_TERMS.filter((term) => haystack.includes(normalize(term)));
}

function findMissingFields(item) {
  return [
    "external_id",
    "title",
    "company_name",
    "country",
    "location",
    "contract_type",
    "published_at",
    "source_url",
    "apply_url",
    "description_short",
  ].filter((field) => !item[field]);
}

async function parseOffers(country, html) {
  const cardRe = /<div\b[^>]*class=["'][^"']*\bcard\b[^"']*\bcard-job\b[^"']*["'][^>]*>/gi;
  const matches = Array.from(html.matchAll(cardRe));
  const offers = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const next = matches[i + 1]?.index ?? html.length;
    const segment = html.slice(start, next);
    const sourceUrl = absUrl(country, extractAttr(matches[i][0], "data-href"));
    if (!sourceUrl.includes(country.offerPathNeedle)) continue;

    const title = extractFirst(
      segment,
      /<h3[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i,
    );
    if (!title) continue;

    const companyName =
      extractFirst(
        segment,
        /class=["'][^"']*\bcompany-name\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      ) || null;
    const descriptionShort =
      extractFirst(
        segment,
        /<div\b[^>]*class=["'][^"']*\bcard-job-description\b[^"']*["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
      ) || null;
    const contractType =
      extractStrongAfterLabel(segment, "Contrat\\s+propos") || null;
    const location =
      extractStrongAfterLabel(segment, "R(?:\\u00e9|e)gion\\s+de") || null;
    const published = extractAttr(
      segment.match(/<time\b[^>]*datetime=["'][^"']+["'][^>]*>/i)?.[0] ?? "",
      "datetime",
    );
    const fallbackDate = cleanText(
      segment.match(/(?:\n|>|\s)(\d{2}\.\d{2}\.\d{4})(?:\s|<|$)/)?.[1],
    );
    const publishedAt = published
      ? new Date(`${published}T00:00:00.000Z`).toISOString()
      : fallbackDate || null;
    const numericId = extractNumericId(sourceUrl);
    const item = {
      external_id: "",
      title,
      company_name: companyName,
      country: country.code,
      location,
      contract_type: contractType,
      published_at: publishedAt,
      source_url: sourceUrl,
      apply_url: sourceUrl,
      description_short: descriptionShort,
      numeric_id: numericId,
      source_prefix: country.sourcePrefix,
    };
    item.external_id = await buildExternalId(country, item);
    item.missing_fields = findMissingFields(item);
    item.suspicious_terms = detectSuspiciousTerms(item);
    offers.push(item);
  }

  return offers;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scoreQuality(summary) {
  if (summary.parsed === 0) return "no-go";
  if (summary.missingRate > 0.35 || summary.suspiciousCount >= 3) return "maybe";
  if (summary.duplicateNumericIds > 0) return "maybe";
  return "go";
}

function recommendation(summary) {
  if (summary.qualityScore === "go") return "go";
  if (summary.parsed > 0) return "maybe";
  return "no-go";
}

async function auditCountry(country) {
  const pages = [];
  let totalFound = null;
  let detectedMaxPage = 1;
  const offers = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = pageUrl(country, page);
    const html = await fetchText(url);
    pages.push(url);
    if (page === 1) {
      totalFound = extractTotalFound(html);
      detectedMaxPage = extractMaxPage(html, country);
    }
    offers.push(...await parseOffers(country, html));
    if (page < MAX_PAGES) await delay(FETCH_DELAY_MS);
  }

  const seenExternalIds = new Set();
  const duplicateExternalIds = new Set();
  const seenNumericIds = new Set();
  const duplicateNumericIds = new Set();
  const titleCompanyCounts = new Map();
  let missingCount = 0;
  let suspiciousCount = 0;

  for (const offer of offers) {
    if (seenExternalIds.has(offer.external_id)) duplicateExternalIds.add(offer.external_id);
    seenExternalIds.add(offer.external_id);
    if (offer.numeric_id) {
      if (seenNumericIds.has(offer.numeric_id)) duplicateNumericIds.add(offer.numeric_id);
      seenNumericIds.add(offer.numeric_id);
    }
    const key = normalize(`${offer.title}|${offer.company_name ?? ""}`);
    titleCompanyCounts.set(key, (titleCompanyCounts.get(key) ?? 0) + 1);
    missingCount += offer.missing_fields.length;
    if (offer.suspicious_terms.length > 0) suspiciousCount++;
  }

  const repeatedTitleCompany = [...titleCompanyCounts.entries()]
    .filter(([, count]) => count > 1)
    .length;
  const totalFieldSlots = offers.length * 10;
  const missingRate = totalFieldSlots > 0 ? missingCount / totalFieldSlots : 1;
  const summary = {
    country: country.label,
    code: country.code,
    listingUrl: `${country.baseUrl}${country.listingPath}`,
    pages,
    totalFound,
    detectedMaxPage,
    fetchedPages: pages.length,
    parsed: offers.length,
    missingCount,
    missingRate,
    suspiciousCount,
    duplicateExternalIds: duplicateExternalIds.size,
    duplicateNumericIds: duplicateNumericIds.size,
    repeatedTitleCompany,
    numericIdsDetected: offers.filter((offer) => offer.numeric_id).length,
    sourcePrefix: country.sourcePrefix,
    offers,
  };
  summary.qualityScore = scoreQuality(summary);
  summary.recommendation = recommendation(summary);
  return summary;
}

function failedSummary(country, error) {
  return {
    country: country.label,
    code: country.code,
    listingUrl: `${country.baseUrl}${country.listingPath}`,
    pages: [],
    totalFound: null,
    detectedMaxPage: 0,
    fetchedPages: 0,
    parsed: 0,
    missingCount: 0,
    missingRate: 1,
    suspiciousCount: 0,
    duplicateExternalIds: 0,
    duplicateNumericIds: 0,
    repeatedTitleCompany: 0,
    numericIdsDetected: 0,
    sourcePrefix: country.sourcePrefix,
    offers: [],
    qualityScore: "no-go",
    recommendation: "no-go",
    error: error instanceof Error ? error.message : String(error),
  };
}

function mdEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function renderReport(summaries) {
  const now = new Date().toISOString();
  const lines = [
    "# Audit local AfricaTalents prioritaires",
    "",
    `Généré le ${now}.`,
    "",
    "Périmètre: Sénégal, Cameroun, Maroc. Maximum 2 pages téléchargées par pays. Aucun appel Supabase, aucun import, aucune écriture production.",
    "",
    "## Résumé",
    "",
    "| Pays | URL | Total annoncé | Pages détectées | Pages auditées | Offres parsées | Champs manquants | Suspectes | Doublons IDs | Répétitives | Score | Reco |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
  ];

  for (const summary of summaries) {
    lines.push(
      `| ${summary.country} | ${summary.listingUrl} | ${summary.totalFound ?? "n/a"} | ${summary.detectedMaxPage} | ${summary.fetchedPages} | ${summary.parsed} | ${percent(summary.missingRate)} | ${summary.suspiciousCount} | ${summary.duplicateExternalIds} | ${summary.repeatedTitleCompany} | ${summary.qualityScore} | ${summary.recommendation} |`,
    );
  }

  for (const summary of summaries) {
    const sectionLines = [
      "",
      `## ${summary.country}`,
      "",
      `- URL listing: ${summary.listingUrl}`,
      `- Préfixe external_id proposé: \`${summary.sourcePrefix}\``,
      `- IDs numériques détectés: ${summary.numericIdsDetected}/${summary.parsed}`,
      `- Risque doublons: ${
        summary.duplicateExternalIds || summary.duplicateNumericIds || summary.repeatedTitleCompany
          ? "moyen"
          : "faible"
      }`,
      `- Score qualité: ${summary.qualityScore}`,
      `- Recommandation: ${summary.recommendation}`,
      summary.error ? `- Erreur: ${summary.error}` : null,
      "",
      "### Exemples",
      "",
      "| external_id | title | company_name | location | contract_type | published_at | missing | suspicious | source_url |",
      "|---|---|---|---|---|---|---|---|---|",
    ].filter((line) => line !== null);
    lines.push(...sectionLines);

    for (const offer of summary.offers.slice(0, 5)) {
      lines.push(
        `| ${mdEscape(offer.external_id)} | ${mdEscape(offer.title)} | ${mdEscape(offer.company_name)} | ${mdEscape(offer.location)} | ${mdEscape(offer.contract_type)} | ${mdEscape(offer.published_at)} | ${mdEscape(offer.missing_fields.join(", "))} | ${mdEscape(offer.suspicious_terms.join(", "))} | ${mdEscape(offer.source_url)} |`,
      );
    }

    const suspicious = summary.offers.filter((offer) => offer.suspicious_terms.length);
    if (suspicious.length) {
      lines.push("", "### Annonces suspectes signalées", "");
      for (const offer of suspicious.slice(0, 10)) {
        lines.push(
          `- ${offer.title} / ${offer.company_name ?? "n/a"}: ${offer.suspicious_terms.join(", ")} (${offer.source_url})`,
        );
      }
    }
  }

  lines.push(
    "",
    "## Notes techniques",
    "",
    "- Les IDs numériques sont préfixés par source pays pour éviter les collisions entre domaines AfricaTalents.",
    "- Les mots suspects sont signalés seulement; le script ne filtre pas agressivement.",
    "- Le taux de champs manquants est calculé sur external_id, title, company_name, country, location, contract_type, published_at, source_url, apply_url, description_short.",
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const summaries = [];
  for (const country of COUNTRIES) {
    console.log(`Auditing ${country.label}...`);
    try {
      summaries.push(await auditCountry(country));
    } catch (err) {
      console.error(`Failed ${country.label}:`, err instanceof Error ? err.message : err);
      summaries.push(failedSummary(country, err));
    }
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  const report = renderReport(summaries);
  await writeFile(REPORT_PATH, report, "utf8");

  console.log("");
  console.log(`Report written: ${REPORT_PATH}`);
  console.log("");
  for (const summary of summaries) {
    console.log(
      `${summary.country}: parsed=${summary.parsed}, total=${summary.totalFound ?? "n/a"}, missing=${percent(summary.missingRate)}, suspicious=${summary.suspiciousCount}, recommendation=${summary.recommendation}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
