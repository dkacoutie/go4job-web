import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPublicJobsCount, fetchPublicJobsPreview, type PublicJobPreview } from "./lib/publicJobsPreview";
import { trackSelectContent } from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { usePageMeta } from "./lib/usePageMeta";
import "./PublicOffersPreviewPage.css";

function formatSalary(job: PublicJobPreview): string | null {
  if (!job.salary_min && !job.salary_max) return null;
  const currency = job.salary_currency ?? "";
  const period = job.salary_period ? ` / ${job.salary_period}` : "";
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `${job.salary_min.toLocaleString("fr-FR")} – ${job.salary_max.toLocaleString("fr-FR")} ${currency}${period}`.trim();
  }
  const value = job.salary_min ?? job.salary_max;
  return `${value?.toLocaleString("fr-FR")} ${currency}${period}`.trim();
}

function formatRelativeDate(iso: string | null): string | null {
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

export default function PublicOffersPreviewPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [jobs, setJobs] = useState<PublicJobPreview[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  usePageMeta({
    title: "Offres d'emploi en Afrique, en Europe et a distance",
    description:
      "Un apercu des offres d'emploi suivies par JobRadar. Creez un compte gratuit pour voir la description complete, filtrer selon votre profil et candidater.",
    path: "/offres",
  });

  useEffect(() => {
    let cancelled = false;

    fetchPublicJobsPreview()
      .then((data) => {
        if (!cancelled) setJobs(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchPublicJobsCount().then((count) => {
      if (!cancelled) setTotalCount(count);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function goSignUp(jobId?: string) {
    if (jobId) trackSelectContent({ itemId: jobId });
    const target = jobId ? `/jobradar/jobs/${jobId}` : "/jobradar/feed";
    // Déjà connecté (ex. lien /offres visité par un utilisateur existant) :
    // on l'envoie directement sur l'offre cliquée plutôt que de le faire
    // repasser par /auth, qui l'aurait de toute façon renvoyé au même
    // endroit après un aller-retour inutile.
    if (session) {
      navigate(target);
      return;
    }
    navigate("/auth", { state: { from: target } });
  }

  const roundedCount = totalCount !== null ? Math.floor(totalCount / 1000) * 1000 : null;

  return (
    <div className="offersPreview">
      <div className="offersPreview__intro">
        <h1>Un aperçu des offres suivies par JobRadar</h1>
        <p>
          {roundedCount !== null
            ? `Un échantillon des offres les plus récentes, parmi plus de ${roundedCount.toLocaleString("fr-FR")} offres actives suivies par JobRadar.`
            : "Un échantillon des offres les plus récentes suivies par JobRadar."}{" "}
          Crée un compte gratuit pour voir la description complète, filtrer selon ton profil et candidater.
        </p>
      </div>

      {error && (
        <p className="offersPreview__error">
          L'aperçu n'est pas disponible pour le moment. Tu peux tout de même{" "}
          <button type="button" className="offersPreview__inlineLink" onClick={() => goSignUp()}>
            créer un compte gratuit
          </button>{" "}
          pour accéder à toutes les offres.
        </p>
      )}

      {!error && jobs === null && (
        <div className="offersPreview__grid" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="offersPreview__card offersPreview__card--skeleton" />
          ))}
        </div>
      )}

      {!error && jobs !== null && jobs.length > 0 && (
        <div className="offersPreview__grid">
          {jobs.map((job) => {
            const salary = formatSalary(job);
            const relativeDate = formatRelativeDate(job.posted_at);
            return (
              <button
                key={job.id}
                type="button"
                className="offersPreview__card"
                onClick={() => goSignUp(job.id)}
              >
                <div className="offersPreview__cardTop">
                  <h2>{job.title ?? "Offre d'emploi"}</h2>
                  {relativeDate && <span className="offersPreview__badge">{relativeDate}</span>}
                </div>
                <p className="offersPreview__company">{job.company_name ?? "Entreprise non précisée"}</p>
                <p className="offersPreview__meta">
                  {[job.location, job.contract_type, job.remote_type].filter(Boolean).join(" · ") || "Lieu non précisé"}
                </p>
                {salary && <p className="offersPreview__salary">{salary}</p>}
                <span className="offersPreview__cta">Voir l'offre complète →</span>
              </button>
            );
          })}
        </div>
      )}

      {!error && jobs !== null && jobs.length === 0 && (
        <p className="offersPreview__empty">Aucune offre à afficher pour le moment.</p>
      )}

      <div className="offersPreview__footerCta">
        <button type="button" className="btn btnPrimary" onClick={() => goSignUp()}>
          Créer un compte gratuit
        </button>
      </div>
    </div>
  );
}
