// supabase/functions/public_sitemap/index.ts
//
// JR-SEO-audit-20260812 : sitemap dynamique sur les offres qualifiees --
// opportunite #1 de l'audit (359 536 pages d'offres qualifiees a l'audit,
// 0 dans l'ancien sitemap.xml statique de 17 URL).
//
// Sert 3 sous-ressources selon ?kind= (routage HTTP fait par redirection
// Netlify, voir netlify.toml) :
// - index  : sitemap index (liste "pages" + un ou plusieurs chunks
//            "offres", determines dynamiquement en parcourant la RPC par
//            curseur -- pas de nombre de chunks code en dur).
// - pages  : les URL institutionnelles + pays/ville, contenu equivalent a
//            l'ancien public/sitemap.xml statique -- gardees ici comme
//            source unique plutot que deux endroits a maintenir en
//            parallele.
// - offres : un chunk de jusqu'a 50000 URL d'offres (limite du protocole
//            sitemap), pagine par curseur (?after=<uuid>) via la RPC
//            jobradar_public_sitemap_page (migration
//            20260813020000_jr_seo_sitemap_public_rpc.sql). Meme critere
//            de qualification que le JSON-LD JobPosting cote frontend
//            (src/lib/jobPostingSchema.ts) -- une page presente ici porte
//            toujours un balisage JobPosting valide.
//
// IMPORTANT (constate a la mise au point, 13/08/2026) : l'API REST
// Supabase plafonne chaque appel RPC a 1000 lignes, quelle que soit la
// valeur de p_limit demandee -- verifie empiriquement (appel avec
// p_limit=50000, reponse limitee a exactement 1000 lignes). Chaque chunk
// de 50000 URL est donc assemble en interne par sous-appels successifs de
// 1000 lignes (fetchQualifyingRows ci-dessous), et non par un unique
// appel RPC.
//
// IMPORTANT #2 (constate en production, 13/08/2026) : la premiere version
// de kind=index construisait les bornes de chunks en parcourant TOUT le
// catalogue via fetchQualifyingRows (donc ~400 appels de 1000 lignes pour
// ~353k lignes qualifiantes) -- plus d'une minute, un proxy en amont
// (Cloudflare et/ou Netlify) coupait la connexion avant la fin (504).
// Remplace par un unique appel a la RPC jobradar_public_sitemap_chunk_bounds
// (migration 20260813030000_jr_seo_sitemap_chunk_bounds_rpc.sql), qui
// calcule toutes les bornes en une seule requete SQL cote base (~400ms
// mesure pour l'ensemble du catalogue, teste en EXPLAIN ANALYZE avant
// application) -- pas soumis au plafond de 1000 lignes puisque la reponse
// elle-meme ne contient que les quelques lignes de bornes utiles.
//
// verify_jwt = false (config.toml) : endpoint public, doit rester
// accessible sans en-tete d'authentification pour les crawlers -- meme
// choix que thanks_page/unsubscribe/email_action dans ce depot.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SITE_URL = "https://jobradar.go4jobapp.com";
const CHUNK_SIZE = 50000;
// Plafond reel constate cote API REST Supabase pour un appel RPC -- voir
// note ci-dessus. Garder une marge (900 au lieu de 1000) est inutile ici
// car la valeur est fixe et verifiee, mais 1000 pile est correct.
const API_PAGE_SIZE = 1000;

const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  // Cache d'une heure : un crawler qui repasse plus vite que ca reçoit une
  // reponse mise en cache par le CDN en amont plutot que de re-declencher
  // la requete Supabase a chaque fois -- important ici car construire un
  // chunk ou l'index demande plusieurs dizaines d'appels RPC en interne
  // (limite de 1000 lignes/appel, voir plus haut).
  "Cache-Control": "public, max-age=3600",
} as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const STATIC_PAGES: Array<{ loc: string; lastmod: string; priority: string }> = [
  { loc: "/landing", lastmod: "2026-08-09", priority: "1.0" },
  { loc: "/offres", lastmod: "2026-08-09", priority: "0.9" },
  { loc: "/pricing", lastmod: "2026-08-09", priority: "0.8" },
  { loc: "/qui-sommes-nous", lastmod: "2026-08-13", priority: "0.5" },
  { loc: "/devenir-partenaire", lastmod: "2026-08-09", priority: "0.5" },
  { loc: "/contact", lastmod: "2026-08-09", priority: "0.4" },
  { loc: "/privacy", lastmod: "2026-08-09", priority: "0.2" },
  { loc: "/terms", lastmod: "2026-08-09", priority: "0.2" },
  { loc: "/legal", lastmod: "2026-08-09", priority: "0.2" },
  { loc: "/refund-policy", lastmod: "2026-08-09", priority: "0.2" },
  { loc: "/offres/cote-divoire", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/abidjan", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/bouake", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/yamoussoukro", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/france", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/paris", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/lyon", lastmod: "2026-08-11", priority: "0.6" },
  { loc: "/offres/toulouse", lastmod: "2026-08-11", priority: "0.6" },
];

