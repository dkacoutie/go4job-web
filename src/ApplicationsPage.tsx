import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./ApplicationsPage.css";

type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "retired" | "failed";

type JobMini = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;

  // ✅ important pour “Soumettre”
  apply_url?: string | null;
  source_url?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
};

type AppRow = {
  id: number;
  user_id: string;
  job_id: string;
  status: ApplicationStatus;
  created_at: string | null;
  submitted_at?: string | null;
  error_message?: string | null;
  jobs?: JobMini | null; // join
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(err);
}

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function statusLabel(s: ApplicationStatus) {
  switch (s) {
    case "saved":
    case "queued":
      return "À postuler";
    case "in_progress":
      return "En cours";
    case "submitted":
      return "Envoyée";
    case "retired":
      return "Retirée";
    case "failed":
      return "Échouée";
    default:
      return s;
  }
}

function statusClass(s: ApplicationStatus) {
  if (s === "saved" || s === "queued") return "chipQueued";
  if (s === "in_progress") return "chipInProgress";
  if (s === "submitted") return "chipSubmitted";
  if (s === "failed") return "chipFailed";
  return "chipRetired";
}

function getApplyLink(job?: JobMini | null) {
  const url = job?.apply_url || job?.source_url || null;
  if (!url) return null;
  // petit garde-fou : certains liens sont sans protocole
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

export default function ApplicationsPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [rows, setRows] = useState<AppRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ Tabs simples
  const [tab, setTab] = useState<ApplicationStatus | "all">("queued");
  const [q, setQ] = useState("");

  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  async function load() {
    if (!userId) return;

    setBusy(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase
        .from("applications")
        .select(
          `
          id,
          user_id,
          job_id,
          status,
          created_at,
          submitted_at,
          error_message,
          jobs:jobs (
            id,
            title,
            company_name,
            location,
            country,
            remote_type,
            apply_url,
            source_url,
            created_at,
            updated_at
          )
        `
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const normalized = (data ?? []).map((row) => {
        const baseRow = row as {
          id: number;
          user_id: string;
          job_id: string;
          status: ApplicationStatus;
          created_at: string | null;
          submitted_at?: string | null;
          error_message?: string | null;
          jobs?: JobMini | JobMini[] | null;
        };

        const jobsField = Array.isArray(baseRow.jobs) ? baseRow.jobs[0] ?? null : baseRow.jobs ?? null;

        return {
          id: baseRow.id,
          user_id: baseRow.user_id,
          job_id: baseRow.job_id,
          status: baseRow.status,
          created_at: baseRow.created_at,
          submitted_at: baseRow.submitted_at ?? null,
          error_message: baseRow.error_message ?? null,
          jobs: jobsField ?? null,
        } satisfies AppRow;
      });
      setRows(normalized);
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e) ?? "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && session && userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, userId]);

  const counts = useMemo(() => {
  const c = { all: rows.length, queued: 0, submitted: 0, retired: 0 };
  for (const r of rows) {
    if (r.status === "saved" || r.status === "queued" || r.status === "in_progress") c.queued += 1;
    else if (r.status === "submitted") c.submitted += 1;
    else if (r.status === "retired") c.retired += 1;
  }
  return c;
}, [rows]);

  const filtered = useMemo(() => {
    const qn = norm(q);
    const byTab = tab === "all" ? rows : tab === "queued" ? rows.filter((r) => r.status === "saved" || r.status === "queued" || r.status === "in_progress") : rows.filter((r) => r.status === tab);

    if (!qn) return byTab;

    return byTab.filter((r) => {
      const j = r.jobs;
      const hay = norm(
        [j?.title, j?.company_name, j?.location, j?.country, j?.remote_type, statusLabel(r.status)]
          .filter(Boolean)
          .join(" ")
      );
      return hay.includes(qn);
    });
  }, [rows, tab, q]);

  async function setStatus(appId: number, jobId: string, next: ApplicationStatus) {
    if (!userId) return;

    setUpdatingId(appId);
    setErrorMsg(null);

    const payload: { status: ApplicationStatus; error_message: string | null; submitted_at: string | null } = {
      status: next,
      error_message: null,
      submitted_at: null,
    };

    // ✅ logique “Retirée”
    if (next === "retired") payload.error_message = "Retirée par l’utilisateur";
    if (next !== "retired") payload.error_message = null;

    // ✅ logique “Envoyée”
    if (next === "submitted") payload.submitted_at = new Date().toISOString();
    if (next !== "submitted") payload.submitted_at = null;

    const { error } = await supabase
      .from("applications")
      .update(payload)
      .eq("user_id", userId)
      .eq("job_id", jobId);

    setUpdatingId(null);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.id === appId
          ? {
              ...r,
              status: next,
              error_message: payload.error_message,
              submitted_at: payload.submitted_at,
            }
          : r
      )
    );
  }

  function openApply(r: AppRow) {
    const url = getApplyLink(r.jobs);
    if (!url) {
      setErrorMsg("Aucun lien de candidature (apply_url/source_url) pour cette offre.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        <section className="app-hero">
          <div className="app-heroTop">
            <div>
              <h1>Candidatures</h1>
              <p>
                Tes candidatures ajoutées depuis JobRadar.
                <span className="app-pill">{counts.all} au total</span>
              </p>
            </div>

            <div className="app-heroActions">
              <button className="btn btnGhost" onClick={() => navigate("/jobradar/feed")}>
                Aller au feed →
              </button>
              <button className="btn btnGhost" onClick={load} disabled={busy}>
                {busy ? "Chargement…" : "Rafraîchir"}
              </button>
            </div>
          </div>

          <div className="app-toolbar">
            <div className="app-tabs">
              <button className={`app-tab ${tab === "queued" ? "isActive" : ""}`} onClick={() => setTab("queued")}>
                À postuler <span className="app-count">{counts.queued}</span>
              </button>

              <button
                className={`app-tab ${tab === "submitted" ? "isActive" : ""}`}
                onClick={() => setTab("submitted")}
              >
                Envoyées <span className="app-count">{counts.submitted}</span>
              </button>

              <button className={`app-tab ${tab === "retired" ? "isActive" : ""}`} onClick={() => setTab("retired")}>
                Retirées <span className="app-count">{counts.retired}</span>
              </button>

              <button className={`app-tab ${tab === "all" ? "isActive" : ""}`} onClick={() => setTab("all")}>
                Tout <span className="app-count">{counts.all}</span>
              </button>
            </div>

            <div className="app-search">
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher (titre, entreprise, pays, remote...)"
              />
            </div>
          </div>
        </section>

        {errorMsg && <div className="app-error">Erreur : {errorMsg}</div>}

        {busy ? (
          <div className="app-empty">Chargement des candidatures…</div>
        ) : filtered.length === 0 ? (
          <div className="app-empty">Aucune candidature ici pour l’instant.</div>
        ) : (
          <div className="app-grid">
            {filtered.map((r) => {
              const job = r.jobs;
              const isUpdating = updatingId === r.id;
              const applyLink = getApplyLink(job);

              return (
                <div className="app-card" key={r.id}>
                  <div className="app-cardTop">
                    <div className="app-title">{job?.title ?? "Offre"}</div>
                    <span className={`chip chipStatus ${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                  </div>

                  <div className="app-meta">
                    {(job?.company_name ?? "—") +
                      " · " +
                      (job?.location ?? job?.country ?? "—") +
                      (job?.remote_type ? ` · ${job.remote_type}` : "")}
                  </div>

                  {r.status === "retired" && (
                    <div className="app-failNote">🗑️ Retirée de ta liste (tu peux la remettre quand tu veux).</div>
                  )}

                  <div className="app-actions">
                    <button className="btn btnPrimary" onClick={() => navigate(`/jobradar/jobs/${r.job_id}`)}>
                      Voir l’offre →
                    </button>

                    <div className="app-actionsRight">
                      {r.status === "retired" ? (
                        <button
                          className="btn btnGhost"
                          disabled={isUpdating}
                          onClick={() => setStatus(r.id, r.job_id, "queued")}
                          title="Remettre cette candidature dans À postuler"
                        >
                          Remettre
                        </button>
                      ) : (
                        <>
                          <button
                            className="btn btnGhost"
                            disabled={isUpdating || !applyLink}
                            onClick={() => openApply(r)}
                            title={!applyLink ? "Aucun lien apply_url/source_url" : "Ouvrir le formulaire / site"}
                          >
                            Soumettre
                          </button>

                          <button
                            className="btn btnGhost"
                            disabled={isUpdating || r.status === "submitted"}
                            onClick={() => setStatus(r.id, r.job_id, "submitted")}
                            title="Marquer comme candidature envoyée"
                          >
                            Marquer envoyée
                          </button>

                          <button
                            className="btn btnGhost"
                            disabled={isUpdating}
                            onClick={() => setStatus(r.id, r.job_id, "retired")}
                            title="Retirer de ta liste (sans supprimer)"
                          >
                            Retirer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}



