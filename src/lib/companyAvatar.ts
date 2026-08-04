// Avatar par défaut (initiales / globe) pour une offre. Déplacé depuis
// JobRadarFeedPage.tsx (logique inchangée) pour être partagé avec
// JobDetailsPage.tsx et avec le composant CompanyAvatar (logo + fallback).

// Palette curatée (pas de couleur aléatoire criarde) pour donner à chaque
// entreprise un repère visuel distinct — une offre devient "chez qui",
// pas juste une ligne dans une liste.
const COMPANY_AVATAR_PALETTE = [
  { bg: "var(--brand-100)", fg: "var(--brand-800)" },
  { bg: "var(--accent-100)", fg: "var(--accent-700)" },
  { bg: "var(--success-100)", fg: "var(--success-600)" },
  { bg: "var(--warning-100)", fg: "var(--warning-600)" },
] as const;

export function getCompanyAvatar(name?: string | null) {
  const label = (name ?? "").trim();

  // Pas de nom d'entreprise : sur ce flux, c'est presque toujours une offre
  // remote/agrégée légitime, pas une erreur. "?" se lit comme une anomalie ;
  // un globe se lit comme "à distance", plus juste et moins inquiétant.
  if (!label) {
    return { initials: "🌐", bg: "var(--bg)", fg: "var(--muted)" };
  }

  const initials =
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?";
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 997;
  }
  const palette = COMPANY_AVATAR_PALETTE[hash % COMPANY_AVATAR_PALETTE.length];
  return { initials, bg: palette.bg, fg: palette.fg };
}
