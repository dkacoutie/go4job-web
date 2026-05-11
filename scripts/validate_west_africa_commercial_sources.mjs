import { mkdir, writeFile } from "node:fs/promises";

const OUT_JSON = "tmp/west_africa_commercial_sources_validation.json";
const OUT_MD = "tmp/west_africa_commercial_sources_validation.md";
const USER_AGENT = "JobRadarWestAfricaValidator/1.0 (+https://go4job.org; public GET validation only)";
const MIN_DOMAIN_DELAY_MS = 1000;
const TIMEOUT_MS = 15000;

const SOURCES = [
  {
    id: "myjobmag_ng_rss",
    name: "MyJobMag Nigeria",
    country: "Nigeria",
    baseUrl: "https://www.myjobmag.com",
    mainUrl: "https://www.myjobmag.com/jobs",
    linkNeedle: "myjobmag.com",
    jobUrlPatterns: ["/job/", "/jobs/"],
    excludeUrlPatterns: ["/jobs-by-", "/jobs-location", "/jobs/feed", "/blog", "/course", "/employers", "/signup"],
    priority: "P0",
  },
  {
    id: "myjobmag_gh_rss",
    name: "MyJobMag Ghana",
    country: "Ghana",
    baseUrl: "https://www.myjobmagghana.com",
    mainUrl: "https://www.myjobmagghana.com/jobs",
    linkNeedle: "myjobmagghana.com",
    jobUrlPatterns: ["/job/", "/jobs/"],
    excludeUrlPatterns: ["/jobs-by-", "/jobs-location", "/jobs/feed", "/blog", "/course", "/employers", "/signup"],
    priority: "P0",
  },
  {
    id: "ngojobs_africa_rss",
    name: "NGO Jobs in Africa",
    country: "West Africa",
    baseUrl: "https://ngojobsinafrica.com",
    mainUrl: "https://ngojobsinafrica.com/jobs",
    linkNeedle: "ngojobsinafrica.com",
    jobUrlPatterns: ["ngojobsinafrica.com/"],
    excludeUrlPatterns: ["/category/", "/tag/", "/job-tag/", "/job-location/", "/author/", "/page/", "/jobs/"],
    rssOnly: true,
    priority: "P0",
  },
  {
    id: "jobwebghana_portal",
    name: "JobWeb Ghana",
    country: "Ghana",
    baseUrl: "https://jobwebghana.com",
    mainUrl: "https://jobwebghana.com/jobs",
    linkNeedle: "jobwebghana.com",
    jobUrlPatterns: ["/jobs/"],
    excludeUrlPatterns: ["/job-category/", "/job-location/", "/page/"],
    priority: "P0/P1",
  },
  {
    id: "hotnigerianjobs_portal",
    name: "HotNigerianJobs",
    country: "Nigeria",
    baseUrl: "https://www.hotnigerianjobs.com",
    mainUrl: "https://www.hotnigerianjobs.com/",
    linkNeedle: "hotnigerianjobs.com",
    jobUrlPatterns: ["/jobs/"],
    excludeUrlPatterns: ["/jobs/featured", "/jobs/today", "/jobs/lastweek", "/industry/", "/field/", "/role/", "/recruiter", "/employer"],
    priority: "P0",
    htmlFirst: true,
  },
  {
    id: "novojob_portal",
    name: "Novojob",
    country: "West Africa Francophone",
    baseUrl: "https://www.novojob.com",
    mainUrl: "https://www.novojob.com/offres-emploi",
    linkNeedle: "novojob.com",
    jobUrlPatterns: ["/offre-d-emploi/"],
    excludeUrlPatterns: ["/entreprises/", "/candidats/", "/conseils/"],
    priority: "P0",
  },
  {
    id: "goafricaonline_ci_portal",
    name: "Go Africa Online CI",
    country: "Cote d'Ivoire",
    baseUrl: "https://www.goafricaonline.com",
    mainUrl: "https://www.goafricaonline.com/ci/emploi",
    linkNeedle: "goafricaonline.com/ci",
    jobUrlPatterns: ["/ci/emploi/job-"],
    excludeUrlPatterns: ["/packs-", "/annuaire", "/actualites"],
    priority: "P0 CI",
    htmlFirst: true,
  },
  {
    id: "jobberman_ng_portal",
    name: "Jobberman Nigeria",
    country: "Nigeria",
    baseUrl: "https://www.jobberman.com",
    mainUrl: "https://www.jobberman.com/jobs",
    linkNeedle: "jobberman.com",
    jobUrlPatterns: ["/listings/"],
    excludeUrlPatterns: ["/discover/", "/account/", "/employer", "/job-seeker"],
    priority: "validation",
    htmlFirst: true,
  },
  {
    id: "jobberman_gh_portal",
    name: "Jobberman Ghana",
    country: "Ghana",
    baseUrl: "https://www.jobberman.com.gh",
    mainUrl: "https://www.jobberman.com.gh/jobs",
    linkNeedle: "jobberman.com.gh",
    jobUrlPatterns: ["/listings/"],
    excludeUrlPatterns: ["/discover/", "/account/", "/employer", "/job-seeker"],
    priority: "validation",
    htmlFirst: true,
  },
];