function pagesXml(): string {
  const urls = STATIC_PAGES.map(
    (p) =>
      `  <url>\n    <loc>${escapeXml(SITE_URL + p.loc)}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

type SitemapRow = { id: string; updated_at: string | null };

function offersXml(rows: SitemapRow[]): string {
  const urls = rows
    .map((r) => {
      const lastmod = r.updated_at ? r.updated_at.slice(0, 10) : null;
      const loc = escapeXml(`${SITE_URL}/offres/${r.id}`);
      return lastmod
        ? `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
        : `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function indexXml(chunkCursors: Array<string | null>): string {
  const now = new Date().toISOString();
  const entries = [
    `  <sitemap>\n    <loc>${escapeXml(`${SITE_URL}/sitemap-pages.xml`)}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    ...chunkCursors.map((after) => {
      const href = after
        ? `${SITE_URL}/sitemap-offres.xml?after=${encodeURIComponent(after)}`
        : `${SITE_URL}/sitemap-offres.xml`;
      return `  <sitemap>\n    <loc>${escapeXml(href)}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
}

/**
 * Assemble jusqu'a `target` lignes qualifiantes a partir de `startAfter`,
 * en enchainant des appels RPC de API_PAGE_SIZE lignes (plafond reel de
 * l'API REST, voir note en tete de fichier). Retourne aussi le dernier id
 * vu (curseur pour la page suivante) et si la source est epuisee (moins
 * de API_PAGE_SIZE lignes recues sur le dernier appel).
 */
async function fetchQualifyingRows(
  supabase: SupabaseClient,
  startAfter: string | null,
  target: number,
): Promise<{ rows: SitemapRow[]; lastId: string | null; exhausted: boolean }> {
  const rows: SitemapRow[] = [];
  let after = startAfter;
  let exhausted = false;

  while (rows.length < target) {
    const { data, error } = await supabase.rpc("jobradar_public_sitemap_page", {
      p_after: after,
      p_limit: Math.min(API_PAGE_SIZE, target - rows.length),
    });
    if (error) throw error;
    const page = (data ?? []) as SitemapRow[];
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    rows.push(...page);
    after = page[page.length - 1].id;
    if (page.length < API_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  return { rows, lastId: rows.length > 0 ? rows[rows.length - 1].id : startAfter, exhausted };
}

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "index";

  if (kind === "pages") {
    return new Response(pagesXml(), { headers: XML_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    console.error("public_sitemap: SUPABASE_URL/SUPABASE_ANON_KEY manquantes");
    return new Response("Configuration manquante", { status: 500 });
  }
  // Client anon, pas service_role : cette fonction ne doit jamais avoir
  // plus d'acces que n'importe quel visiteur anonyme du site (meme RPC
  // SECURITY DEFINER que les pages publiques /offres/*).
  const supabase = createClient(supabaseUrl, anonKey);

  try {
    if (kind === "offres") {
      const after = url.searchParams.get("after") || null;
      const { rows } = await fetchQualifyingRows(supabase, after, CHUNK_SIZE);
      return new Response(offersXml(rows), { headers: { ...XML_HEADERS, "X-Row-Count": String(rows.length) } });
    }

    // kind === "index" (defaut) : un seul appel RPC calcule toutes les
    // bornes de chunks cote base (voir IMPORTANT #2 en tete de fichier).
    const { data, error } = await supabase.rpc("jobradar_public_sitemap_chunk_bounds", {
      p_chunk_size: CHUNK_SIZE,
    });
    if (error) throw error;
    const bounds = ((data ?? []) as Array<{ after_id: string }>).map((r) => r.after_id);
    const cursors: Array<string | null> = [null, ...bounds];

    return new Response(indexXml(cursors), { headers: XML_HEADERS });
  } catch (err) {
    console.error("public_sitemap:", err);
    return new Response("Erreur de generation du sitemap", { status: 502 });
  }
});
