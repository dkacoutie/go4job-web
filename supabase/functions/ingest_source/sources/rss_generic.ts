// supabase/functions/ingest_source/sources/rss_generic.ts

export type RssGenericItem = {
  external_id: string;        // hashed id, stable
  external_raw: string;       // guid/link/id (raw)
  title: string | null;
  url: string | null;
  published_at: string | null; // ISO string if possible
  description_html: string | null;
  description_text: string | null;
  tags: string[];
};

export type FetchRssGenericResult = {
  feed_url: string;
  parsed: number;
  sample: RssGenericItem[];
  items: RssGenericItem[];
};

const MAX_REDIRECTS = 6;
const MAX_RETRIES = 2;

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim();
}

function decodeBasicEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripHtml(html: string): string {
  // Very small HTML-to-text cleanup (good enough for MVP)
  return decodeBasicEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|br|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function firstTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return stripCdata(m[1] ?? "").trim();
}

function allTags(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  for (const m of block.matchAll(re)) {
    const v = stripCdata(String(m[1] ?? "")).trim();
    if (v) out.push(v);
  }
  return out;
}

function firstAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]+)"[^>]*\\/?>`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseDateToIso(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;

  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractRssItems(xml: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];

  // RSS 2.0 style: <item>...</item>
  const rssRe = /<item\b[\s\S]*?<\/item>/gi;
  for (const m of xml.matchAll(rssRe)) {
    const block = m[0];
    const title = firstTag(block, "title");
    const link = firstTag(block, "link");
    const guid = firstTag(block, "guid");
    const pubDate = firstTag(block, "pubDate");
    const description = firstTag(block, "description");
    const contentEncoded =
      firstTag(block, "content:encoded") ||
      firstTag(block, "content"); // fallback

    const categories = allTags(block, "category");

    const rawKey = (guid || link || title || "").trim();
    if (!rawKey) continue;

    items.push({
      kind: "rss",
      raw_key: rawKey,
      title: title ? decodeBasicEntities(title) : null,
      url: link ? link.trim() : null,
      published_at: parseDateToIso(pubDate),
      description_html: (contentEncoded || description)
        ? stripCdata(String(contentEncoded || description))
        : null,
      tags: categories.map((c) => decodeBasicEntities(c)).filter(Boolean),
    });
  }

  // Atom style: <entry>...</entry>
  const atomRe = /<entry\b[\s\S]*?<\/entry>/gi;
  for (const m of xml.matchAll(atomRe)) {
    const block = m[0];
    const title = firstTag(block, "title");
    const id = firstTag(block, "id");
    const updated = firstTag(block, "updated") || firstTag(block, "published");
    const linkHref = firstAttr(block, "link", "href") || firstTag(block, "link"); // fallback
    const summary = firstTag(block, "summary");
    const content = firstTag(block, "content");

    const rawKey = (id || linkHref || title || "").trim();
    if (!rawKey) continue;

    items.push({
      kind: "atom",
      raw_key: rawKey,
      title: title ? decodeBasicEntities(title) : null,
      url: linkHref ? linkHref.trim() : null,
      published_at: parseDateToIso(updated),
      description_html: (content || summary) ? stripCdata(String(content || summary)) : null,
      tags: [],
    });
  }

  return items;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await sleep(200 * (attempt + 1));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchWithRedirects(
  startUrl: string,
): Promise<{ res: Response; finalUrl: string }> {
  let url = startUrl;
  let redirects = 0;

  while (true) {
    const res = await safeFetch(url, {
      method: "GET",
      redirect: "manual", // we handle redirects ourselves
      headers: {
        "user-agent": "JobRadarBot/1.0 (+https://go4job.org)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "accept-encoding": "identity",
        connection: "close",
      },
    });

    const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
    if (isRedirect) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: url };

      redirects++;
      if (redirects > MAX_REDIRECTS) return { res, finalUrl: url };

      url = new URL(loc, url).toString();
      continue;
    }

    return { res, finalUrl: url };
  }
}

export async function fetchRssGenericItems(
  feedUrl: string,
  limit: number,
): Promise<FetchRssGenericResult> {
  const { res, finalUrl } = await fetchWithRedirects(feedUrl);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`rss_fetch_failed: ${res.status}\nfinal_url=${finalUrl}\n${text.slice(0, 800)}`);
  }

  const raw = extractRssItems(text);

  const items: RssGenericItem[] = [];
  for (const r of raw.slice(0, Math.max(1, limit))) {
    const rawKey = String(r.raw_key ?? "").trim();
    const hashed = await sha256Hex(rawKey);

    const descriptionHtml = (r.description_html ? String(r.description_html) : null);
    const descriptionText = descriptionHtml ? stripHtml(descriptionHtml) : null;

    items.push({
      external_id: `rss:${hashed}`,
      external_raw: rawKey,
      title: (r.title ? String(r.title) : null),
      url: (r.url ? String(r.url) : null),
      published_at: (r.published_at ? String(r.published_at) : null),
      description_html: descriptionHtml,
      description_text: descriptionText,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    });
  }

  return {
    feed_url: feedUrl,
    parsed: raw.length,
    sample: items.slice(0, Math.min(3, items.length)),
    items: items.slice(0, Math.max(1, limit)),
  };
}
