import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
import { trackApplicationStarted } from "./lib/analytics";
import { formatPlainDescriptionToHtml, formatSourceHtml, stripHtmlToText } from "./lib/jobDescriptionFormat";
import { CompanyAvatar } from "./components/CompanyAvatar";
import "./JobDetailsPage.css";

type ApplicationStatus =
  | "saved"
  | "queued"
  | "in_progress"
  | "submitted"
  | "sent"
  | "withdrawn"
  | "retired"
  | "expired"
  | "failed";

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
  official_desc?: string | null;
  desc_source?: string | null;
  desc_quality?: number | null;
  desc_updated_at?: string | null;
  desc_last_error?: string | null;

  ai_description?: string | null;
  ai_description_model?: string | null;
  ai_description_updated_at?: string | null;
  ai_description_quality?: number | null;
  ai_description_status?: string | null;
  ai_description_error?: string | null;

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

const MIN_DESC_LEN = 400;
type ApplyOpenMode = "new-tab" | "same-tab";

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || trimmed.startsWith("#")) return null;

  const candidate = /^[a-z][a-z\d+\-.]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function safeHostLabel(raw: string | null): string | null {
  try {
    if (!raw) return null;
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function statusLabel(s: ApplicationStatus) {
  switch (s) {
    case "saved":
    case "queued":
      return "À postuler";
    case "in_progress":
      return "En préparation";
    case "submitted":
    case "sent":
      return "Envoyée";
    case "withdrawn":
    case "retired":
      return "Retirée";
    case "expired":
      return "Expirée";
    case "failed":
      return "Échouée";
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
    : s === "submitted" || s === "sent"
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
 * Sanitizer pour le HTML de description d'offre, issu de sources scrapées
 * externes non fiables. Remplace un sanitizer maison (retrait de balises
 * script/style/iframe, attributs "on..." et schémas javascript:/data:
 * uniquement, qui ne couvrait pas des vecteurs XSS connus comme style avec
 * expression(), srcdoc, SVG/MathML,
 * <base>, xlink:href ou les entités encodées) par DOMPurify, une librairie
 * dédiée et maintenue. Liste blanche restreinte au balisage réellement utile
 * pour une description de poste (texte, listes, tableaux, liens).
 */
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
  const location = useLocation();
  const { session, loading } = useSession();
  const { hasActivePass, isLoadingPass } = usePass();
  const allowPremium = hasActivePass && !isLoadingPass;
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";
  const DETAILS_GATE_MESSAGE = "Choisis un pass pour accéder à l’offre complète.";
  const userId = session?.user?.id ?? null;

  const [job, setJob] = useState<JobRow | null>(null);
  const [app, setApp] = useState<AppRow | null>(null);

  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [autoApplyKey, setAutoApplyKey] = useState<string | null>(null);

  const srcUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return safeExternalUrl(params.get("src"));
  }, [location.search]);

  const shouldAutoApply = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("action") === "apply";
  }, [location.search]);

  const similarQuery = useMemo(() => {
    if (job?.title) return job.title;
    return safeHostLabel(srcUrl);
  }, [job, srcUrl]);

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
      setErrorMsg(null);
      return;
    }

    if (!isActive()) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      // Finalisation activation/paiement (24/07/2026) : ces champs (lien de
      // candidature, description complète, IA) sont la valeur réservée au
      // pass. Avant ce correctif, ils étaient TOUJOURS récupérés du serveur
      // pour n'importe quel compte, y compris gratuit, et seul l'affichage
      // (allowPremium ? ... : ...) les cachait — un compte gratuit pouvait
      // les lire directement dans l'onglet réseau du navigateur. On ne
      // demande plus ces champs au serveur du tout pour un compte sans pass
      // actif, plutôt que de les recevoir et de juste ne pas les afficher.
      const premiumFields = allowPremium
        ? `,
          apply_url,
          source_url,
          description_text,
          description_html,
          official_desc,
          desc_source,
          desc_quality,
          desc_updated_at,
          desc_last_error,
          ai_description,
          ai_description_model,
          ai_description_updated_at,
          ai_description_quality,
          ai_description_status,
          ai_description_error,
          job_json`
        : "";
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
          sort_at,
          published_at,
          posted_at,
          scraped_at,
          created_at,
          updated_at${premiumFields}
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
    } catch {
      if (isActive()) setErrorMsg(GENERIC_SERVER_ERROR);
    } finally {
      if (isActive()) setBusy(false);
    }
  };

  useEffect(() => {
    // On attend que le statut du pass soit connu avant de charger l'offre :
    // le select ci-dessus dépend de allowPremium pour décider quels champs
    // demander au serveur, un chargement prématuré donnerait la version
    // gratuite même à un compte payant le temps que isLoadingPass se résolve.
    if (loading || !id || isLoadingPass) return;
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, id, userId, isLoadingPass, allowPremium]);

  const date = useMemo(() => (job ? firstDate(job) : null), [job]);

  const applyLink = useMemo(() => {
    if (!job) return null;
    return safeExternalUrl(job.apply_url) ?? safeExternalUrl(job.source_url);
  }, [job]);

  const similarLink = useMemo(() => {
    if (!similarQuery) return "/jobradar/feed";
    return `/jobradar/feed?q=${encodeURIComponent(similarQuery)}`;
  }, [similarQuery]);

  const desc = useMemo(() => {
    const officialText = (job?.official_desc ?? "").trim();
    const text = officialText || (job?.description_text ?? "").trim();
    const htmlRaw = (job?.description_html ?? "").trim();
    const jsonDesc = extractDescFromJobJson(job?.job_json ?? null);

    const htmlSource = htmlRaw || jsonDesc.html || "";
    const html = htmlSource ? formatSourceHtml(htmlSource) : "";
    const htmlText = html ? stripHtmlToText(html) : "";
    const jsonText = (jsonDesc.text ?? "").trim();

    const baseText = text || htmlText || jsonText;
    const baseLen = baseText.trim().length;

    const scrapedOk = baseLen >= MIN_DESC_LEN;
    const aiText = (job?.ai_description ?? "").trim();
    const aiOk = job?.ai_description_status === "ok" && aiText.length > 0;

    // Le HTML fourni par la source prime toujours (déjà structuré, on ne le
    // retouche pas). A défaut, on reconstruit une structure sûre à partir du
    // texte brut, sans jamais inventer de contenu absent du texte source.
    const formattedFromText = !html && baseText ? formatPlainDescriptionToHtml(baseText) : "";

    return {
      scrapedOk,
      aiOk,
      baseText,
      html,
      formattedFromText,
      aiText,
      baseLen,
    };
  }, [job]);

  async function postuler(openMode: ApplyOpenMode = "new-tab") {
    if (!id || !isUuid(id)) return;

    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }

    if (!allowPremium) {
      setErrorMsg("Un pass actif est requis pour accéder à cette fonctionnalité.");
      return;
    }

    if (!applyLink) {
      setErrorMsg("Le lien de candidature n’est pas disponible pour cette offre.");
      return;
    }

    // La redirection part immédiatement, avant tout appel réseau : sur
    // mobile, l'autorisation de navigation accordée par le clic ne survit
    // pas à un aller-retour réseau (contrairement à la plupart des
    // navigateurs desktop, plus tolérants). Sans ça, "même onglet" —
    // utilisé par l'ouverture automatique depuis une notification — se
    // bloquait silencieusement sur téléphone.
    if (openMode === "new-tab") {
      window.open(applyLink, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign(applyLink);
    }

    setActionBusy(true);
    setErrorMsg(null);

    // Enregistrement de la candidature en tâche de fond : on ne bloque plus
    // la redirection sur cet appel, seulement le suivi/analytics.
    void (async () => {
      try {
        const { error } = await supabase
          .from("applications")
          .upsert(
            { user_id: userId, job_id: id, status: "in_progress" as ApplicationStatus },
            { onConflict: "user_id,job_id" }
          );

        if (error) throw error;
        trackApplicationStarted({ jobId: id });
      } catch {
        setErrorMsg(GENERIC_SERVER_ERROR);
      } finally {
        setActionBusy(false);
        if (openMode === "new-tab") {
          void load();
        }
      }
    })();
  }

  useEffect(() => {
    const key = shouldAutoApply && id ? `${id}:${location.search}` : null;
    if (!key || autoApplyKey === key || busy || loading || isLoadingPass || !job || !userId) return;

    setAutoApplyKey(key);
    void postuler("same-tab");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoApply, id, location.search, autoApplyKey, busy, loading, isLoadingPass, job, userId]);

  async function removeFromList() {
    if (!userId || !id || !isUuid(id) || !app) return;

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from("applications").delete().eq("user_id", userId).eq("job_id", id);
      if (error) throw error;
      setApp(null);
    } catch {
      setErrorMsg(GENERIC_SERVER_ERROR);
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
    } catch {
      setErrorMsg(GENERIC_SERVER_ERROR);
    } finally {
      setActionBusy(false);
    }
  }

  async function generateNow() {
    if (!id || !isUuid(id)) return;
    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }

    if (!allowPremium) {
      setErrorMsg("Un pass actif est requis pour accéder à cette fonctionnalité.");
      return;
    }

    setAiBusy(true);
    setAiMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("user_generate_ai_desc", {
        body: { job_id: id },
      });
      if (error) throw error;
      if (data?.ok) {
        setAiMsg("Génération lancée.");
      } else {
        setAiMsg(GENERIC_SERVER_ERROR);
      }
      await load();
    } catch {
      setAiMsg(GENERIC_SERVER_ERROR);
    } finally {
      setAiBusy(false);
    }
  }

  const descBadge = () => {
    if (!job) return null;
    if (desc.scrapedOk) {
      return (
        <span className="chip jd-src jd-srcScraped">
          Source : site officiel
        </span>
      );
    }
    if (desc.aiOk) {
      return (
        <span className="chip jd-src jd-srcAi">
          Description générée par IA
        </span>
      );
    }
    return null;
  };

  const renderActions = (placement: "top" | "bottom") => (
    <div className={`jd-actions jd-actions--${placement}`}>
      <button className="btn btnPrimary" disabled={actionBusy} onClick={() => postuler()}>
        {actionBusy ? "Ouverture..." : "Ouvrir le lien de candidature"}
      </button>

      <div className="jd-actionsRow">
        <button
          className="btn btnGhost"
          disabled={actionBusy}
          onClick={markSubmitted}
          title="Confirmer que tu as envoyé ta candidature"
        >
          Confirmer que j’ai postulé
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
  );

  return (
    <div className="jd-shell">
      <main className="jd-main">
        <div className="jd-topbar">
          <button className="btn btnGhost" onClick={() => navigate(-1)}>
            {"<-"} Retour
          </button>
          <button className="btn btnGhost" onClick={() => navigate("/jobradar/feed")}>
            Offres pour moi {"->"}
          </button>
        </div>

        {errorMsg && <div className="jd-error">Erreur : {errorMsg}</div>}

        {busy ? (
          <div className="jd-empty">Chargement de l'offre...</div>
        ) : !job ? (
          <div className="jd-missing">
            <div className="jd-missingTitle">Cette offre n'est plus disponible</div>
            <div className="jd-missingText">
              Le lien a peut-être expiré ou l'offre a été retirée.
            </div>
            <div className="jd-missingActions">
              <button className="btn btnPrimary" onClick={() => navigate("/jobradar/feed")}>
                Retour aux offres
              </button>
              <button className="btn btnGhost" onClick={() => navigate(similarLink)}>
                Voir des offres similaires
              </button>
              {srcUrl && (
                <a className="btn btnGhost" href={srcUrl} target="_blank" rel="noopener noreferrer">
                  Ouvrir la source
                </a>
              )}
            </div>
          </div>
        ) : (
          <section className="jd-card">
            <div className="jd-head">
              <div className="jd-headLeft">
                <CompanyAvatar
                  companyName={job.company_name}
                  applyUrl={job.apply_url}
                  sourceUrl={job.source_url}
                  avatarClassName="jd-avatar"
                  imgClassName="jd-avatarImg"
                />
                <div>
                  <h1 className="jd-title">{job.title ?? "Offre"}</h1>
                  <div className="jd-sub">
                    {(job.company_name ?? "-") +
                      " | " +
                      (job.location ?? job.country ?? "-") +
                      (job.remote_type ? ` | ${job.remote_type}` : "")}
                  </div>
                </div>
              </div>

              <div className="jd-badges">
                {app && (
                  <span className={`chip chipStatus ${statusClass(app.status)}`}>
                    {statusLabel(app.status)}
                  </span>
                )}
                {date && <span className="chip jd-date">Publié : {date.toLocaleDateString()}</span>}
              </div>
            </div>

            {allowPremium ? (
              <>
            {renderActions("top")}

            <div className="jd-body">
              <h3>Description</h3>

              <div className="jd-descMeta">
                {descBadge()}
                {desc.scrapedOk && job.desc_updated_at && (
                  <span className="jd-dateSmall">
                    Mis à jour: {new Date(job.desc_updated_at).toLocaleDateString()}
                  </span>
                )}
                {!desc.scrapedOk && desc.aiOk && job.ai_description_updated_at && (
                  <span className="jd-dateSmall">
                    Générée: {new Date(job.ai_description_updated_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="jd-desc">
                {desc.scrapedOk ? (
                  desc.html ? (
                    <div className="jd-html" dangerouslySetInnerHTML={{ __html: desc.html }} />
                  ) : desc.formattedFromText ? (
                    <div className="jd-html" dangerouslySetInnerHTML={{ __html: desc.formattedFromText }} />
                  ) : (
                    <div className="jd-descPlain">{desc.baseText}</div>
                  )
                ) : desc.aiOk ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{desc.aiText}</div>
                ) : (
                  <div className="jd-noDesc">
                    <div>
                      <span className="jd-muted">Description en cours de génération...</span>
                      <div className="jd-genNote">
                        La description sera enrichie automatiquement si le site source ne fournit pas assez de détails.
                      </div>
                    </div>
                    <button className="btn btnPrimary jd-applyBtn" onClick={generateNow} disabled={aiBusy}>
                      {aiBusy ? "Génération..." : "Générer maintenant"}
                    </button>
                    {aiMsg && <div className="jd-aiMsg">{aiMsg}</div>}
                  </div>
                )}
              </div>

              {!desc.scrapedOk && !desc.aiOk && applyLink && (
                <a className="btn btnGhost jd-sourceBtn" href={applyLink} target="_blank" rel="noreferrer">
                  Voir l'offre source
                </a>
              )}
            </div>
            {renderActions("bottom")}
              </>
            ) : (
              <div className="jd-locked">
                <div className="jd-lockedTitle">Accès complet</div>
                <div className="jd-lockedText">{DETAILS_GATE_MESSAGE}</div>
                <button className="btn btnPrimary" onClick={() => navigate("/pricing")}>
                  Voir les pass JobRadar
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
