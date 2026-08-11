import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchPublicJobsCount, fetchPublicJobsPreview, type PublicJobPreview } from "./lib/publicJobsPreview";
import { PUBLIC_LOCATIONS } from "./lib/publicLocationsConfig";
import { formatRelativeDate, formatSalary } from "./lib/publicJobFormat";
import { trackSelectContent } from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { usePageMeta } from "./lib/usePageMeta";
import "./PublicOffersPreviewPage.css";

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
    navigate("/auth", { state: { from: target } });
  }

  // Carte cliquée par un visiteur déjà connecté : on l'envoie directement
  // sur la fiche complète plutôt que sur la fiche publique teaser (JR-0131),
  // qui ne lui apporterait rien de plus qu'il n'ait déjà accès. Pour un
  // visiteur anonyme, la carte est un vrai lien <Link> vers /offres/:id
  // (crawlable par Google, condition nécessaire pour que ces pages soient
  // découvertes et indexées individuellement) — pas de navigation forcée
  // vers /auth au clic comme avant JR-0131.
  function handleCardClick(jobId: string, e: MouseEvent) {
    if (session) {
      e.preventDefault();
      trackSelectContent({ itemId: jobId });
      navigate(`/jobradar/jobs/${jobId}`);
    }
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

      {/* JR-0111 : maillage interne vers les 8 pages pays/ville (JR-0135) —
          /offres est déjà lié depuis le header sur toutes les pages publiques,
          ce bloc fait redescendre cette autorité de lien vers les pages
          plus spécifiques, qui n'avaient jusqu'ici aucun lien entrant. */}
      <nav className="offersPreview__locationLinks" aria-label="Parcourir par ville ou pays">
        {PUBLIC_LOCATIONS.map((loc) => (
          <Link key={loc.slug} to={`/offres/${loc.slug}`} className="offersPreview__locationLink">
            {loc.breadcrumbLabel}
          </Link>
        ))}
      </nav>

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
              <Link
                key={job.id}
                to={`/offres/${job.id}`}
                className="offersPreview__card"
                onClick={(e) => handleCardClick(job.id, e)}
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
              </Link>
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
