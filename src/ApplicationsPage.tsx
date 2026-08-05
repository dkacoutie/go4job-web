import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { EmptyState } from "./components/GuidedUI";
import { useToast } from "./components/ToastCenter";
import "./ApplicationsPage.css";

// Statuts réellement écrits en base, tous chemins confondus :
// - save_job (RPC, bouton "Sauvegarder" du fil d'offres) écrit "saved"
// - JobDetailsPage écrit "in_progress" puis "submitted"
// - cette page écrit "queued" (remettre) et "retired" (retirer)
// - "withdrawn" et "failed" existent aussi en base (autres chemins plus
//   anciens). Le type ci-dessous couvre l'ensemble constaté en prod le
//   05/08/2026 (voir requête "select status, count(*) from applications
//   group by status") : sans ça, cette page ne reconnaissait que
//   queued/submitted/retired et laissait ~83% des lignes réelles
//   invisibles dans les onglets À postuler/Envoyées/Retirées (visibles
//   seulement sous "Tout").
type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "retired" | "withdrawn" | "failed";

// Regroupe les statuts réels dans les 3 catégories affichées par les
// onglets. "saved" / "in_progress" / "failed" sont tous des variantes de
// "pas encore envoyée" -> À postuler. "withdrawn" est l'équivalent de
// "retired" écrit par d'autres chemins.
function statusBucket(s: ApplicationStatus): "queued" | "submitted" | "retired" {
  if (s === "submitted") return "submitted";
  if (s === "retired" || s === "withdrawn") return "retired";
  return "queued";
}

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

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function statusLabel(s: ApplicationStatus) {
  switch (s) {
    case "saved":
      return "À postuler";
    case "queued":
      return "À postuler";
    case "in_progress":
      return "En cours";
    case "submitted":
      return "Envoyée";
    case "retired":
      return "Retirée";
    case "withdrawn":
      return "Retirée";
    case "failed":
      return "Échec";
    default:
      return s;
  }
}

function statusClass(s: ApplicationStatus) {
  const bucket = statusBucket(s);
  return bucket === "submitted" ? "chipSubmitted" : bucket === "retired" ? "chipRetired" : "chipQueued";
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
  const { pushToast } = useToast();
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

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
    } catch {
      setErrorMsg(GENERIC_SERVER_ERROR);
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
      const bucket = statusBucket(r.status);
      c[bucket] += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const qn = norm(q);
    const byTab = tab === "all" ? rows : rows.filter((r) => statusBucket(r.status) === tab);

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
      setErrorMsg(GENERIC_SERVER_ERROR);
      pushToast({ kind: "error", title: "Mise à jour impossible", message: GENERIC_SERVER_ERROR });
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

    const label =
      next === "queued"
        ? "Offre remise dans À postuler"
        : next === "submitted"
        ? "Candidature marquée envoyée"
        : "Offre retirée";

    pushToast({
      kind: "success",
      title: label,
      message: "Tu peux continuer à organiser tes candidatures.",
    });
  }

  function openApply(r: AppRow) {
    const url = getApplyLink(r.jobs);
    if (!url) {
      setErrorMsg("Le lien de candidature n’est pas disponible pour cette offre.");
      pushToast({
        kind: "error",
        title: "Lien de candidature indisponible",
        message: "Le lien de candidature n’est pas disponible pour cette offre.",
      });
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
                Tes offres sauvegardées et les candidatures que tu suis dans JobRadar.
                <span className="app-pill">{counts.all} au total</span>
              </p>
            </div>

            <div className="app-heroActions">
              <button className="btn btnGhost" onClick={() => navigate("/jobradar/feed")}>
                Voir les offres →
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
                placeholder="Rechercher par titre, entreprise, pays ou télétravail..."
              />
            </div>
          </div>
        </section>

        {errorMsg && <div className="app-error">Erreur : {errorMsg}</div>}

        {busy ? (
          <div className="app-empty">Chargement des candidatures…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Tu n’as pas encore d’offres sauvegardées"
            description="Explore les offres et ajoute celles qui t’intéressent à ta liste À postuler."
            primaryAction={{ label: "Explorer les offres", to: "/jobradar/feed" }}
            tone="info"
          />
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

                  {statusBucket(r.status) === "retired" && (
                    <div className="app-failNote">🗑️ Retirée de ta liste (tu peux la remettre quand tu veux).</div>
                  )}

                  <div className="app-actions">
                    <button className="btn btnPrimary" onClick={() => navigate(`/jobradar/jobs/${r.job_id}`)}>
                      Voir l’offre →
                    </button>

                    <div className="app-actionsRight">
                      {statusBucket(r.status) === "retired" ? (
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
                            title={!applyLink ? "Lien de candidature indisponible" : "Ouvrir le lien de candidature"}
                          >
                            Ouvrir le lien de candidature
                          </button>

                          <button
                            className="btn btnGhost"
                            disabled={isUpdating || r.status === "submitted"}
                            onClick={() => setStatus(r.id, r.job_id, "submitted")}
                            title="Confirmer que tu as envoyé ta candidature"
                          >
                            Confirmer que j’ai postulé
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
