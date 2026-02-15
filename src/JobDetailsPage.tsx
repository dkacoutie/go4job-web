import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./JobDetailsPage.css";

type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "failed";

type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;

  apply_url?: string | null;
  source_url?: string | null;

  description_text?: string | null;
  description_html?: string | null;
  job_json?: Record<string, unknown> | null;

  sort_at?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AppRow = {
  id: number;
  job_id: string;
  status: ApplicationStatus;
  created_at: string | null;
  submitted_at?: string | null;
  error_message?: string | null;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(err);
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function statusLabel(s: ApplicationStatus) {
  switch (s) {
    case "saved":
      return "A postuler";
    case "queued":
      return "En file";
    case "in_progress":
      return "En cours";
    case "submitted":
      return "Envoyee";
    case "failed":
      return "Echouee";
    default:
      return s;
  }
}

function statusClass(s: ApplicationStatus) {
  return s === "saved"
    ? "chipQueued"
    : s === "queued"
    ? "chipQueued"
    : s === "in_progress"
    ? "chipInProgress"
    : s === "submitted"
    ? "chipSubmitted"
    : "chipFailed";
}

function firstDate(job: JobRow) {
  const candidates = [
    job.published_at,
    job.posted_at,
    job.sort_at,
    job.scraped_at,
    job.created_at,
    job.updated_at,
  ].filter(Boolean) as string[];

  for (const d of candidates) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

/**
 * Browser sanitizer:
 * - remove script/style/iframe/object/embed/link/meta
 * - remove on* attributes
 * - remove href/src dangerous schemes (javascript:, data:)
 */
function sanitizeHtmlBasic(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");

    const badSelectors = "script,style,iframe,object,embed,link,meta";
    doc.querySelectorAll(badSelectors).forEach((n) => n.remove());

    const all = doc.body.querySelectorAll<HTMLElement>("*");
    all.forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = (attr.value ?? "").trim().toLowerCase();

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          return;
        }

        if ((name === "href" || name === "src") && (value.startsWith("javascript:") || value.startsWith("data:"))) {
          el.removeAttribute(attr.name);
          return;
        }
      });

      if (el.tagName.toLowerCase() === "a") {
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      }
    });

    return doc.body.innerHTML;
  } catch {
    return (html ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  }
}

