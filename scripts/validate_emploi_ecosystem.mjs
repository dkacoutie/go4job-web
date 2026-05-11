import { mkdir, writeFile } from "node:fs/promises";

const OUTPUT_JSON = "tmp/emploi_ecosystem_validation.json";
const OUTPUT_MD = "tmp/emploi_ecosystem_validation.md";
const USER_AGENT =
  "JobRadarEcosystemValidator/1.0 (+https://go4job.org; public GET validation only)";
const TIMEOUT_MS = 15000;
const SAMPLE_LIMIT = 5;

const QUALITY_BLOCKLIST_CI = [
  "melbet",
  "1xbet",
  "betting",
  "gambling",
  "casino",
  "paris sportifs",
  "pari sportif",
  "bookmaker",
  "affilie marketing betting",
];

const SUSPICIOUS_TERMS_SN = [
  "betting",
  "casino",
  "gambling",
  "affiliate",
  "affilie",
  "mlm",
  "multi level marketing",
  "crypto",
  "cryptomonnaie",
  "cryptocurrency",
  "1xbet",
  "melbet",
];

const REFERENCE_SELECTORS_CI = {
  parser: "custom_parser",
  card: "div.card.card-job[data-href]",
  title: "h3 a",
  company: ".company-name",
  location: "li containing Region de + strong",
  date: "time[datetime]",
  url: "data-href containing /offre-emploi-cote-ivoire/",
};

const REFERENCE_SELECTORS_SN = {
  parser: "custom_parser",
  card: "div.card.card-job[data-href]",
  title: "h3 a",
  company: ".company-name",
  location: "li containing Region de + strong",
  date: "time[datetime] or DD.MM.YYYY fallback",
  url: "data-href containing /offre-emploi-senegal/",
};

const PORTALS = [
  {
    id: "emploi_ci_portal",
    baseUrl: "https://www.emploi.ci",
    listPath: "/recherche-jobs-cote-ivoire",
    country: "CI",
    regionFallback: "Cote d'Ivoire",
    defaultMaxPages: 15,
    referenceRole: "ci_reference",
    signature: {
      cardJob: true,
      dataHref: true,
      h3Anchor: true,
      companyNameClass: true,
      timeDatetime: true,
      offerUrlPattern: "/offre-emploi-cote-ivoire/",
      parserFamily: "emploi_portal",
    },
    selectors: REFERENCE_SELECTORS_CI,
    qualityTerms: QUALITY_BLOCKLIST_CI,
    pageUrl(page) {
      return page <= 1
        ? `${this.baseUrl}${this.listPath}`
        : `${this.baseUrl}${this.listPath}?page=${page - 1}`;
    },
    parse(html) {
      return parseEmploiPortalHtml(html, {
        baseUrl: this.baseUrl,
        offerPathNeedle: "/offre-emploi-cote-ivoire/",
        regionFallback: this.regionFallback,
        signalTerms: this.qualityTerms,
        signalMode: "blocked",
      });
    },
    detectMaxPages(html) {
      return extractQueryPageMax(html, "recherche-jobs-cote-ivoire");
    },
  },
  {
    id: "emploi_educarriere_ci",
    baseUrl: "https://emploi.educarriere.ci",
    listPath: "/nos-offres",
    country: "CI",
    regionFallback: "Cote d'Ivoire",
    defaultMaxPages: 31,
    signature: {
      cardJob: false,
      dataHref: false,
      h3Anchor: false,
      companyNameClass: false,
      timeDatetime: false,
      offerUrlPattern: "/offre-",
      parserFamily: "educarriere",
    },
    selectors: {
      parser: "custom_parser",
      offer_link_regex: "/offre-(id)-(slug).html",
      title: "longest non-contract anchor text, fallback to slug",
      company: null,
      location: "static Cote d'Ivoire",
      date: "Date d'edition and Date limite fields, DD/MM/YYYY",
      url: "absolute offer link",
    },
    pageUrl(page) {
      return page <= 1
        ? `${this.baseUrl}${this.listPath}`
        : `${this.baseUrl}/emploi/page/emploi/${page}`;
    },
    parse(html) {
      return parseEducarriereHtml(html, {
        baseUrl: this.baseUrl,
        regionFallback: this.regionFallback,
      });
    },
    detectMaxPages(html) {
      const text = stripHtml(html);
      const label = text.match(/Page\s*n(?:\u00b0|\u00ba)?\s*\d+\s*sur\s*(\d+)/i);
      if (label) return Number(label[1]);
      let max = 1;
      const re = /\/emploi\/page\/emploi\/(\d+)/gi;
      let match;
      while ((match = re.exec(html)) !== null) {
        max = Math.max(max, Number(match[1]));
      }
      return max;
    },
  },
  {
    id: "emploisenegal_portal",
    baseUrl: "https://www.emploisenegal.com",
    listPath: "/recherche-jobs-senegal",
    country: "SN",
    regionFallback: "Senegal",
    defaultMaxPages: 10,
    signature: {
      cardJob: true,
      dataHref: true,
      h3Anchor: true,
      companyNameClass: true,
      timeDatetime: true,
      offerUrlPattern: "/offre-emploi-senegal/",
      parserFamily: "emploi_portal",
    },
    selectors: REFERENCE_SELECTORS_SN,
    qualityTerms: SUSPICIOUS_TERMS_SN,
    pageUrl(page) {
      return page <= 1
        ? `${this.baseUrl}${this.listPath}`
        : `${this.baseUrl}${this.listPath}?page=${page - 1}`;
    },
    parse(html) {
      return parseEmploiPortalHtml(html, {
        baseUrl: this.baseUrl,
        offerPathNeedle: "/offre-emploi-senegal/",
        regionFallback: this.regionFallback,
        signalTerms: this.qualityTerms,
        signalMode: "suspicious",
      });
    },
    detectMaxPages(html) {
      return extractQueryPageMax(html, "recherche-jobs-senegal");
    },
  },
];