const STANDARD_PATHS = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/jobs/feed", "/sitemap.xml", "/sitemap_index.xml"];
const QUALITY_TERMS = ["betting", "casino", "gambling", "1xbet", "melbet", "crypto", "mlm", "parrainage", "revenus passifs", "trading miracle", "whatsapp-only", "whatsapp only"];
const lastDomainFetch = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function domainOf(url) {
  return new URL(url).hostname;
}

async function politeFetch(url) {
  const domain = domainOf(url);
  const last = lastDomainFetch.get(domain) ?? 0;
  const wait = Math.max(0, MIN_DOMAIN_DELAY_MS - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  lastDomainFetch.set(domain, Date.now());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml,application/rss+xml,application/xml,text/xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "";
    const text = decodeResponse(bytes, contentType);
    return {
      url,
      final_url: response.url,
      ok: response.ok,
      status: response.status,
      content_type: contentType,
      elapsed_ms: Date.now() - started,
      text,
      blocked: isBlocked(response.status, text),
      error: null,
    };
  } catch (error) {
    return {
      url,
      final_url: url,
      ok: false,
      status: null,
      content_type: null,
      elapsed_ms: Date.now() - started,
      text: "",
      blocked: false,
      error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeResponse(bytes, contentType) {
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() ?? "utf-8";
  try {
    const decoded = new TextDecoder(charset === "iso-8859-1" ? "windows-1252" : charset).decode(bytes);
    if (/\u00c3|\u00c2|\ufffd/.test(decoded)) {
      const fallback = new TextDecoder("windows-1252").decode(bytes);
      if (!/\u00c3|\u00c2|\ufffd/.test(fallback)) return fallback;
    }
    return decoded;
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#038;/gi, "&")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8230;/gi, "\u2026")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlocked(status, text) {
  if ([401, 403, 429].includes(status)) return true;
  const plain = cleanText(text).toLowerCase();
  return ["cloudflare", "captcha", "checking your browser", "login required", "access denied"].some((term) => plain.includes(term));
}

function isQualityBlocked(job) {
  const hay = `${job.title} ${job.description ?? ""}`.toLowerCase();
  return QUALITY_TERMS.some((term) => hay.includes(term));
}

function tagValue(xml, tag) {
  return cleanText(xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function parseFeed(text, source) {
  const blocks = [
    ...Array.from(text.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((m) => m[0]),
    ...Array.from(text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((m) => m[0]),
  ];
  return normalizeJobs(blocks.map((block) => {
    const link = tagValue(block, "link") || cleanText(block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? "");
    return {
      title: tagValue(block, "title"),
      source_url: link,
      detected_country: source.country,
      date: tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated") || null,
      description: tagValue(block, "description") || tagValue(block, "summary") || null,
    };
  }), source);
}

function parseSitemap(text, source) {
  const urls = Array.from(text.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)).map((m) => cleanText(m[1]));
  return normalizeJobs(urls.filter((url) => isJobUrl(url, source)).map((url) => ({
    title: titleFromUrl(url),
    source_url: url,
    detected_country: source.country,
    date: null,
    description: null,
  })), source);
}

function parseHtml(text, source) {
  const links = Array.from(text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const seen = new Set();
  const jobs = [];
  for (const match of links) {
    const href = absUrl(source.baseUrl, match[1] ?? "");
    if (!href || seen.has(href) || !isJobUrl(href, source)) continue;
    const title = cleanText(match[2]);
    if (!title || title.length < 5 || title.length > 180) continue;
    seen.add(href);
    jobs.push({ title, source_url: href, detected_country: source.country, date: null, description: null });
  }
  return normalizeJobs(jobs, source);
}

function isJobUrl(url, source) {
  if (!url || !url.includes(source.linkNeedle)) return false;
  const lowerUrl = url.toLowerCase();
  if ((source.excludeUrlPatterns ?? []).some((pattern) => lowerUrl.includes(pattern.toLowerCase()))) {
    return false;
  }
  return (source.jobUrlPatterns ?? [source.linkNeedle]).some((pattern) => lowerUrl.includes(pattern.toLowerCase()));
}

function normalizeJobs(jobs, source) {
  const out = [];
  const seen = new Set();
  for (const job of jobs) {
    const normalized = source.id === "ngojobs_africa_rss" ? normalizeNgoJob(job) : job;
    if (source.id === "ngojobs_africa_rss" && isNgoNonJob(normalized)) continue;
    if (source.id === "ngojobs_africa_rss" && normalized.detected_country === "Unknown") continue;
    if (seen.has(normalized.source_url)) continue;
    seen.add(normalized.source_url);
    if (!normalized.title || !normalized.source_url || !normalized.detected_country) continue;
    if (isQualityBlocked(normalized)) continue;
    out.push({
      title: normalized.title,
      source_url: normalized.source_url,
      detected_country: normalized.detected_country,
      date: normalized.date,
    });
  }
  return out.slice(0, 20);
}

function normalizeNgoJob(job) {
  return { ...job, detected_country: detectNgoCountry(job) ?? "Unknown" };
}

function normalizeAscii(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function isNgoNonJob(job) {
  const haystack = normalizeAscii(`${job.title} ${job.description ?? ""} ${job.source_url}`);
  const programJobExceptions = ["programme officer", "program officer", "programme manager", "program manager"];
  if (programJobExceptions.some((term) => haystack.includes(term))) return false;
  const terms = [
    "scholarship",
    "scholarships",
    "fellowship",
    "fellowships",
    "programme application",
    "program application",
    "programmes application",
    "internship placement program",
    "young professionals program",
    "apprenticeship training program",
    "grant",
    "grants",
    "award",
    "awards",
    "scheme",
    "masters degree scholarship",
    "master's degree scholarship",
    "call for applications",
    "training programme",
    "accelerator",
    "incubation",
    "competition",
  ];
  if (terms.some((term) => haystack.includes(normalizeAscii(term)))) return true;
  return /\bprogram(me)?s?\b/.test(normalizeAscii(job.title));
}

function detectNgoCountry(job) {
  const haystack = normalizeAscii(`${job.source_url} ${job.title} ${job.description ?? ""}`);
  const countries = [
    { country: "Nigeria", signals: ["nigeria", "lagos", "abuja", "kano", "borno", "adamawa"] },
    { country: "Ghana", signals: ["ghana", "accra", "kumasi"] },
    { country: "Cote d'Ivoire", signals: ["cote d'ivoire", "cote d ivoire", "ivory coast", "abidjan"] },
    { country: "Senegal", signals: ["senegal", "dakar"] },
    { country: "Benin", signals: ["benin", "cotonou"] },
    { country: "Togo", signals: ["togo", "lome"] },
    { country: "Burkina Faso", signals: ["burkina faso", "ouagadougou"] },
    { country: "Mali", signals: ["mali", "bamako"] },
    { country: "Guinea", signals: ["guinea", "conakry"] },
    { country: "Niger", signals: ["niger", "niamey"] },
  ];
  return countries.find((entry) => entry.signals.some((signal) => haystack.includes(signal)))?.country ?? null;
}

function absUrl(baseUrl, href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

function titleFromUrl(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "job";
  return slug.replace(/[-_]+/g, " ").replace(/\.\w+$/, "").trim() || "Job listing";
}

function feedCandidates(source, html) {
  const found = [];
  for (const match of html.matchAll(/<link\b[^>]+>/gi)) {
    const tag = match[0];
    if (!/alternate|rss|atom|feed/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1] ?? "";
    if (href && /rss|atom|xml|alternate/i.test(type + tag)) found.push(absUrl(source.baseUrl, href));
  }
  return [...new Set([...found, ...STANDARD_PATHS.map((path) => `${source.baseUrl}${path}`)])];
}

async function validateSource(source) {
  const main = await politeFetch(source.mainUrl);
  const probes = [summarizeFetch(main)];
  if (main.blocked) return classify(source, "PAUSE_TECH_RISK", main, probes, [], "blocked_main_request");
  if (main.status >= 500) return classify(source, "STOP", main, probes, [], "server_error_main_request");

  const candidates = source.htmlFirst ? [] : feedCandidates(source, main.text);
  for (const url of candidates) {
    const res = await politeFetch(url);
    probes.push(summarizeFetch(res));
    if (res.blocked) return classify(source, "PAUSE_TECH_RISK", res, probes, [], "blocked_feed_probe");
    if (!res.ok) continue;
    if (source.rssOnly && /sitemap/i.test(url)) continue;
    const samples = /sitemap/i.test(url) ? parseSitemap(res.text, source) : parseFeed(res.text, source);
    if (samples.length >= 3) {
      const recommendation = /sitemap/i.test(url) ? "GO_SITEMAP" : "GO_RSS";
      return classify(source, recommendation, res, probes, samples, "validated_structured_source");
    }
  }

  if (source.rssOnly) {
    return classify(source, "NEEDS_SPECIFIC_PARSER", main, probes, [], "rss_accessible_but_clean_samples_insufficient");
  }

  if (main.ok) {
    const samples = parseHtml(main.text, source);
    if (samples.length >= 3 && !main.blocked) {
      return classify(source, "GO_HTML_DRY_RUN", main, probes, samples, "validated_html_dry_run");
    }
    return classify(source, "NEEDS_SPECIFIC_PARSER", main, probes, samples, "html_accessible_but_samples_insufficient");
  }

  return classify(source, main.status >= 500 ? "STOP" : "PAUSE_TECH_RISK", main, probes, [], "main_request_not_usable");
}

function summarizeFetch(res) {
  return {
    url: res.url,
    final_url: res.final_url,
    status: res.status,
    content_type: res.content_type,
    blocked: res.blocked,
    error: res.error,
  };
}

function classify(source, recommendation, response, probes, samples, reason) {
  return {
    id: source.id,
    name: source.name,
    priority: source.priority,
    country: source.country,
    main_url: source.mainUrl,
    recommendation,
    reason,
    http_status: response.status,
    content_type: response.content_type,
    samples: samples.slice(0, 5),
    sample_count: samples.length,
    probes,
    short_term_potential: estimatePotential(recommendation, samples.length, source),
  };
}

function estimatePotential(recommendation, sampleCount, source) {
  if (recommendation === "GO_RSS") return source.id.includes("relief") ? 50 : 100;
  if (recommendation === "GO_SITEMAP") return 200;
  if (recommendation === "GO_HTML_DRY_RUN") return Math.max(50, sampleCount * 20);
  return 0;
}

function markdown(report) {
  const lines = [
    "# West Africa Commercial Sources Validation",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Summary",
  ];
  for (const [key, values] of Object.entries(report.groups)) {
    lines.push(`- ${key}: ${values.map((item) => item.id).join(", ") || "none"}`);
  }
  lines.push("", `Estimated short-term potential: ${report.estimated_short_term_potential}`, "");
  lines.push("## Sources");
  for (const item of report.results) {
    lines.push("", `### ${item.id}`, "");
    lines.push(`- Recommendation: ${item.recommendation}`);
    lines.push(`- Reason: ${item.reason}`);
    lines.push(`- Main URL: ${item.main_url}`);
    lines.push(`- HTTP: ${item.http_status ?? "ERR"}`);
    lines.push(`- Content-Type: ${item.content_type ?? "n/a"}`);
    lines.push(`- Samples: ${item.sample_count}`);
    lines.push(`- Potential: ${item.short_term_potential}`);
    lines.push("- Sample jobs:");
    if (!item.samples.length) lines.push("  - none");
    for (const sample of item.samples.slice(0, 5)) {
      lines.push(`  - ${sample.title} | ${sample.detected_country} | ${sample.source_url}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

await mkdir("tmp", { recursive: true });
const results = [];
for (const source of SOURCES) {
  console.log(`Validating ${source.id}...`);
  results.push(await validateSource(source));
}
const groups = Object.fromEntries(["GO_RSS", "GO_SITEMAP", "GO_HTML_DRY_RUN", "NEEDS_SPECIFIC_PARSER", "PAUSE_TECH_RISK", "STOP"].map((key) => [
  key,
  results.filter((item) => item.recommendation === key),
]));
const report = {
  generated_at: new Date().toISOString(),
  user_agent: USER_AGENT,
  results,
  groups,
  estimated_short_term_potential: results.reduce((sum, item) => sum + item.short_term_potential, 0),
};
await writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(OUT_MD, markdown(report), "utf8");
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_MD}`);
