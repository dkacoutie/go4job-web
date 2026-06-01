import { useEffect, useMemo, useState } from "react";
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
  if (value === null || value === undefined || value === "") return "Non renseigne";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

function dateOrEmpty(value?: string | null) {
  if (!value) return "Non renseigne";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Non renseigne";
  return d.toLocaleString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDateOrEmpty(value?: string | null) {
  if (!value) return "Non renseigne";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Non renseigne";
  return d.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function metadataPreview(value?: JsonRecord | null) {
  if (!value || Object.keys(value).length === 0) return "Non renseigne";
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 900 ? `${text.slice(0, 900)}...` : text;
  } catch {
    return "Metadata illisible";
  }
}

function Fact({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="adminCcDraft__fact">
      <span>{label}</span>
      <strong>{valueOrEmpty(value)}</strong>
    </div>
  );
}

function BodyBox({ value, emptyLabel }: { value?: string | null; emptyLabel: string }) {
  const text = value?.trim();
  return (
    <div className={`adminCcDraft__bodyBox${text ? "" : " is-empty"}`}>
      {text || emptyLabel}
    </div>
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

  const traceRows = useMemo(() => {
    const draft = data?.draft;
    return [
      ["send_attempt_count", draft?.send_attempt_count ?? 0],
      ["send_provider", draft?.send_provider],
      ["send_provider_message_id", draft?.send_provider_message_id],
      ["send_error", draft?.send_error],
      ["last_send_attempt_at", dateOrEmpty(draft?.last_send_attempt_at)],
      ["user_consent_at", dateOrEmpty(draft?.user_consent_at)],
      ["sent_at", dateOrEmpty(draft?.sent_at)],
      ["cancelled_at", dateOrEmpty(draft?.cancelled_at)],
    ] as const;
  }, [data?.draft]);

  if (loading) {
    return (
      <div className="adminCcDraft">
        <div className="adminCcDraft__empty">Chargement du brouillon CapCarriere...</div>
      </div>
    );
  }

  if (error || !data) {
    const isAccessError = error?.includes("403") || error?.includes("admin") || error?.includes("internal");
    return (
      <div className="adminCcDraft">
        <div className="adminCcDraft__error">
          <strong>{isAccessError ? "Acces refuse" : "Erreur technique"}</strong>
          <p>{error ?? "Brouillon introuvable."}</p>
        </div>
      </div>
    );
  }

  const { draft, job, apply_intel: applyIntel, events } = data;

  return (
    <div className="adminCcDraft">
      <header className="adminCcDraft__hero">
        <div>
          <div className="adminCcDraft__eyebrow">CapCarriere admin</div>
          <h1>Revue brouillon CapCarriere</h1>
          <div className="adminCcDraft__id">draft_id: {draft.id}</div>
        </div>
        <div className="adminCcDraft__badges" aria-label="Garde-fous">
          <span className="adminCcDraft__badge adminCcDraft__badge--warn">Interne uniquement</span>
          <span className="adminCcDraft__badge adminCcDraft__badge--safe">Lecture seule</span>
          <span className="adminCcDraft__badge adminCcDraft__badge--safe">Aucun email emis</span>
          <span className="adminCcDraft__badge adminCcDraft__badge--warn">Validation humaine requise</span>
        </div>
      </header>

      <section className="adminCcDraft__warning" aria-label="Alerte securite CV">
        <strong>CV a corriger avant tout envoi reel.</strong>
        <p>
          Le CV PDF contient une phrase finale orientee "travaux souterrains et infrastructures".
          Aucun envoi reel ne doit etre possible tant que le CV n'est pas corrige.
        </p>
      </section>

      <div className="adminCcDraft__grid">
        <section className="adminCcDraft__section" aria-label="Offre">
          <div className="adminCcDraft__sectionHead">
            <h2>Offre</h2>
          </div>
          <div className="adminCcDraft__facts">
            <Fact label="Titre" value={job?.title} />
            <Fact label="Entreprise" value={job?.company_name} />
            <Fact label="Source" value={job?.source_name} />
            <Fact label="Reference externe" value={job?.external_id} />
            <Fact label="Deadline" value={shortDateOrEmpty(job?.expires_at)} />
            <Fact
              label="Exigences"
              value={`${draft.cv_required ? "CV" : "CV non requis"} + ${
                draft.cover_letter_required ? "lettre de motivation" : "lettre non requise"
              }`}
            />
          </div>
        </section>

        <section className="adminCcDraft__section" aria-label="Candidature">
          <div className="adminCcDraft__sectionHead">
            <h2>Candidature</h2>
          </div>
          <div className="adminCcDraft__facts">
            <Fact label="Destinataire" value={draft.recipient_email} />
            <Fact label="Objet" value={draft.subject} />
            <Fact label="Statut brouillon" value={draft.status} />
            <Fact label="Canal" value={applyIntel?.apply_channel} />
            <Fact label="Niveau automatisation" value={applyIntel?.automation_level} />
          </div>
        </section>
      </div>

      <section className="adminCcDraft__section" aria-label="Contenu du brouillon">
        <div className="adminCcDraft__sectionHead">
          <h2>Contenu du brouillon</h2>
          <span className="adminCcDraft__muted">Sauts de ligne preserves</span>
        </div>
        <div className="adminCcDraft__contentGrid">
          <article>
            <h3>Email</h3>
            <BodyBox value={draft.email_body} emptyLabel="Contenu email vide." />
          </article>
          <article>
            <h3>Lettre de motivation</h3>
            <BodyBox value={draft.cover_letter_body} emptyLabel="Contenu lettre vide." />
          </article>
        </div>
      </section>

      <section className="adminCcDraft__section" aria-label="Tracabilite">
        <div className="adminCcDraft__sectionHead">
          <h2>Tracabilite d'envoi</h2>
          <span className="adminCcDraft__muted">Lecture seule</span>
        </div>
        <div className="adminCcDraft__tableWrap">
          <table className="adminCcDraft__table">
            <thead>
              <tr>
                <th>Champ</th>
                <th>Valeur</th>
              </tr>
            </thead>
            <tbody>
              {traceRows.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{valueOrEmpty(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="adminCcDraft__section" aria-label="Historique audit">
        <div className="adminCcDraft__sectionHead">
          <h2>Historique d'audit</h2>
          <span className="adminCcDraft__muted">{events.length} evenement(s)</span>
        </div>
        {events.length === 0 ? (
          <div className="adminCcDraft__empty">Aucun event d'audit.</div>
        ) : (
          <div className="adminCcDraft__tableWrap">
            <table className="adminCcDraft__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Avant</th>
                  <th>Apres</th>
                  <th>Declenche par</th>
                  <th>Date</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{valueOrEmpty(event.event_type)}</td>
                    <td>{valueOrEmpty(event.from_status)}</td>
                    <td>{valueOrEmpty(event.to_status)}</td>
                    <td>{valueOrEmpty(event.triggered_by)}</td>
                    <td>{dateOrEmpty(event.created_at)}</td>
                    <td>
                      <pre className="adminCcDraft__json">{metadataPreview(event.metadata_json)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
