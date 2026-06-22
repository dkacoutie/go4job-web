import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "./components/ToastCenter";
import {
  fetchCapcarriereDrafts,
  fetchCapcarriereEvents,
  fetchCurrentCapcarriereCv,
  reviewCapcarriereDraft,
  type CapcarriereCv,
  type CapcarriereDraft,
  type CapcarriereDraftStatus,
  type CapcarriereEvent,
} from "./lib/capcarriereApplicationsApi";
import { useSession } from "./lib/useSession";
import capcarriereLogo from "./assets/capcarriere-logo.png";
import "./CapcarriereApplicationsPage.css";

const PENDING_STATUSES: CapcarriereDraftStatus[] = ["draft", "needs_user_review"];

function isPending(status: CapcarriereDraftStatus) {
  return PENDING_STATUSES.includes(status);
}

function statusLabel(status: CapcarriereDraftStatus) {
  const labels: Record<CapcarriereDraftStatus, string> = {
    draft: "À valider",
    needs_user_review: "À valider",
    approved_by_user: "Approuvée",
    cancelled: "Refusée",
    blocked: "Bloquée",
    failed: "À revoir",
    sent: "Envoyée",
  };
  return labels[status];
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Non renseignée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non renseignée";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    draft_created: "Dossier créé",
    draft_generated: "Contenu préparé",
    draft_edited: "Dossier mis à jour",
    user_reviewed: "Dossier relu",
    user_approved: "Dossier approuvé",
    user_rejected: "Dossier refusé",
    cancelled: "Dossier annulé",
    blocked: "Dossier bloqué",
  };
  return labels[eventType] ?? eventType;
}

function applicationChannelLabel(value: string | null) {
  if (value === "email_direct_reliable") return "Email direct vérifié";
  if (value === "email_direct") return "Email direct";
  if (value === "external_form") return "Formulaire externe";
  return "Canal à confirmer";
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Une erreur temporaire est survenue.";
  if (error.message.includes("draft_already_reviewed")) return "Ce dossier a déjà été validé.";
  if (error.message.includes("draft_not_found")) return "Ce dossier est introuvable.";
  return "Une erreur temporaire est survenue. Réessaie dans quelques instants.";
}

