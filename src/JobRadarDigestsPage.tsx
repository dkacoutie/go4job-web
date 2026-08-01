import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "./components/GuidedUI";
import { fetchDigestRuns, formatDigestDate, type JobRadarDigestRun } from "./lib/jobradarDigests";
import { useSession } from "./lib/useSession";
import "./JobRadarDigestsPage.css";

const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

function channelLabel(channel: string) {
  if (channel.includes("whatsapp")) return "WhatsApp";
  if (channel.includes("email") || channel.includes("digest")) return "Email";
  return channel || "JobRadar";
}

export default function JobRadarDigestsPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [rows, setRows] = useState<JobRadarDigestRun[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const load = useCallback(async () => {
    if (!userId) return;

    setBusy(true);
    setErrorMsg(null);

    try {
      const data = await fetchDigestRuns(userId);
      setRows(data);
    } catch {
      setErrorMsg(GENERIC_SERVER_ERROR);
    } finally {
      setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!loading && userId) {
      const timer = window.setTimeout(() => {
        void load();
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [loading, userId, load]);

  return (
    <div className="digests-shell">
      <section className="digests-hero">
        <div>
          <div className="digests-eyebrow">JobRadar</div>
          <h1>Mes alertes reçues</h1>
          <p>Retrouve ici les sélections d'offres envoyées par JobRadar, même si tu n'as pas ouvert l'email.</p>
        </div>
        <div className="digests-summary">
          <span>{busy ? "..." : rows.length}</span>
          <small>digests</small>
        </div>
      </section>

      {errorMsg && <div className="digests-error">{errorMsg}</div>}

      {busy ? (
        <div className="digests-panel">
          <div className="digests-loading">Chargement des alertes reçues...</div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucune alerte reçue pour l'instant"
          description="Tes prochaines sélections d'offres envoyées par JobRadar apparaîtront ici."
          primaryAction={{ label: "Voir mes offres", to: "/jobradar/feed" }}
          secondaryAction={{ label: "Gérer mes alertes", to: "/jobradar/alerts" }}
          tone="info"
        />
      ) : (
        <div className="digests-list">
          {rows.map((run) => (
            <button
              key={run.id}
              type="button"
              className="digests-row"
              onClick={() => navigate(`/jobradar/digests/${run.id}`)}
            >
              <span className="digests-rowMain">
                <span className="digests-rowDate">{formatDigestDate(run.digest_date)}</span>
                <span className="digests-rowTitle">{run.subject || "Nouvelles offres pour toi"}</span>
                {run.preheader && <span className="digests-rowText">{run.preheader}</span>}
              </span>
              <span className="digests-rowMeta">
                <span>{run.job_count} offre{run.job_count > 1 ? "s" : ""}</span>
                <small>{channelLabel(run.channel)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
