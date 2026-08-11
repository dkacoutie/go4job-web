// JR-0131 : formatage partagé entre PublicOffersPreviewPage (liste) et
// PublicJobDetailPage (fiche publique par offre) — évite de dupliquer ces
// deux fonctions, qui existaient jusqu'ici uniquement dans
// PublicOffersPreviewPage.tsx.

export type SalaryFields = {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
};

export function formatSalary(job: SalaryFields): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = job.salary_currency ?? "";
  const period = job.salary_period ? ` / ${job.salary_period}` : "";
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `${job.salary_min.toLocaleString("fr-FR")} – ${job.salary_max.toLocaleString("fr-FR")} ${currency}${period}`.trim();
  }
  const value = job.salary_min ?? job.salary_max;
  return `${value?.toLocaleString("fr-FR")} ${currency}${period}`.trim();
}

export function formatRelativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "à l'instant";
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `il y a ${diffDays} j`;
  return date.toLocaleDateString("fr-FR");
}
