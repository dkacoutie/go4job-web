import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchPublicJobDetail, type PublicJobDetail } from "./lib/publicJobsPreview";
import { formatRelativeDate, formatSalary } from "./lib/publicJobFormat";
import { usePageMeta } from "./lib/usePageMeta";
import { useJobPostingSchema } from "./lib/jobPostingSchema";
import { useSession } from "./lib/useSession";
import { trackSelectContent } from "./lib/analytics";
import "./PublicJobDetailPage.css";

// JR-0131 : fiche publique d'une offre (teaser SEO / Google for Jobs).
// Titre, entreprise, lieu, contrat, salaire si connu, et un extrait court
// de la description (280 caractères, tronqué côté serveur — voir
// supabase/migrations/.../jobradar_public_job_detail_rpc.sql). Le texte
// intégral et la candidature restent réservés au compte connecté
// (JobDetailsPage.tsx, sur /jobradar/jobs/:id, inchangé).

const DEFAULT_TITLE = "Offre d'emploi";
const DEFAULT_DESCRIPTION =
  "Découvre cette offre sur JobRadar. Crée un compte gratuit pour voir la description complète et candidater.";

export default function PublicJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const [job, setJob] = useState<PublicJobDetail | null | undefined>(undefined);

  // Un visiteur déjà connecté qui atterrit ici (lien partagé, résultat de
  // recherche) n'a aucune raison de voir la version teaser — on l'envoie
  // directement à la fiche complète, comme le fait déjà goSignUp() dans
  // PublicOffersPreviewPage pour le même cas.
  useEffect(() => {
    if (session && id) navigate(`/jobradar/jobs/${id}`, { replace: true });
  }, [session, id, navigate]);

  useEffect(() => {
    if (!id || session) return;
    let cancelled = false;
    setJob(undefined);
    fetchPublicJobDetail(id)
      .then((data) => {
        if (!cancelled) setJob(data);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id, session]);

  usePageMeta({
    title: job ? `${job.title ?? DEFAULT_TITLE} - ${job.company_name ?? "JobRadar"}` : DEFAULT_TITLE,
    description: job?.description_excerpt ?? DEFAULT_DESCRIPTION,
    path: `/offres/${id ?? ""}`,
  });

  useJobPostingSchema(job ?? null);

  function goSignUp() {
    if (id) trackSelectContent({ itemId: id });
    navigate("/auth", { state: { from: `/jobradar/jobs/${id}` } });
  }

  if (session) return null;

  if (job === undefined) {
    return (
      <div className="jobDetail jobDetail--loading" aria-busy="true">
        <div className="jobDetail__skeletonLine jobDetail__skeletonLine--title" />
        <div className="jobDetail__skeletonLine" />
        <div className="jobDetail__skeletonLine" />
      </div>
    );
  }

  if (job === null) {
    return (
      <div className="jobDetail">
        <p className="jobDetail__notFound">
          Cette offre n'est plus disponible — elle a peut-être expiré ou été retirée.
        </p>
        <Link to="/offres" className="jobDetail__backLink">
          ← Voir d'autres offres
        </Link>
      </div>
    );
  }

  const salary = formatSalary(job);
  const relativeDate = formatRelativeDate(job.posted_at);

  return (
    <div className="jobDetail">
      <Link to="/offres" className="jobDetail__backLink">
        ← Toutes les offres
      </Link>

      <div className="jobDetail__header">
        <h1>{job.title ?? "Offre d'emploi"}</h1>
        {relativeDate && <span className="jobDetail__badge">{relativeDate}</span>}
      </div>

      <p className="jobDetail__company">{job.company_name ?? "Entreprise non précisée"}</p>
      <p className="jobDetail__meta">
        {[job.location, job.contract_type, job.remote_type].filter(Boolean).join(" · ") || "Lieu non précisé"}
      </p>
      {salary && <p className="jobDetail__salary">{salary}</p>}

      {job.description_excerpt && (
        <p className="jobDetail__excerpt">
          {job.description_excerpt}
          {job.description_excerpt.length >= 280 ? "…" : ""}
        </p>
      )}

      <div className="jobDetail__ctaBlock">
        <button type="button" className="btn btnPrimary" onClick={goSignUp}>
          Voir l'offre complète et candidater
        </button>
        <p className="jobDetail__ctaHint">Gratuit — crée un compte pour lire la description entière.</p>
      </div>
    </div>
  );
}
