// supabase/functions/ingest_source/sources/emploi_ci.ts

export type EmploiCiItem = {
  external_id: string;
  title: string;
  url: string;
  country: "CI";
  location: string | null;
};

function absUrl(href: string) {
  if (href.startsWith("http")) return href;
  return `https://emploi.educarriere.ci${href.startsWith("/") ? "" : "/"}${href}`;
}

function safeDecodeURIComponent(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function titleFromSlug(slug: string) {
  const cleaned = slug
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  const decoded = safeDecodeURIComponent(cleaned);

  return decoded
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export async function fetchEmploiCiItems(limit = 30) {
  const capped = Math.max(1, Math.min(limit, 100));
  const listUrl = "https://emploi.educarriere.ci/nos-offres";

  const res = await fetch(listUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      "accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`emploi_ci list fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  // Extrait les chemins /offre-12345-xxxxx.html depuis le HTML (même si c'est dans du JS/JSON)
  const urlRe = /\/offre-(\d+)-([a-z0-9%_-]+)\.html/gi;

  const items: EmploiCiItem[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(html)) !== null) {
    const offerId = m[1];
    const slug = m[2] ?? "";

    const external_id = `educarriere:${offerId}`;
    if (seen.has(external_id)) continue;
    seen.add(external_id);

    const href = `/offre-${offerId}-${slug}.html`;
    const title = titleFromSlug(slug);

    items.push({
      external_id,
      title,
      url: absUrl(href),
      country: "CI",
      location: "Cote d'Ivoire",
    });

    if (items.length >= capped) break;
  }

  return { list_url: listUrl, parsed: items.length, sample: items.slice(0, 3), items };
}
