import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "./components/GuidedUI";
import {
  fetchDigestDetail,
  formatDigestDate,
  isDigestItemExpired,
  type JobRadarDigestItem,
  type JobRadarDigestRun,
} from "./lib/jobradarDigests";
import { useSession } from "./lib/useSession";
import "./JobRadarDigestsPage.css";

const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

function locationText(item: JobRadarDigestItem) {
  return [item.company_name, item.location || item.country].filter(Boolean).join(" · ");
}

export default function JobRadarDigestDetailPage() {
  const navigate = useNavigate();
  const { runId } = useParams();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [run, setRun] = useState<JobRadarDigestRun | null>(null);
  const [items, setItems] = useState<JobRadarDigestItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const load = useCallback(async () => {
    if (!userId || !runId) return;

    setBusy(true);
    setErrorMsg(null);

    try {
      const data = await fetchDigestDetail(userId, runId);
      setRun(data.run);
      setItems(data.items);
    } catch {
      setErrorMsg(GENERIC_SERVER_ERROR);
    } finally {
      setBusy(false);
    }
  }, [userId, runId]);

  useEffect(() => {
    if (!loading && userId && runId) {
      const timer = window.setTimeout(() => {
        void load();
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [loading, userId, runId, load]);

  return (
    <div className="digests-shell">
      <section className="digests-hero digests-hero--detail">
        <div>
          <button type="button" className="digests-back" onClick={() => navigate("/jobradar/digests")}>
            Retour
          </button>
          <div className="digests-eyebrow">Alerte reçue</div>
          <h1>{run?.subject || "Nouvelles offres pour toi"}</h1>
          <p>{run?.preheader || (run ? formatDigestDate(run.digest_date) : "Chargement de la sélection...")}</p>
        </div>
        <div className="digests-summary">
          <span>{busy ? "..." : items.length}</span>
          <small>offres</small>
        </div>
      </section>

      {errorMsg && <div className="digests-error">{errorMsg}</div>}

      {busy ? (
        <div className="digests-panel">
          <div className="digests-loading">Chargement des offres sélectionnées...</div>
        </div>
      ) : !run ? (
        <EmptyState
          title="Digest introuvable"
          description="Cette sélection n'existe pas ou n'est pas accessible avec ton compte."
          primaryAction={{ label: "Voir mes alertes reçues", to: "/jobradar/digests" }}
          tone="info"
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Aucune offre dans cette sélection"
          description="Le digest existe, mais aucune offre n'a été conservée dans son historique."
          primaryAction={{ label: "Voir mes offres", to: "/jobradar/feed" }}
          tone="neutral"
        />
      ) : (
        <div className="digests-items">
          {items.map((item) => {
            const expired = isDigestItemExpired(item);
            return (
              <article key={item.id} className="digests-item">
                <div className="digests-rank">{item.rank}</div>
                <div className="digests-itemBody">
                  <div className="digests-itemTop">
                    <h2>{item.title}</h2>
                    {expired && <span className="digests-expired">Expirée</span>}
                  </div>
                  {locationText(item) && <p>{locationText(item)}</p>}
                  <div className="digests-itemMeta">
                    {typeof item.score === "number" && <span>Score {Math.round(item.score)}</span>}
                    {item.country && <span>{item.country}</span>}
                  </div>
                </div>
                {item.job_id && !expired ? (
                  <button
                    type="button"
                    className="digests-openJob"
                    onClick={() => navigate(`/jobradar/jobs/${item.job_id}`)}
                  >
                    Voir
                  </button>
                ) : (
                  <span className="digests-openJob digests-openJob--disabled">Archive</span>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
