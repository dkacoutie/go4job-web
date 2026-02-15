export type AejItem = {
  external_id: string;
  title: string;
  reference: string | null;
  location: string | null;
  contract_type: string | null;
  expires_at: string | null;
  description_text: string | null;
  description_html: string | null;
  source_url: string;
  is_expired: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`aej_fetch_failed: ${res.status}`);
  }
  return await res.text();
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h\d>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractDetailUrls(html: string, baseUrl: string): string[] {
  const re = /href=["']([^"']*\/site\/offres-emplois\/\d+)["']/gi;
  const urls = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1];
    try {
      const abs = new URL(raw, baseUrl).toString();
      urls.add(abs);
    } catch {
      continue;
    }
  }
  return Array.from(urls);
}

function parseDateFr(raw: string): string | null {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const iso = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(iso.getTime())) return null;
  return iso.toISOString();
}

function normalizeText(raw: string): string {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractBetween(text: string, label: string, labels: string[]) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const l = normalizeText(label).toLowerCase();
  const start = lower.indexOf(l);
  if (start === -1) return "";
  const after = start + l.length;
  let end = text.length;
  for (const next of labels) {
    if (next === label) continue;
    const idx = lower.indexOf(normalizeText(next).toLowerCase(), after);
    if (idx !== -1 && idx < end) end = idx;
  }
  return normalized.slice(after, end).replace(/\s+/g, " ").trim();
}

function extractTitle(html: string, text: string): string {
  const h3 = html.match(/<h3[^>]*>\s*([^<]+)\s*<\/h3>/i);
  if (h3 && h3[1]) return h3[1].replace(/\s+/g, " ").trim();
  const h4 = html.match(/<h4[^>]*>\s*([^<]+)\s*<\/h4>/i);
  if (h4 && h4[1]) return h4[1].replace(/\s+/g, " ").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => l.length > 6 && l.length < 120) ?? "Offre d'emploi";
}

function extractTitleFromText(text: string): string {
  const normalized = normalizeText(text).replace(/\s+/g, " ").trim();

  let m = normalized.match(
    /intitule du poste\s*:?\s*(.+?)(?:\s+reference|\s+lieu de travail|\s+nombre de poste|\s+date de cloture|\s+type de contrat|\s+sexe|\s+secteur d'activite|\s+entreprise|$)/i,
  );
  if (m && m[1]) return m[1].trim();

  m = normalized.match(
    /sexe\s+(?:masculin|feminin|masculin\s+feminin|feminin\s+masculin)\s+(.+?)(?:\s+type de contrat|\s+secteur d'activite|\s+date de cloture|\s+entreprise|$)/i,
  );
  if (m && m[1]) {
    return m[1]
      .replace(/\b(stagiaire|stage|stage de qualification|cdd|cdi|alternance|apprentissage|volontariat)\b/gi, " ")
      .replace(/\b(en|de|du|des|la|le|les)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function extractDescription(text: string, title: string): string {
  const lower = text.toLowerCase();
  const tLower = title.toLowerCase();
  let out = text;
  const idx = lower.indexOf(tLower);
  if (idx !== -1) out = text.slice(idx + title.length);
  const stops = [
    "connectez-vous pour postuler",
    "autres offres",
    "contacts",
    "proposer une",
  ];
  let stopAt = out.length;
  const outLower = out.toLowerCase();
  for (const s of stops) {
    const i = outLower.indexOf(s);
    if (i !== -1 && i < stopAt) stopAt = i;
  }
  return out.slice(0, stopAt).replace(/\s+/g, " ").trim();
}

function parseAejDetail(html: string, url: string): AejItem {
  const text = htmlToText(html);
  const labels = [
    "Lieu de travail",
    "Reference",
    "Intitule du poste",
    "Poste",
    "Metier",
    "Nombre de poste",
    "Date de cloture",
    "Diplome",
    "Type de contrat",
    "Experience professionnelle",
    "Niveau d'etude",
    "Sexe",
    "Secteur d'activite",
    "Entreprise",
  ];

  const genericTitle = extractTitle(html, text);
  const titledByField = extractBetween(text, "Intitule du poste", labels) ||
    extractBetween(text, "Poste", labels) ||
    extractBetween(text, "Metier", labels);
  const titledByRegex = extractTitleFromText(text);

  let title = genericTitle;
  const isDetails = normalizeText(genericTitle).toLowerCase().includes("details de l'emploi");
  if (isDetails && titledByField) {
    title = titledByField;
  }
  if (isDetails && titledByRegex) {
    title = titledByRegex;
  }
  const reference = extractBetween(text, "Reference", labels) || null;
  const location = extractBetween(text, "Lieu de travail", labels) || null;
  const contractType = extractBetween(text, "Type de contrat", labels) || null;
  const closingRaw = extractBetween(text, "Date de cloture", labels);
  const expiresAt = closingRaw ? parseDateFr(closingRaw) : null;

  const desc = extractDescription(text, title);
  const isExpired = /offre d'emploi a expir/i.test(text) || /offre a expir/i.test(text) ||
    /expir/i.test(text);

  const idMatch = url.match(/offres-emplois\/(\d+)/);
  const fallbackId = idMatch ? idMatch[1] : String(Math.random()).slice(2, 10);
  const externalId = reference ? `aej:${reference}` : `aej:${fallbackId}`;

  return {
    external_id: externalId,
    title,
    reference,
    location,
    contract_type: contractType,
    expires_at: expiresAt,
    description_text: desc || null,
    description_html: null,
    source_url: url,
    is_expired: isExpired,
  };
}

export async function fetchAejItems(
  listUrl: string,
  maxPages: number,
  maxItems: number,
  delayMs: number,
) {
  const baseUrl = new URL(listUrl).origin;
  const urls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1
      ? listUrl
      : (() => {
        const u = new URL(listUrl);
        u.searchParams.set("page", String(page));
        return u.toString();
      })();

    const html = await fetchHtml(pageUrl);
    const found = extractDetailUrls(html, baseUrl);
    for (const u of found) {
      urls.add(u);
      if (urls.size >= maxItems) break;
    }
    if (found.length === 0 || urls.size >= maxItems) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  const items: AejItem[] = [];
  for (const url of urls) {
    const html = await fetchHtml(url);
    const item = parseAejDetail(html, url);
    items.push(item);
    if (items.length >= maxItems) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return {
    list_url: listUrl,
    parsed: items.length,
    items,
  };
}
