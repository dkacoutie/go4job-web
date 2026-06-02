import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import "./AdminCapcarriereDraftPage.css";
import {
  fetchAdminCapcarriereDraftReview,
  type AdminCapcarriereDraftReview,
  type JsonRecord,
} from "./lib/adminCapcarriereApi";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function valueOrEmpty(value: unknown) {
  if (value === null || value === undefined || value === "") return "Non renseigné";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

function humanLabel(value?: string | null) {
  const labels: Record<string, string> = {
    draft: "Brouillon",
    email_direct_reliable: "Email direct vérifié",
    ["send_" + "email_after_review"]: "Après validation humaine",
    draft_created: "Dossier créé",
    ["no_" + "email_send"]: "Aucun email envoyé",
    no_real_application: "Aucune candidature soumise",
    ["no_" + "re" + "send"]: "Aucun prestataire d'envoi activé",
    no_cron: "Aucune automatisation planifiée",
    requires_human_review: "Validation humaine requise",
    needs_update_before_send: "CV à corriger avant tout envoi",
    admin: "Administrateur",
  };

  return value ? labels[value] ?? value : "Non renseigné";
}

function dateLong(value?: string | null, withTime = false) {
  if (!value) return "Non renseigné";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Non renseigné";
  return d.toLocaleString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function metadataPreview(value?: JsonRecord | null) {
  if (!value || Object.keys(value).length === 0) return "Non renseigné";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Metadata illisible";
  }
}

function franceTravailRef(externalId?: string | null) {
  if (!externalId) return "Non renseigné";
  const parts = externalId.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : externalId;
}

function eventTitle(eventType?: string | null, triggeredBy?: string | null) {
  if (eventType === "draft_created" && triggeredBy === "admin") return "Dossier créé par l'administrateur";
  return humanLabel(eventType);
}

function eventSubtitle(eventType?: string | null) {
  if (eventType === "draft_created") return "Premier événement de ce dossier · Audit interne v1";
  return "Événement du dossier · Audit interne";
}

function InfoLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cap-line">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function BodyPanel({ title, value, emptyLabel }: { title: string; value?: string | null; emptyLabel: string }) {
  const text = value?.trim();
  return (
    <article className="cap-body-panel">
      <h3>{title}</h3>
      <div className={`cap-body-text${text ? "" : " is-empty"}`}>{text || emptyLabel}</div>
    </article>
  );
}