export default function CapcarriereApplicationsPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const { pushToast } = useToast();
  const userId = session?.user.id ?? null;

  const [drafts, setDrafts] = useState<CapcarriereDraft[]>([]);
  const [events, setEvents] = useState<CapcarriereEvent[]>([]);
  const [eventsDraftId, setEventsDraftId] = useState<string | null>(null);
  const [currentCv, setCurrentCv] = useState<CapcarriereCv | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === draftId) ?? null,
    [draftId, drafts],
  );
  const pendingCount = useMemo(() => drafts.filter((draft) => isPending(draft.status)).length, [drafts]);
  const eventsLoading = Boolean(draftId && eventsDraftId !== draftId);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      const [nextDrafts, nextCv] = await Promise.all([
        fetchCapcarriereDrafts(userId),
        fetchCurrentCapcarriereCv(userId),
      ]);
      setDrafts(nextDrafts);
      setCurrentCv(nextCv);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [load]);

  useEffect(() => {
    let cancelled = false;

    if (!draftId) {
      return;
    }

    void fetchCapcarriereEvents(draftId)
      .then((nextEvents) => {
        if (!cancelled) {
          setEvents(nextEvents);
          setEventsDraftId(draftId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setEventsDraftId(draftId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draftId]);

  async function decide(decision: "approve" | "reject") {
    if (!selectedDraft || !isPending(selectedDraft.status) || acting) return;

    const confirmed = window.confirm(
      decision === "approve"
        ? "Approuver ce dossier ? Cette validation n’enverra aucun email et ne transmettra aucune candidature."
        : "Refuser ce dossier préparé ? Il sera conservé dans l’historique comme refusé.",
    );
    if (!confirmed) return;

    setActing(decision);
    setError(null);

    try {
      await reviewCapcarriereDraft(selectedDraft.id, decision);
      await load();
      const nextEvents = await fetchCapcarriereEvents(selectedDraft.id);
      setEvents(nextEvents);
      setEventsDraftId(selectedDraft.id);
      pushToast({
        kind: "success",
        title: decision === "approve" ? "Dossier approuvé" : "Dossier refusé",
        message:
          decision === "approve"
            ? "Ta décision est enregistrée. Aucun email n’a été envoyé."
            : "Le dossier a été classé comme refusé.",
      });
    } catch (decisionError) {
      const message = getErrorMessage(decisionError);
      setError(message);
      pushToast({ kind: "error", title: "Décision non enregistrée", message });
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="cc-candidate">
      <header className="cc-candidate__hero">
        <div>
          <img src={capcarriereLogo} alt="CapCarrière" className="cc-candidate__logo" />
          <p className="cc-candidate__eyebrow">Espace candidat</p>
          <h1>Mes candidatures préparées</h1>
          <p>Relis chaque dossier préparé par CapCarrière avant de l’approuver ou de le refuser.</p>
        </div>
        <div className="cc-candidate__counter">
          <strong>{pendingCount}</strong>
          <span>en attente de validation</span>
        </div>
      </header>

      <section className="cc-candidate__safety" aria-label="Garanties de sécurité">
        <span>Aucun email envoyé</span>
        <span>Aucune candidature transmise</span>
        <span>Chaque décision est enregistrée</span>
      </section>

      {error && <div className="cc-candidate__error">{error}</div>}

      {loading ? (
        <div className="cc-candidate__state">Chargement des dossiers…</div>
      ) : drafts.length === 0 ? (
        <div className="cc-candidate__state">
          <strong>Aucun dossier préparé pour le moment.</strong>
          <p>Les futures candidatures préparées par CapCarrière apparaîtront ici.</p>
        </div>
      ) : (
        <div className="cc-candidate__layout">
          <aside className="cc-candidate__list" aria-label="Dossiers préparés">
            {drafts.map((draft) => (
              <button
                type="button"
                key={draft.id}
                className={`cc-candidate__listItem${draft.id === draftId ? " is-active" : ""}`}
                onClick={() => navigate(`/capcarriere/applications/${draft.id}`)}
              >
                <span className={`cc-candidate__status cc-candidate__status--${draft.status}`}>
                  {statusLabel(draft.status)}
                </span>
                <strong>{draft.jobs?.title ?? "Candidature préparée"}</strong>
                <span>{draft.jobs?.company_name ?? "Entreprise non renseignée"}</span>
                <small>Préparée le {dateLabel(draft.created_at)}</small>
              </button>
            ))}
          </aside>

          <section className="cc-candidate__detail">
            {!draftId ? (
              <div className="cc-candidate__state cc-candidate__state--inside">
                <strong>Ouvre un dossier pour le relire.</strong>
                <p>Tu verras l’email, la lettre de motivation et le CV associés avant de décider.</p>
              </div>
            ) : !selectedDraft ? (
              <div className="cc-candidate__state cc-candidate__state--inside">
                <strong>Dossier introuvable.</strong>
                <p>Il n’existe pas ou n’appartient pas à ton compte.</p>
              </div>
            ) : (
              <>
                <div className="cc-candidate__detailHeader">
                  <div>
                    <span className={`cc-candidate__status cc-candidate__status--${selectedDraft.status}`}>
                      {statusLabel(selectedDraft.status)}
                    </span>
                    <h2>{selectedDraft.jobs?.title ?? "Candidature préparée"}</h2>
                    <p>
                      {selectedDraft.jobs?.company_name ?? "Entreprise non renseignée"}
                      {selectedDraft.jobs?.location || selectedDraft.jobs?.country
                        ? ` · ${selectedDraft.jobs.location ?? selectedDraft.jobs.country}`
                        : ""}
                    </p>
                  </div>
                  <button type="button" className="cc-candidate__close" onClick={() => navigate("/capcarriere/applications")}>
                    Fermer
                  </button>
                </div>

                <div className="cc-candidate__facts">
                  <div>
                    <span>Destinataire</span>
                    <strong>{selectedDraft.recipient_email ?? "À confirmer"}</strong>
                  </div>
                  <div>
                    <span>Canal</span>
                    <strong>{applicationChannelLabel(selectedDraft.application_channel)}</strong>
                  </div>
                  <div>
                    <span>Date limite</span>
                    <strong>{dateLabel(selectedDraft.jobs?.expires_at)}</strong>
                  </div>
                  <div>
                    <span>Documents</span>
                    <strong>
                      {selectedDraft.cover_letter_required ? "CV + lettre de motivation" : "CV"}
                    </strong>
                  </div>
                </div>

                <article className="cc-candidate__document">
                  <h3>Email d’accompagnement</h3>
                  <div className="cc-candidate__subject">
                    <span>Objet</span>
                    <strong>{selectedDraft.subject ?? "Objet non renseigné"}</strong>
                  </div>
                  <div className="cc-candidate__body">
                    {selectedDraft.email_body?.trim() || "Aucun email d’accompagnement préparé."}
                  </div>
                </article>

                <article className="cc-candidate__document">
                  <h3>Lettre de motivation</h3>
                  <div className="cc-candidate__body">
                    {selectedDraft.cover_letter_body?.trim() || "Aucune lettre de motivation requise pour ce dossier."}
                  </div>
                </article>

                <article className="cc-candidate__cv">
                  <div>
                    <h3>CV associé</h3>
                    <p>
                      {currentCv?.filename ?? "Aucun CV CapCarrière courant n’est associé à ton compte."}
                      {currentCv?.status ? ` · ${currentCv.status}` : ""}
                    </p>
                  </div>
                  {currentCv?.signedUrl ? (
                    <a href={currentCv.signedUrl} target="_blank" rel="noopener noreferrer">
                      Ouvrir le CV ↗
                    </a>
                  ) : (
                    <span>Lien indisponible</span>
                  )}
                </article>

                <article className="cc-candidate__history">
                  <h3>Historique</h3>
                  {eventsLoading ? (
                    <p>Chargement…</p>
                  ) : events.length === 0 ? (
                    <p>Aucun événement enregistré.</p>
                  ) : (
                    <ul>
                      {events.map((event) => (
                        <li key={event.id}>
                          <strong>{eventLabel(event.event_type)}</strong>
                          <time>{dateLabel(event.created_at)}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>

                {isPending(selectedDraft.status) ? (
                  <div className="cc-candidate__decision">
                    <p>
                      Ta décision sera enregistrée, mais ne déclenchera ni email ni transmission de candidature.
                    </p>
                    <div>
                      <button
                        type="button"
                        className="cc-candidate__reject"
                        disabled={acting !== null}
                        onClick={() => void decide("reject")}
                      >
                        {acting === "reject" ? "Enregistrement…" : "Refuser le dossier"}
                      </button>
                      <button
                        type="button"
                        className="cc-candidate__approve"
                        disabled={acting !== null}
                        onClick={() => void decide("approve")}
                      >
                        {acting === "approve" ? "Enregistrement…" : "Approuver le dossier"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="cc-candidate__decision cc-candidate__decision--done">
                    Décision enregistrée : {statusLabel(selectedDraft.status).toLowerCase()}.
                    Aucun email n’a été envoyé.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