const UNCONFIRMED_COUNTRIES = ["BJ", "TG", "BF", "ML", "GN", "NE", "GH", "NG"].map(
  (country) => ({
    country,
    status: "needs_manual_url_confirmation",
    recommendation: "NEEDS_MANUAL_REVIEW",
    next_action: "Confirm the official job portal URL before automated validation.",
  }),
);

function absoluteUrl(baseUrl, href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

function normalizeText(value) {
  return decodeHtmlEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSignal(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function decodeHtmlEntities(value) {
  return String(value)
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
      String.fromCharCode(parseInt(code, 16)),
    );
}

function stripHtml(html) {
  return normalizeText(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function extractAttr(html, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  return normalizeText(html.match(re)?.[1]);
}

function extractFirst(html, re) {
  return normalizeText(html.match(re)?.[1]);
}

function extractStrongAfterLabel(segment, labelPattern) {
  const re = new RegExp(
    `<li[^>]*>[\\s\\S]*?${labelPattern}[\\s\\S]*?<strong>([\\s\\S]*?)<\\/strong>[\\s\\S]*?<\\/li>`,
    "i",
  );
  return normalizeText(segment.match(re)?.[1]);
}

function detectSignalTerms(item, terms) {
  const haystack = normalizeForSignal(
    `${item.title} ${item.company ?? ""} ${item.description ?? ""}`,
  );
  return terms.filter((term) => haystack.includes(normalizeForSignal(term)));
}

function parseEmploiPortalHtml(html, options) {
  const cardRe = /<div\b[^>]*class=["'][^"']*\bcard\b[^"']*\bcard-job\b[^"']*["'][^>]*>/gi;
  const matches = Array.from(html.matchAll(cardRe));
  const examples = [];
  let qualitySignalCount = 0;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const next = matches[i + 1]?.index ?? html.length;
    const segment = html.slice(start, next);
    const url = absoluteUrl(options.baseUrl, extractAttr(matches[i][0], "data-href"));

    if (!url || !url.includes(options.offerPathNeedle)) continue;

    const title = extractFirst(
      segment,
      /<h3[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i,
    );
    if (!title) continue;

    const company =
      extractFirst(
        segment,
        /class=["'][^"']*\bcompany-name\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      ) || null;
    const description =
      extractFirst(
        segment,
        /<div\b[^>]*class=["'][^"']*\bcard-job-description\b[^"']*["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
      ) || null;
    const location =
      extractStrongAfterLabel(segment, "R(?:\\u00e9|e)gion\\s+de") ||
      options.regionFallback;
    const date =
      extractAttr(
        segment.match(/<time\b[^>]*datetime=["'][^"']+["'][^>]*>/i)?.[0] ?? "",
        "datetime",
      ) || extractDottedDate(segment);
    const signalTerms = detectSignalTerms({ title, company, description }, options.signalTerms);
    if (signalTerms.length > 0) qualitySignalCount++;

    examples.push({
      title,
      company,
      location,
      date: date || null,
      url,
      quality_signal: options.signalMode,
      matched_terms: signalTerms,
    });
  }

  return {
    offer_count: examples.length,
    examples: examples.slice(0, SAMPLE_LIMIT),
    offer_urls: examples.map((item) => item.url),
    quality_signal_count: qualitySignalCount,
  };
}

const CONTRACT_TYPES = new Set([
  "emploi",
  "stage",
  "interim",
  "freelance",
  "consultance",
  "cdd",
  "cdi",
]);

function parseEducarriereHtml(html, options) {
  const linkRe =
    /<a\b[^>]*href=["']([^"']*\/offre-(\d+)-([^"']+?)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [];
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    matches.push({
      href: match[1],
      offerId: match[2],
      slug: match[3] ?? "",
      text: stripHtml(match[4]),
      index: match.index,
    });
  }

  const grouped = new Map();
  for (const item of matches) {
    const group = grouped.get(item.offerId) ?? [];
    group.push(item);
    grouped.set(item.offerId, group);
  }

  const examples = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const nextIndex =
      matches.find((candidate) => candidate.index > first.index && candidate.offerId !== first.offerId)
        ?.index ?? html.length;
    const segment = html.slice(first.index, nextIndex);
    const segmentText = stripHtml(segment);
    const anchorTexts = group.map((item) => normalizeText(item.text));
    const title = extractEducarriereTitle(anchorTexts, first.slug);
    const published = parseFrenchDate(
      extractTextField(segmentText, "Date d['\\u2019](?:e|\\u00e9)dition"),
    );

    examples.push({
      title,
      company: null,
      location: options.regionFallback,
      date: published,
      url: absoluteUrl(options.baseUrl, first.href),
    });
  }

  return {
    offer_count: examples.length,
    examples: examples.slice(0, SAMPLE_LIMIT),
    offer_urls: examples.map((item) => item.url),
    quality_signal_count: 0,
  };
}

function extractEducarriereTitle(anchorTexts, slug) {
  const candidates = anchorTexts.filter(
    (text) => text && !CONTRACT_TYPES.has(text.toLowerCase()),
  );
  return (
    candidates.sort((a, b) => b.length - a.length)[0] ??
    slug
      .replace(/\.html?$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ")
  );
}

function extractTextField(text, labelPattern) {
  const re = new RegExp(
    `${labelPattern}\\s*:\\s*([^:]+?)(?=\\s+(?:Code|Date d['\\u2019](?:e|\\u00e9)dition|Date limite)\\s*:|$)`,
    "i",
  );
  return normalizeText(text.match(re)?.[1]);
}

function parseFrenchDate(value) {
  const match = normalizeText(value).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year || month > 12 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function extractDottedDate(html) {
  const match = normalizeText(html.match(/(?:\n|>|\s)(\d{2})\.(\d{2})\.(\d{4})(?:\s|<|$)/)?.[0])
    .match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`).toISOString();
}

function extractQueryPageMax(html, pathName) {
  let max = 1;
  const re = new RegExp(`${pathName}\\?page=(\\d+)`, "gi");
  let match;
  while ((match = re.exec(html)) !== null) {
    max = Math.max(max, Number(match[1]) + 1);
  }
  return max;
}

async function detectFeed(html, baseUrl) {
  const candidateUrls = discoverFeedUrls(html, baseUrl);
  const probes = [];

  for (const url of candidateUrls.slice(0, 8)) {
    const response = await fetchText(url, {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
      timeoutMs: 10000,
    });
    const parsed = parseFeedSample(response.text);
    const contentType = response.contentType ?? "";
    const looksLikeFeed =
      response.ok &&
      (/(?:rss|atom|xml)/i.test(contentType) || /^\s*<\?xml|<rss\b|<feed\b/i.test(response.text)) &&
      parsed.item_count > 0;

    probes.push({
      url,
      status: response.status,
      ok: response.ok,
      content_type: contentType || null,
      is_feed: looksLikeFeed,
      item_count: parsed.item_count,
      examples: parsed.examples,
      error: response.error,
    });
  }

  return {
    detected: probes.some((probe) => probe.is_feed) || /\b(?:rss|atom|feed)\b/i.test(html),
    links: probes.filter((probe) => probe.is_feed).map((probe) => probe.url),
    candidates: candidateUrls,
    probes,
  };
}

function discoverFeedUrls(html, baseUrl) {
  const urls = [];
  const tagRe = /<(?:link|a)\b[^>]+>/gi;

  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    const rel = extractAttr(tag, "rel");
    const type = extractAttr(tag, "type");
    const href = extractAttr(tag, "href");
    if (!href) continue;
    if (
      /(?:alternate|feed|rss|atom)/i.test(rel) ||
      /(?:rss|atom|xml)/i.test(type) ||
      /(?:rss|atom|feed|xml)(?:[/?#.]|$)/i.test(href)
    ) {
      urls.push(absoluteUrl(baseUrl, href));
    }
  }

  for (const path of ["/rss.xml", "/feed", "/rss"]) {
    urls.push(`${baseUrl}${path}`);
  }

  return [...new Set(urls)].slice(0, 12);
}

function parseFeedSample(xml) {
  const itemBlocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);

  return {
    item_count: itemBlocks.length,
    examples: itemBlocks.slice(0, 5).map((block) => ({
      title: stripHtml(extractXmlTag(block, "title")) || null,
      link: extractFeedLink(block),
      date:
        stripHtml(extractXmlTag(block, "pubDate")) ||
        stripHtml(extractXmlTag(block, "published")) ||
        stripHtml(extractXmlTag(block, "updated")) ||
        null,
    })),
  };
}

function extractXmlTag(xml, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return decodeCdata(xml.match(re)?.[1] ?? "");
}

function extractFeedLink(block) {
  const rssLink = stripHtml(extractXmlTag(block, "link"));
  if (rssLink) return rssLink;
  const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return atomLink ? decodeHtmlEntities(atomLink) : null;
}

function decodeCdata(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function looksBlocked(response, html) {
  const status = response?.status ?? 0;
  if ([401, 403, 429, 503].includes(status)) return true;
  const text = stripHtml(html ?? "").toLowerCase();
  return [
    "access denied",
    "forbidden",
    "too many requests",
    "captcha",
    "cloudflare",
    "checking your browser",
  ].some((needle) => text.includes(needle));
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: options.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const bytes = await response.arrayBuffer();
    const text = decodeResponseBody(bytes, response.headers.get("content-type"));
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      finalUrl: response.url,
      elapsedMs: Date.now() - startedAt,
      text,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      finalUrl: url,
      elapsedMs: Date.now() - startedAt,
      text: "",
      error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeResponseBody(bytes, contentType) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
  const headerCharset = contentType?.match(/charset=([^;]+)/i)?.[1];
  const preview = new TextDecoder("windows-1252").decode(buffer.slice(0, 4096));
  const metaCharset =
    preview.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i)?.[1] ??
    preview.match(/<meta[^>]+content=["'][^"']*charset=([^"'\s;>]+)/i)?.[1];
  const charset = normalizeCharset(headerCharset ?? metaCharset ?? "utf-8");

  try {
    const decoded = new TextDecoder(charset).decode(buffer);
    if (/\u00c3|\u00c2|\ufffd/.test(decoded) && charset !== "windows-1252") {
      const windowsDecoded = new TextDecoder("windows-1252").decode(buffer);
      if (!/\u00c3|\u00c2|\ufffd/.test(windowsDecoded)) return windowsDecoded;
    }
    return decoded;
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function normalizeCharset(charset) {
  const value = String(charset).trim().toLowerCase();
  if (value === "iso-8859-1" || value === "latin1" || value === "latin-1") {
    return "windows-1252";
  }
  return value || "utf-8";
}

function parseRobots(robotsText, pathName) {
  if (!robotsText) {
    return { allowed: true, matched_rule: null, note: "robots.txt unavailable or empty" };
  }

  const groups = [];
  let current = null;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (key === "user-agent") {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value });
    }
  }

  const relevant = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || USER_AGENT.toLowerCase().includes(agent)),
  );
  const rules = relevant.flatMap((group) => group.rules).filter((rule) => rule.path !== "");
  const matches = rules
    .filter((rule) => robotsRuleMatches(rule.path, pathName))
    .sort((a, b) => b.path.length - a.path.length);

  const strongest = matches[0] ?? null;
  return {
    allowed: strongest?.type !== "disallow",
    matched_rule: strongest,
    note: strongest ? `${strongest.type}: ${strongest.path}` : "no matching disallow rule",
  };
}

function robotsRuleMatches(rulePath, pathName) {
  if (!rulePath) return false;
  const escaped = rulePath
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const pattern = escaped.endsWith("\\$")
    ? `^${escaped.slice(0, -2)}$`
    : `^${escaped}`;
  return new RegExp(pattern).test(pathName);
}

function compareSimilarity(reference, candidate) {
  const checks = [
    "cardJob",
    "dataHref",
    "h3Anchor",
    "companyNameClass",
    "timeDatetime",
    "parserFamily",
  ];
  const matched = checks.filter((key) => reference.signature[key] === candidate.signature[key]);
  return {
    score: Number((matched.length / checks.length).toFixed(2)),
    matched_fields: matched,
    compared_fields: checks,
  };
}

function recommendPortal(result) {
  if (result.blocked_by_site || result.robots?.allowed === false) return "BLOCKED_BY_SITE";
  if (!result.list_page?.ok || result.offers_detected_page1 === 0) return "NEEDS_MANUAL_REVIEW";
  if (result.id === "emploi_educarriere_ci") return "SPECIFIC_CONNECTOR_REQUIRED";
  if ((result.similarity_with_ci?.score ?? 0) >= 0.8) return "GO_GENERIC";
  if ((result.similarity_with_ci?.score ?? 0) >= 0.5) return "GO_GENERIC_WITH_OVERRIDES";
  return "SPECIFIC_CONNECTOR_REQUIRED";
}

function globalDecision(results) {
  if (results.some((item) => item.recommendation === "BLOCKED_BY_SITE")) {
    return {
      decision: "BLOCKED_BY_SITE",
      rationale: "At least one confirmed source appears blocked or disallowed by robots.txt.",
    };
  }

  const ci = results.find((item) => item.id === "emploi_ci_portal");
  const sn = results.find((item) => item.id === "emploisenegal_portal");
  const educarriere = results.find((item) => item.id === "emploi_educarriere_ci");

  if (!ci?.list_page?.ok || !sn?.list_page?.ok) {
    return {
      decision: "NEEDS_MANUAL_REVIEW",
      rationale: "The CI reference and SN portal must both be reachable before validating a generic connector.",
    };
  }

  if ((ci.offers_detected_page1 ?? 0) === 0 || (sn.offers_detected_page1 ?? 0) === 0) {
    return {
      decision: "NEEDS_MANUAL_REVIEW",
      rationale: "The CI reference or SN portal did not expose parseable offers on page 1.",
    };
  }

  const snScore = sn.similarity_with_ci?.score ?? 0;
  const educarriereSpecific = educarriere?.recommendation === "SPECIFIC_CONNECTOR_REQUIRED";
  if (snScore >= 0.8 && educarriereSpecific) {
    return {
      decision: "GO_GENERIC_WITH_OVERRIDES",
      rationale:
        "Emploi.ci and Emploi Senegal are highly similar, while Educarriere needs a source-specific parser.",
    };
  }
  if (snScore >= 0.8) {
    return {
      decision: "GO_GENERIC",
      rationale: "Confirmed Emploi portals are highly similar and functioning.",
    };
  }
  if (snScore >= 0.5) {
    return {
      decision: "GO_GENERIC_WITH_OVERRIDES",
      rationale: "The SN portal is partially similar to the CI reference.",
    };
  }

  return {
    decision: "SPECIFIC_CONNECTOR_REQUIRED",
    rationale: "Confirmed portal structures are too different for a generic connector V1.",
  };
}

async function validatePortal(portal, ciReferencePortal) {
  const base = await fetchText(portal.baseUrl);
  const robotsUrl = `${portal.baseUrl}/robots.txt`;
  const robotsResponse = await fetchText(robotsUrl, { accept: "text/plain,*/*;q=0.8" });
  const robots = {
    url: robotsUrl,
    status: robotsResponse.status,
    ok: robotsResponse.ok,
    ...parseRobots(robotsResponse.text, portal.listPath),
  };

  const listUrl = portal.pageUrl(1);
  const result = {
    id: portal.id,
    country: portal.country,
    region_fallback: portal.regionFallback,
    urls_tested: {
      base: portal.baseUrl,
      robots: robotsUrl,
      list_page_1: listUrl,
      list_page_2: portal.pageUrl(2),
    },
    base_page: summarizeResponse(base),
    robots,
    selectors: portal.selectors,
    max_pages_default: portal.defaultMaxPages,
    list_page: null,
    page2: null,
    offers_detected_page1: 0,
    examples: [],
    rss: { detected: false, links: [] },
    pagination: {
      configured: true,
      detected_max_pages: null,
      page2_different: null,
      different_url_count: 0,
    },
    blocked_by_site: false,
    similarity_with_ci: portal.id === ciReferencePortal.id ? { score: 1, reference: true } : null,
    recommendation: null,
    next_action: null,
  };

  if (portal.id !== ciReferencePortal.id) {
    result.similarity_with_ci = compareSimilarity(ciReferencePortal, portal);
  }

  if (robots.allowed === false) {
    result.blocked_by_site = true;
    result.recommendation = "BLOCKED_BY_SITE";
    result.next_action = "Do not fetch the list page automatically; review robots.txt and source terms.";
    return result;
  }

  const page1 = await fetchText(listUrl);
  result.list_page = summarizeResponse(page1);
  result.blocked_by_site = looksBlocked(page1, page1.text);
  if (page1.ok && !result.blocked_by_site) {
    const parsed = portal.parse(page1.text);
    result.offers_detected_page1 = parsed.offer_count;
    result.examples = parsed.examples;
    result.quality_signal_count = parsed.quality_signal_count;
    result.rss = await detectFeed(page1.text, portal.baseUrl);
    result.pagination.detected_max_pages = portal.detectMaxPages(page1.text);

    const page2 = await fetchText(portal.pageUrl(2));
    result.page2 = summarizeResponse(page2);
    if (page2.ok && !looksBlocked(page2, page2.text)) {
      const parsedPage2 = portal.parse(page2.text);
      const page1Urls = new Set(parsed.offer_urls);
      const differentUrls = parsedPage2.offer_urls.filter((url) => !page1Urls.has(url));
      result.pagination.page2_different = differentUrls.length > 0;
      result.pagination.different_url_count = differentUrls.length;
      result.pagination.offers_detected_page2 = parsedPage2.offer_count;
    } else {
      result.pagination.page2_different = null;
      result.pagination.page2_error = page2.error ?? page2.statusText ?? "page2 not ok";
    }
  }

  result.recommendation = recommendPortal(result);
  result.next_action = nextActionForRecommendation(result.recommendation, result.id);
  return result;
}

function summarizeResponse(response) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    elapsedMs: response.elapsedMs,
    error: response.error,
  };
}

function nextActionForRecommendation(recommendation, id) {
  if (recommendation === "GO_GENERIC") {
    return "Use the Emploi portal parser signature as the generic baseline.";
  }
  if (recommendation === "GO_GENERIC_WITH_OVERRIDES") {
    return "Build a generic Emploi portal parser and keep source-level overrides.";
  }
  if (recommendation === "SPECIFIC_CONNECTOR_REQUIRED") {
    return `Keep ${id} as a dedicated connector/parser.`;
  }
  if (recommendation === "BLOCKED_BY_SITE") {
    return "Do not bypass protections; perform manual review or seek permission.";
  }
  return "Review HTML manually and confirm source behavior.";
}

function markdownReport(report) {
  const lines = [];
  lines.push("# Emploi Ecosystem Validation");
  lines.push("");
  lines.push(`Generated at: ${report.generated_at}`);
  lines.push("");
  lines.push(`## Global decision: ${report.global.decision}`);
  lines.push("");
  lines.push(report.global.rationale);
  lines.push("");
  lines.push(`Next action: ${report.global.next_action}`);
  lines.push("");
  lines.push("## Confirmed portals");
  for (const portal of report.confirmed_portals) {
    lines.push("");
    lines.push(`### ${portal.id}`);
    lines.push("");
    lines.push(`- Country: ${portal.country}`);
    lines.push(`- Recommendation: ${portal.recommendation}`);
    lines.push(`- Next action: ${portal.next_action}`);
    lines.push(`- Base URL: ${portal.urls_tested.base}`);
    lines.push(`- Robots URL: ${portal.urls_tested.robots}`);
    lines.push(`- List page 1: ${portal.urls_tested.list_page_1}`);
    lines.push(`- List page 2: ${portal.urls_tested.list_page_2}`);
    lines.push(`- Base HTTP: ${formatStatus(portal.base_page)}`);
    lines.push(`- Robots HTTP: ${portal.robots.status ?? "ERR"} (${portal.robots.note})`);
    lines.push(`- List HTTP: ${formatStatus(portal.list_page)}`);
    lines.push(`- Page 2 HTTP: ${formatStatus(portal.page2)}`);
    lines.push(`- Offers detected page 1: ${portal.offers_detected_page1}`);
    lines.push(`- Pagination detected max pages: ${portal.pagination.detected_max_pages ?? "n/a"}`);
    lines.push(`- Page 2 different: ${formatNullable(portal.pagination.page2_different)}`);
    lines.push(`- Page 2 different URL count: ${portal.pagination.different_url_count}`);
    lines.push(`- RSS/feed detected: ${portal.rss.detected ? "yes" : "no"}`);
    if (portal.rss.links.length > 0) {
      lines.push(`- RSS/feed links: ${portal.rss.links.join(", ")}`);
    }
    if (portal.rss.probes?.length > 0) {
      lines.push("- RSS/feed probes:");
      for (const probe of portal.rss.probes) {
        lines.push(
          `  - ${probe.url} | HTTP ${probe.status ?? "ERR"} | ${
            probe.content_type ?? "n/a"
          } | items ${probe.item_count} | confirmed ${probe.is_feed ? "yes" : "no"}`,
        );
      }
    }
    lines.push(
      `- Similarity with CI: ${
        portal.similarity_with_ci?.score ?? "reference"
      }`,
    );
    lines.push("");
    lines.push("Examples:");
    if (portal.examples.length === 0) {
      lines.push("- None");
    } else {
      for (const example of portal.examples) {
        lines.push(
          `- ${example.title || "Untitled"} | ${example.company ?? "n/a"} | ${
            example.location ?? "n/a"
          } | ${example.date ?? "n/a"} | ${example.url}`,
        );
      }
    }
  }

  lines.push("");
  lines.push("## Unconfirmed candidates");
  for (const candidate of report.unconfirmed_candidates) {
    lines.push(
      `- ${candidate.country}: ${candidate.status}; recommendation ${candidate.recommendation}; next action: ${candidate.next_action}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatStatus(response) {
  if (!response) return "not tested";
  if (response.error) return `ERR (${response.error})`;
  return `${response.status ?? "ERR"} ${response.statusText ?? ""}`.trim();
}

function formatNullable(value) {
  if (value === null || value === undefined) return "unknown";
  return value ? "yes" : "no";
}

async function main() {
  const ciReferencePortal = PORTALS.find((portal) => portal.id === "emploi_ci_portal");
  const confirmedResults = [];

  for (const portal of PORTALS) {
    console.log(`Validating ${portal.id}...`);
    confirmedResults.push(await validatePortal(portal, ciReferencePortal));
  }

  const global = globalDecision(confirmedResults);
  global.next_action =
    global.decision === "GO_GENERIC_WITH_OVERRIDES"
      ? "Prototype a generic Emploi portal connector for CI/SN, with Educarriere as a specific parser."
      : nextActionForRecommendation(global.decision, "emploi ecosystem");

  const report = {
    generated_at: new Date().toISOString(),
    user_agent: USER_AGENT,
    timeout_ms: TIMEOUT_MS,
    reference_selectors_ci: REFERENCE_SELECTORS_CI,
    reference_selectors_sn: REFERENCE_SELECTORS_SN,
    global,
    confirmed_portals: confirmedResults,
    unconfirmed_candidates: UNCONFIRMED_COUNTRIES,
  };

  await mkdir("tmp", { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_MD, markdownReport(report), "utf8");

  console.log(`Wrote ${OUTPUT_JSON}`);
  console.log(`Wrote ${OUTPUT_MD}`);
  console.log(`Global decision: ${global.decision}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
