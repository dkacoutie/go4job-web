import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  clampPublicJobsPage,
  fetchPublicJobsByLocation,
  fetchPublicJobsByLocationCount,
  PUBLIC_JOBS_COUNT_CAP,
  PUBLIC_JOBS_PAGE_SIZE,
  type PublicJobPreview,
} from "./lib/publicJobsPreview";
import { formatRelativeDate, formatSalary } from "./lib/publicJobFormat";
import { trackSelectContent } from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { usePageMeta } from "./lib/usePageMeta";
import { getPublicLocationConfig, PUBLIC_LOCATIONS } from "./lib/publicLocationsConfig";
import PublicPagination from "./PublicPagination";
import "./PublicOffersPreviewPage.css";

// JR-0135 : page publique pays/ville (ex. /offres/cote-divoire, /offres/abidjan).
// Réutilise le même composant pour les 8 pages du premier lot (JR-0133/0134) :
// seule la config (pays/motif de localisation/textes) change par page, pas le
// gabarit React lui-même. Même contrat de sécurité que PublicOffersPreviewPage
// (JR-0072) : aperçu plafonné, pas de description, pas de lien de candidature.

export default function PublicLocationPage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { session } = useSession();
  const config = getPublicLocationConfig(slug);
  const [searchParams] = useSearchParams();
  const page = clampPublicJobsPage(Number(searchParams.get("page")) || 1);
  const [jobs, setJobs] = useState<PublicJobPreview[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  usePageMeta({
    title:
      page === 1 ? config?.metaTitle ?? "Offres d'emploi" : `${config?.metaTitle ?? "Offres d'emploi"} - Page ${page}`,
    description: config?.introFallback ?? "Offres d'emploi suivies par JobRadar.",
    path: page === 1 ? `/offres/${slug}` : `/offres/${slug}?page=${page}`,
  });

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    setJobs(null);
    setError(false);

    fetchPublicJobsByLocation(config.countries, config.locationPattern, page)
      .then((data) => {
        if (!cancelled) setJobs(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchPublicJobsByLocationCount(config.countries, config.locationPattern).then((count) => {
      if (!cancelled) setTotalCount(count);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, page]);

  function goSignUp(jobId?: string) {
    if (jobId) trackSelectContent({ itemId: jobId });
    const target = jobId ? `/jobradar/jobs/${jobId}` : "/jobradar/feed";
    navigate("/auth", { state: { from: target } });
  }

  function handleCardClick(jobId: string, e: MouseEvent) {
    if (session) {
      e.preventDefault();
      trackSelectContent({ itemId: jobId });
      navigate(`/jobradar/jobs/${jobId}`);
    }
  }

  if (!config) {
    return (
      <div className="offersPreview">
        <p className="offersPreview__empty">Page introuvable.</p>
        <Link to="/offres" className="offersPreview__backLink">
          ← Voir toutes les offres
        </Link>
      </div>
    );
  }

  return (
    <div className="offersPreview">
      <Link to="/offres" className="offersPreview__backLink">
        ← Toutes les offres
      </Link>

      <div className="offersPreview__intro">
        <h1>{config.h1}</h1>
        <p>
          {totalCount !== null
            ? `${totalCount.toLocaleString("fr-FR")}${totalCount >= PUBLIC_JOBS_COUNT_CAP ? "+" : ""} offre${totalCount > 1 ? "s" : ""} suivie${totalCount > 1 ? "s" : ""} par JobRadar${
                config.locationPattern ? ` à ${config.breadcrumbLabel}` : ` en ${config.breadcrumbLabel}`
              } actuellement.`
            : config.introFallback}{" "}
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
        <p className="offersPreview__empty">
          Aucune offre disponible pour {config.breadcrumbLabel} pour le moment.{" "}
          <Link to="/offres">Voir toutes les offres</Link>.
        </p>
      )}

      {!error && jobs !== null && (
        <PublicPagination
          basePath={`/offres/${slug}`}
          currentPage={page}
          hasNextPage={jobs.length === PUBLIC_JOBS_PAGE_SIZE}
        />
      )}

      {/* JR-0111 : liens croisés vers les autres pages pays/ville, pour que
          chacune des 8 pages profite du maillage des autres, pas seulement
          du lien retour vers /offres. */}
      <nav className="offersPreview__locationLinks" aria-label="Autres villes et pays">
        {PUBLIC_LOCATIONS.filter((loc) => loc.slug !== slug).map((loc) => (
          <Link key={loc.slug} to={`/offres/${loc.slug}`} className="offersPreview__locationLink">
            {loc.breadcrumbLabel}
          </Link>
        ))}
      </nav>

      <div className="offersPreview__footerCta">
        <button type="button" className="btn btnPrimary" onClick={() => goSignUp()}>
          Créer un compte gratuit
        </button>
      </div>
    </div>
  );
}