function stripHtmlToText(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return (html ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function pickFirstString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractDescFromJobJson(jobJson?: Record<string, unknown> | null) {
  if (!jobJson) return { html: "", text: "" };

  const direct = pickFirstString(jobJson, [
    "description_html",
    "description",
    "description_text",
    "content",
    "job_description",
    "details",
    "summary",
    "body",
  ]);

  const nestedJob = (jobJson as Record<string, unknown>)?.job;
  const nested = pickFirstString(nestedJob, [
    "description_html",
    "description",
    "description_text",
    "content",
    "job_description",
    "details",
    "summary",
    "body",
  ]);

  const raw = (direct ?? nested ?? "").trim();
  if (!raw) return { html: "", text: "" };

  const looksLikeHtml = /<[^>]+>/.test(raw);
  return looksLikeHtml ? { html: raw, text: "" } : { html: "", text: raw };
}

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [job, setJob] = useState<JobRow | null>(null);
  const [app, setApp] = useState<AppRow | null>(null);

  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const load = async (isActive: () => boolean = () => true) => {
    if (!id) return;

    if (!isUuid(id)) {
      if (!isActive()) return;
      setJob(null);
      setApp(null);
      setBusy(false);
      setErrorMsg("ID d'offre invalide (UUID attendu).");
      return;
    }

    if (!isActive()) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      const { data: jData, error: jErr } = await supabase
        .from("jobs")
        .select(
          `
          id,
          title,
          company_name,
          location,
          country,
          remote_type,
          apply_url,
          source_url,
          description_text,
          description_html,
          job_json,
          sort_at,
          published_at,
          posted_at,
          scraped_at,
          created_at,
          updated_at
        `
        )
        .eq("id", id)
        .maybeSingle();

      if (jErr) throw jErr;
      if (isActive()) setJob((jData ?? null) as JobRow | null);

      if (userId) {
        const { data: aData, error: aErr } = await supabase
          .from("applications")
          .select("id, job_id, status, created_at, submitted_at, error_message")
          .eq("user_id", userId)
          .eq("job_id", id)
          .maybeSingle();

        if (aErr) throw aErr;
        if (isActive()) setApp((aData ?? null) as AppRow | null);
      } else if (isActive()) {
        setApp(null);
      }
    } catch (error: unknown) {
      if (isActive()) setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      if (isActive()) setBusy(false);
    }
  };

  useEffect(() => {
    if (loading || !id) return;
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, id, userId]);

  const date = useMemo(() => (job ? firstDate(job) : null), [job]);

  const applyLink = useMemo(() => {
    if (!job) return null;
    return job.apply_url || job.source_url || null;
  }, [job]);

  const desc = useMemo(() => {
    const text = (job?.description_text ?? "").trim();
    const htmlRaw = (job?.description_html ?? "").trim();
    const jsonDesc = extractDescFromJobJson(job?.job_json ?? null);

    const htmlSource = htmlRaw || jsonDesc.html || "";
    const html = htmlSource ? sanitizeHtmlBasic(htmlSource) : "";
    const textSource = text || jsonDesc.text || "";
    const fallbackText = !textSource && html ? stripHtmlToText(html) : "";
    return { text: textSource, html, fallbackText };
  }, [job]);

  async function postuler() {
    if (!id || !isUuid(id)) return;

    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }

    if (!applyLink) {
      setErrorMsg("Aucun lien de candidature (apply_url/source_url) n'est disponible pour cette offre.");
      return;
    }

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase
        .from("applications")
        .upsert(
          { user_id: userId, job_id: id, status: "in_progress" as ApplicationStatus },
          { onConflict: "user_id,job_id" }
        );

      if (error) throw error;

      window.open(applyLink, "_blank", "noopener,noreferrer");
      await load();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  async function removeFromList() {
    if (!userId || !id || !isUuid(id) || !app) return;

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from("applications").delete().eq("user_id", userId).eq("job_id", id);
      if (error) throw error;
      setApp(null);
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  async function markSubmitted() {
    if (!userId || !id || !isUuid(id)) return;

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: "submitted", submitted_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("job_id", id);

      if (error) throw error;
      await load();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="jd-shell">
      <main className="jd-main">
        <div className="jd-topbar">
          <button className="btn btnGhost" onClick={() => navigate(-1)}>
            {"<-"} Retour
          </button>
          <button className="btn btnGhost" onClick={() => navigate("/jobradar/feed")}>
            Feed JobRadar {"->"}
          </button>
        </div>

        {errorMsg && <div className="jd-error">Erreur : {errorMsg}</div>}

        {busy ? (
          <div className="jd-empty">Chargement de l'offre...</div>
        ) : !job ? (
          <div className="jd-empty">Offre introuvable.</div>
        ) : (
          <section className="jd-card">
            <div className="jd-head">
              <div>
                <h1 className="jd-title">{job.title ?? "Offre"}</h1>
                <div className="jd-sub">
                  {(job.company_name ?? "-") +
                    " | " +
                    (job.location ?? job.country ?? "-") +
                    (job.remote_type ? ` | ${job.remote_type}` : "")}
                </div>
              </div>

              <div className="jd-badges">
                {app && (
                  <span className={`chip chipStatus ${statusClass(app.status)}`}>
                    {statusLabel(app.status)}
                  </span>
                )}
                {date && <span className="chip jd-date">Publie : {date.toLocaleDateString()}</span>}
              </div>
            </div>

            <div className="jd-actions">
              <button className="btn btnPrimary" disabled={actionBusy} onClick={postuler}>
                {actionBusy ? "Ouverture..." : "Postuler / Soumettre"}
              </button>

              <div className="jd-actionsRow">
                <button
                  className="btn btnGhost"
                  disabled={actionBusy}
                  onClick={markSubmitted}
                  title="Confirmer candidature envoyee"
                >
                  Marquer envoyee
                </button>

                {app && (
                  <button className="btn btnGhost" disabled={actionBusy} onClick={removeFromList}>
                    Retirer
                  </button>
                )}
              </div>

              <button className="btn btnGhost" onClick={() => navigate("/jobradar/applications")}>
                Voir mes candidatures {"->"}
              </button>
            </div>

            <div className="jd-body">
              <h3>Description</h3>

              <div className="jd-desc">
                {desc.html ? (
                  <div className="jd-html" dangerouslySetInnerHTML={{ __html: desc.html }} />
                ) : desc.text ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{desc.text}</div>
                ) : desc.fallbackText ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{desc.fallbackText}</div>
                ) : (
                  <div className="jd-noDesc">
                    <span className="jd-muted">Description indisponible.</span>
                    {applyLink && (
                      <a className="btn btnPrimary jd-applyBtn" href={applyLink} target="_blank" rel="noreferrer">
                        Voir l'offre
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