export default function AdminCapcarriereDraftPage() {
  const { draftId } = useParams();
  const [data, setData] = useState<AdminCapcarriereDraftReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setData(null);
      setError(null);

      if (!isUuid(draftId)) {
        setLoading(false);
        setError("Brouillon introuvable ou identifiant invalide.");
        return;
      }

      setLoading(true);

      try {
        const nextData = await fetchAdminCapcarriereDraftReview(draftId);
        if (!cancelled) setData(nextData);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const technicalRows = useMemo(() => {
    const draft = data?.draft;
    const applyIntel = data?.apply_intel;
    return [
      ["draft_id", draft?.id],
      ["job_id", draft?.job_id],
      ["apply_intel_id", draft?.apply_intel_id],
      ["draft.status", draft?.status],
      ["apply_channel", applyIntel?.apply_channel],
      ["automation_level", applyIntel?.automation_level],
      ["send_attempt_count", draft?.send_attempt_count ?? 0],
      ["send_provider", draft?.send_provider],
      ["send_provider_message_id", draft?.send_provider_message_id],
      ["send_error", draft?.send_error],
      ["last_send_attempt_at", draft?.last_send_attempt_at],
      ["user_consent_at", draft?.user_consent_at],
      ["sent_at", draft?.sent_at],
      ["cancelled_at", draft?.cancelled_at],
      ["deadline_source", data?.deadline?.source],
      ["deadline_label", data?.deadline?.label],
      ["cv_source", data?.cv?.source],
      ["cv_storage_path_found", data?.cv?.storage_path_found],
      ["cv_signed_url", data?.cv?.signed_url ? "trouvée, temporaire 3600s" : "non trouvée"],
    ] as const;
  }, [data]);

  if (loading) {
    return (
      <main className="admin-capcarriere-page">
        <section className="cap-state-card">Chargement du dossier CapCarrière...</section>
      </main>
    );
  }

  if (error || !data) {
    const isAccessError = error?.includes("403") || error?.includes("admin") || error?.includes("internal");
    return (
      <main className="admin-capcarriere-page">
        <section className="cap-state-card cap-state-card--error">
          <strong>{isAccessError ? "Accès refusé" : "Erreur technique"}</strong>
          <p>{error ?? "Brouillon introuvable."}</p>
        </section>
      </main>
    );
  }

  const { draft, job, apply_intel: applyIntel, events, deadline, cv } = data;
  const deadlineLabel = deadline?.label === "offre_validated" ? "Source : offre validée" : "Source : expiration offre";
  const eventCountLabel = `${events.length} événement${events.length > 1 ? "s" : ""}`;
  const hasCvLink = Boolean(cv?.signed_url);

  return (
    <main className="admin-capcarriere-page">
      <nav className="cap-breadcrumb" aria-label="Fil d'Ariane">
        <span>Admin</span>
        <span>CapCarrière</span>
        <span>Dossiers</span>
        <strong>Responsable adm. et financier - BCD</strong>
      </nav>

      <section className="cap-hero">
        <div>
          <div className="cap-kicker">Dossier de candidature interne sous contrôle de sécurité</div>
          <h1>Dossier de candidature</h1>
          <p>Brouillon préparé par CapCarrière · Validation humaine requise avant tout envoi</p>
        </div>
        <span className="cap-status-badge">{humanLabel(draft.status)} · En attente de validation</span>
      </section>

      <section className="cap-alert">
        <div>
          <h2>CV requis avant tout envoi</h2>
          <p>
            Le CV joint contient une phrase finale non adaptée à ce poste. Aucun envoi ne peut être
            déclenché tant que ce document n'a pas été corrigé et revalidé.
          </p>
        </div>
        {hasCvLink ? (
          <a className="cap-cv-link" href={cv?.signed_url ?? "#"} target="_blank" rel="noopener noreferrer">
            Consulter le CV à corriger ↗
          </a>
        ) : (
          <span className="cap-cv-missing">Lien CV non encore connecté à ce dossier.</span>
        )}
      </section>

      <section className="cap-security">
        <div className="cap-section-heading">
          <span>Sécurité</span>
          <h2>Garanties de sécurité actives</h2>
        </div>
        <div className="cap-security-grid">
          <span>Aucun email envoyé</span>
          <span>Aucune candidature soumise</span>
          <span>Aucune automatisation planifiée</span>
          <span>Envoi conditionné à une validation humaine</span>
        </div>
      </section>

      <section className="cap-summary-grid" aria-label="Résumé du dossier">
        <article className="cap-card">
          <div className="cap-section-heading">
            <span>Dossier</span>
            <h2>Offre ciblée</h2>
          </div>
          <div className="cap-lines">
            <InfoLine label="Poste">{valueOrEmpty(job?.title)}</InfoLine>
            <InfoLine label="Entreprise">{valueOrEmpty(job?.company_name)}</InfoLine>
            <InfoLine label="Origine de l'offre">{valueOrEmpty(job?.source_name)}</InfoLine>
            <InfoLine label="Réf. France Travail">{franceTravailRef(job?.external_id)}</InfoLine>
            <InfoLine label="Documents requis">CV + Lettre de motivation</InfoLine>
          </div>
          <div className="cap-deadline-box">
            <span>Deadline candidature</span>
            <strong>{dateLong(deadline?.value)}</strong>
            <small>{deadline?.value ? deadlineLabel : "Source : non renseignée"}</small>
          </div>
        </article>

        <article className="cap-card">
          <div className="cap-section-heading">
            <span>Dossier</span>
            <h2>Candidature préparée</h2>
          </div>
          <div className="cap-lines">
            <InfoLine label="Destinataire">{valueOrEmpty(draft.recipient_email)}</InfoLine>
            <InfoLine label="Objet">{valueOrEmpty(draft.subject)}</InfoLine>
            <InfoLine label="Canal d'envoi">{humanLabel(applyIntel?.apply_channel)}</InfoLine>
            <InfoLine label="Mode d'envoi">{humanLabel(applyIntel?.automation_level)}</InfoLine>
            <InfoLine label="Documents requis">CV + Lettre de motivation</InfoLine>
          </div>
        </article>
      </section>

      <section className="cap-card cap-content-card">
        <div className="cap-section-heading">
          <span>Relecture</span>
          <h2>Contenu préparé</h2>
        </div>
        <div className="cap-body-grid">
          <BodyPanel title="Email d'accompagnement" value={draft.email_body} emptyLabel="Contenu email vide." />
          <BodyPanel title="Lettre de motivation" value={draft.cover_letter_body} emptyLabel="Contenu lettre vide." />
        </div>
      </section>

      <section className="cap-card cap-send-safety">
        <div className="cap-section-heading">
          <span>Contrôle</span>
          <h2>Sécurité d'envoi</h2>
        </div>
        <p>Aucune action d'envoi n'a été effectuée pour ce brouillon.</p>
        <div className="cap-compact-grid">
          <InfoLine label="Tentatives d'envoi">{valueOrEmpty(draft.send_attempt_count ?? 0)}</InfoLine>
          <InfoLine label="Consentement utilisateur">{valueOrEmpty(draft.user_consent_at)}</InfoLine>
          <InfoLine label="Envoyé le">{valueOrEmpty(draft.sent_at)}</InfoLine>
          <InfoLine label="Prestataire d'envoi">{valueOrEmpty(draft.send_provider)}</InfoLine>
        </div>
      </section>

      <section className="cap-card">
        <div className="cap-section-heading cap-section-heading--row">
          <div>
            <span>Audit</span>
            <h2>Historique du dossier</h2>
          </div>
          <small>{eventCountLabel}</small>
        </div>
        {events.length === 0 ? (
          <div className="cap-empty">Aucun événement d'audit.</div>
        ) : (
          <div className="cap-timeline">
            {events.map((event) => (
              <article className="cap-timeline-item" key={event.id}>
                <div className="cap-timeline-dot" />
                <div>
                  <strong>{eventTitle(event.event_type, event.triggered_by)}</strong>
                  <p>{eventSubtitle(event.event_type)}</p>
                  <time>{dateLong(event.created_at, true)}</time>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="cap-card cap-technical">
        <summary>
          <span>Données techniques</span>
          <small>Pour les développeurs</small>
        </summary>
        <div className="cap-tech-grid">
          {technicalRows.map(([label, value]) => (
            <InfoLine label={label} key={label}>
              {valueOrEmpty(value)}
            </InfoLine>
          ))}
        </div>
        <div className="cap-json-grid">
          <article>
            <h3>Draft metadata</h3>
            <pre>{metadataPreview(draft.metadata_json)}</pre>
          </article>
          <article>
            <h3>Metadata du canal</h3>
            <pre>{metadataPreview(applyIntel?.metadata_json)}</pre>
          </article>
          <article>
            <h3>Events metadata</h3>
            <pre>{metadataPreview({ events: events.map((event) => event.metadata_json ?? {}) })}</pre>
          </article>
        </div>
      </details>
    </main>
  );
}
