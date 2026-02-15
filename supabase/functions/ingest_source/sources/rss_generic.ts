import { XMLParser } from "npm:fast-xml-parser@4.4.1";

export type RssItem = {
  title: string;
  link: string;
  guid: string | null;
  published_at: string | null;
  summary: string;
  content: string;
};

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const anyV = v as Record<string, unknown>;
    const t = anyV.text ?? anyV["#text"] ?? anyV["_"] ?? "";
    if (typeof t === "string") return t.trim();
  }
  return "";
}

function arrify<T>(v: T | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDate(raw: string) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function pickAtomLink(link: unknown): string {
  const links = arrify(link as any);
  if (!links.length) return "";
  for (const l of links) {
    if (typeof l === "string") return l.trim();
    const rel = asText((l as any).rel);
    const href = asText((l as any).href);
    if (href && (!rel || rel === "alternate")) return href;
  }
  const first = links[0] as any;
  return asText(first?.href) || asText(first);
}

function parseRssItem(item: any): RssItem {
  const title = asText(item?.title) || "Untitled";
  const link = asText(item?.link);
  const guid = asText(item?.guid) || null;
  const published = asText(item?.pubDate) || asText(item?.date);
  const description = asText(item?.description) || asText(item?.summary);
  const content = asText(item?.encoded) || asText(item?.content);

  return {
    title,
    link,
    guid,
    published_at: parseDate(published),
    summary: description,
    content,
  };
}

function parseAtomEntry(entry: any): RssItem {
  const title = asText(entry?.title) || "Untitled";
  const link = pickAtomLink(entry?.link);
  const guid = asText(entry?.id) || null;
  const published = asText(entry?.published) || asText(entry?.updated);
  const summary = asText(entry?.summary);
  const content = asText(entry?.content) || summary;

  return {
    title,
    link,
    guid,
    published_at: parseDate(published),
    summary,
    content,
  };
}

export async function fetchRssFeedItems(feedUrl: string, limit = 50) {
  const capped = Math.max(1, Math.min(limit, 200));

  const res = await fetch(feedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });

  if (!res.ok) {
    throw new Error(`rss_fetch_failed: ${res.status}`);
  }

  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    textNodeName: "text",
    trimValues: true,
  });
  const data = parser.parse(xml) as any;

  const items: RssItem[] = [];
  if (data?.feed?.entry) {
    const entries = arrify(data.feed.entry);
    for (const entry of entries) {
      items.push(parseAtomEntry(entry));
      if (items.length >= capped) break;
    }
  } else {
    const rssItems = arrify(data?.rss?.channel?.item || data?.channel?.item);
    for (const it of rssItems) {
      items.push(parseRssItem(it));
      if (items.length >= capped) break;
    }
  }

  return {
    feed_url: feedUrl,
    parsed: items.length,
    items,
  };
}
