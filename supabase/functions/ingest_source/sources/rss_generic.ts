export type RssItem = {
  title: string;
  link: string;
  guid: string | null;
  published_at: string | null;
  summary: string;
  content: string;
};

function textOf(el: Element | null) {
  if (!el) return "";
  return (el.textContent ?? "").trim();
}

function firstText(parent: Element, selectors: string[]) {
  for (const sel of selectors) {
    const el = parent.querySelector(sel);
    const t = textOf(el);
    if (t) return t;
  }
  return "";
}

function attrOf(el: Element | null, name: string) {
  if (!el) return "";
  return (el.getAttribute(name) ?? "").trim();
}

function parseDate(raw: string) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getContentEncoded(parent: Element) {
  const els = parent.getElementsByTagName("content:encoded");
  if (els && els.length) return textOf(els[0]);
  return "";
}

function parseRssItem(item: Element): RssItem {
  const title = firstText(item, ["title"]) || "Untitled";
  const link = firstText(item, ["link"]) || "";
  const guid = firstText(item, ["guid"]) || null;
  const published = firstText(item, ["pubDate", "date", "dc:date"]);
  const description = firstText(item, ["description", "summary"]);
  const content = getContentEncoded(item);

  return {
    title,
    link,
    guid,
    published_at: parseDate(published),
    summary: description,
    content,
  };
}

function parseAtomEntry(entry: Element): RssItem {
  const title = firstText(entry, ["title"]) || "Untitled";

  let link = "";
  const linkEl =
    entry.querySelector("link[rel='alternate']") ||
    entry.querySelector("link");
  if (linkEl) link = attrOf(linkEl, "href") || textOf(linkEl);

  const guid = firstText(entry, ["id"]) || null;
  const published = firstText(entry, ["published", "updated"]);
  const summary = firstText(entry, ["summary"]);
  const content = firstText(entry, ["content"]);

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
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");

  const isAtom = !!doc.querySelector("feed");
  const items: RssItem[] = [];

  if (isAtom) {
    const entries = Array.from(doc.querySelectorAll("entry"));
    for (const entry of entries) {
      items.push(parseAtomEntry(entry));
      if (items.length >= capped) break;
    }
  } else {
    const rssItems = Array.from(doc.querySelectorAll("item"));
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
