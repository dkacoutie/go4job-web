import { useEffect } from "react";

// JR-0072 : meta par page (title, description, canonical, Open Graph, Twitter Card).
// L'app est une SPA sans SSR (voir netlify.toml, catch-all vers index.html) : ce hook
// met à jour le <head> côté client après montage. Insuffisant pour les crawlers qui
// n'exécutent pas de JS (certains bots de prévisualisation), mais corrige le cas
// Googlebot (qui rend le JS) et les partages depuis un onglet déjà ouvert. Voir JR-0071
// pour l'audit complet et ses limites (pas de SSR = pas de solution parfaite sans y).

const SITE_URL = "https://jobradar.go4jobapp.com";
const DEFAULT_TITLE = "JobRadar";
const DEFAULT_DESCRIPTION =
  "JobRadar - Trouve et suis les meilleures opportunites d emploi avec Go4Job et CapCarriere.";

function setMetaTag(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export type PageMetaOptions = {
  /** Titre de la page, sans le suffixe " | JobRadar" (ajoute automatiquement). */
  title: string;
  description: string;
  /** Chemin absolu depuis la racine, ex. "/offres", utilise pour l'URL canonique. */
  path: string;
  image?: string;
};

export function usePageMeta({ title, description, path, image }: PageMetaOptions) {
  useEffect(() => {
    const fullTitle = `${title} | JobRadar`;
    const url = `${SITE_URL}${path}`;

    document.title = fullTitle;
    setMetaTag("name", "description", description);
    setCanonical(url);
    setMetaTag("property", "og:title", fullTitle);
    setMetaTag("property", "og:description", description);
    setMetaTag("property", "og:url", url);
    setMetaTag("property", "og:type", "website");
    setMetaTag("property", "og:site_name", "JobRadar");
    if (image) setMetaTag("property", "og:image", image);
    setMetaTag("name", "twitter:card", "summary_large_image");
    setMetaTag("name", "twitter:title", fullTitle);
    setMetaTag("name", "twitter:description", description);

    return () => {
      // On quitte la page : on remet les valeurs par defaut plutot que de laisser
      // trainer un titre/description qui ne correspond plus a la page affichee
      // (utile pendant la transition avant que la page suivante pose les siennes).
      document.title = DEFAULT_TITLE;
      setMetaTag("name", "description", DEFAULT_DESCRIPTION);
    };
  }, [title, description, path, image]);
}
