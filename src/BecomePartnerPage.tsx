import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "./components/ToastCenter";
import { useSession } from "./lib/useSession";
import { fetchOwnPartnerAccount, fetchOwnPartnerProfile, submitPartnerApplication } from "./lib/partnerApplicationApi";
import type { PartnerAccountRow } from "./lib/adminPartnersApi";
import "./BecomePartnerPage.css";

type PartnerApplicationFormState = {
  displayName: string;
  contactName: string;
  contactEmail: string;
  applicationMessage: string;
  acceptedTerms: boolean;
};

const PARTNER_APPLICATION_DRAFT_KEY = "go4job_partner_application_draft_v1";
const PARTNER_TERMS_VERSION = "partner_terms_v1_2026_03_26";
const PARTNER_SUPPORT_EMAIL = "contact@go4jobapp.com";

const INITIAL_FORM: PartnerApplicationFormState = {
  displayName: "",
  contactName: "",
  contactEmail: "",
  applicationMessage: "",
  acceptedTerms: false,
};

const PARTNER_CONDITIONS = [
  "Toute demande entre d'abord en statut pending et fait l'objet d'une validation manuelle par l'équipe Go4Job.",
  "Aucune commission n'est due tant que le compte partenaire n'a pas été activé explicitement.",
  "Le code partenaire et le lien de recommandation sont personnels, non cessibles et ne doivent pas être utilisés de manière trompeuse.",
  "Seules les ventes éligibles validées selon les règles du programme peuvent ouvrir droit à commission.",
  "Go4Job peut suspendre ou refuser un compte partenaire en cas d'abus, de fraude ou de non-respect des conditions.",
];

function readDraft(): PartnerApplicationFormState | null {
  try {
    const raw = localStorage.getItem(PARTNER_APPLICATION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PartnerApplicationFormState>;
    return {
      ...INITIAL_FORM,
      ...parsed,
      acceptedTerms: Boolean(parsed.acceptedTerms),
    };
  } catch {
    return null;
  }
}

function writeDraft(form: PartnerApplicationFormState) {
  try {
    localStorage.setItem(PARTNER_APPLICATION_DRAFT_KEY, JSON.stringify(form));
  } catch {
    // ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(PARTNER_APPLICATION_DRAFT_KEY);
  } catch {
    // ignore
  }
}

function mapPartnerApplicationError(message: string) {
  const lower = (message || "").toLowerCase();

  if (lower.includes("not_authenticated")) {
    return "Connecte-toi d'abord pour finaliser la création de ton compte partenaire.";
  }
  if (lower.includes("display_name_required")) {
    return "Le nom du partenaire est requis.";
  }
  if (lower.includes("authenticated_email_required")) {
    return "Un email de compte est requis pour créer le compte partenaire.";
  }
  if (lower.includes("duplicate key") && lower.includes("contact_email")) {
    return "Cette adresse email est déjà utilisée par un autre compte partenaire.";
  }

  return "Impossible d'envoyer la demande partenaire pour le moment.";
}

function isValidEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value.trim());
}

function statusBadgeClass(status: PartnerAccountRow["status"]) {
  if (status === "active") return "badge badge--green";
  if (status === "pending") return "badge badge--yellow";
  if (status === "paused") return "badge badge--gray";
  return "badge badge--red";
}

function partnerStatusCopy(partner: PartnerAccountRow) {
  if (partner.status === "pending") {
    return {
      title: "Demande déjà enregistrée",
      body:
        "Ton compte partenaire est déjà créé et rattaché à ton profil. Il reste en attente de validation par l'équipe avant activation.",
      cta: "Voir mon espace partenaire",
    };
  }

  if (partner.status === "active") {
    return {
      title: "Ton compte partenaire est déjà actif",
      body:
        "Tu peux accéder directement à ton espace partenaire pour retrouver ton code et suivre l'état du programme.",
      cta: "Ouvrir mon espace partenaire",
    };
  }

  if (partner.status === "paused") {
    return {
      title: "Ton compte partenaire est actuellement en pause",
      body:
        "Le compte existe bien et reste rattaché à ton profil. Si besoin, contacte l'équipe pour faire le point sur la reprise.",
      cta: "Voir mon espace partenaire",
    };
  }

  return {
    title: "Ton compte partenaire existe déjà",
    body:
      "Le compte est bien rattaché à ton profil, mais il n'est pas actif pour le moment. L'équipe peut t'indiquer la suite.",
    cta: "Voir mon espace partenaire",
  };
}

export default function BecomePartnerPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const { pushToast } = useToast();

  const [form, setForm] = useState<PartnerApplicationFormState>(() => readDraft() ?? INITIAL_FORM);
  const [partner, setPartner] = useState<PartnerAccountRow | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(() => Boolean(readDraft()));

  useEffect(() => {
    writeDraft(form);
  }, [form]);

  useEffect(() => {
    if (loading) return;

    if (!session?.user?.id) {
      setPartner(null);
      setPageLoading(false);
      return;
    }

    let cancelled = false;

    const loadContext = async () => {
      setPageLoading(true);
      setErrorMsg(null);

      try {
        const [partnerRow, profile] = await Promise.all([
          fetchOwnPartnerAccount(session.user.id),
          fetchOwnPartnerProfile(session.user.id),
        ]);

        if (cancelled) return;

        setPartner(partnerRow);
        setForm((prev) => ({
          ...prev,
          displayName: prev.displayName.trim() || profile?.full_name?.trim() || "",
          contactName: prev.contactName.trim() || profile?.full_name?.trim() || "",
          contactEmail: prev.contactEmail.trim() || session.user.email || "",
        }));

        if (restoredDraft && !partnerRow) {
          setInfoMsg("Ton brouillon a été restauré. Tu peux maintenant finaliser ta demande partenaire.");
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Impossible de charger le formulaire partenaire.";
        setErrorMsg(message);
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    };

    void loadContext();

    return () => {
      cancelled = true;
    };
  }, [loading, restoredDraft, session?.user?.email, session?.user?.id]);

  const emailIsValid = useMemo(() => isValidEmail(form.contactEmail), [form.contactEmail]);
  const canFinalize = useMemo(() => {
    return (
      form.displayName.trim().length > 1 &&
      form.contactEmail.trim().length > 3 &&
      emailIsValid &&
      form.acceptedTerms
    );
  }, [emailIsValid, form.acceptedTerms, form.contactEmail, form.displayName]);

  const handleFieldChange =
    (field: keyof PartnerApplicationFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrorMsg(null);
      setInfoMsg(null);
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!form.acceptedTerms) {
      setErrorMsg("Tu dois accepter les conditions partenaires avant de finaliser la demande.");
      return;
    }

    if (!form.displayName.trim()) {
      setErrorMsg("Le nom du partenaire est requis.");
      return;
    }

    if (!emailIsValid) {
      setErrorMsg("Renseigne une adresse email valide.");
      return;
    }

    if (!session) {
      writeDraft(form);
      setRestoredDraft(true);
      navigate("/auth", { state: { from: "/devenir-partenaire" } });
      return;
    }

    setSubmitting(true);

    try {
      const createdPartner = await submitPartnerApplication({
        displayName: form.displayName.trim(),
        contactName: form.contactName.trim() || null,
        contactEmail: form.contactEmail.trim(),
        applicationMessage: form.applicationMessage.trim() || null,
        termsVersion: PARTNER_TERMS_VERSION,
      });

      setPartner(createdPartner);
      clearDraft();
      setRestoredDraft(false);
      setInfoMsg("La demande partenaire a bien été envoyée. Le compte est maintenant en attente de validation.");
      pushToast({
        kind: "success",
        title: "Demande envoyée",
        message: "Ton compte partenaire a été créé en statut pending.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible d'envoyer la demande partenaire.";
      setErrorMsg(mapPartnerApplicationError(message));
    } finally {
      setSubmitting(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="partnerApply">
        <section className="partnerApply__state card">
          <h1>Devenir partenaire</h1>
          <p className="subtitle">Chargement du parcours partenaire...</p>
        </section>
      </div>
    );
  }

  const existingPartnerCopy = partner ? partnerStatusCopy(partner) : null;

  return (
    <div className="partnerApply">
      <section className="partnerApply__hero">
        <div className="partnerApply__heroBody">
          <div className="chips">
            <span className="chip">Programme partenaires</span>
            <span className="chip">Étape 1</span>
          </div>
          <h1>Devenir partenaire</h1>
          <p className="subtitle">
            Dépose ta demande partenaire depuis cette page publique. Le compte sera créé en statut <strong>pending</strong>,
            rattaché à ton compte utilisateur, puis validé manuellement par l'équipe.
          </p>
          <div className="partnerApply__heroMeta">
            <div>
              <span>Statut initial</span>
              <strong>pending</strong>
            </div>
            <div>
              <span>Finalisation</span>
              <strong>Connexion requise</strong>
            </div>
            <div>
              <span>Support</span>
              <strong>{PARTNER_SUPPORT_EMAIL}</strong>
            </div>
          </div>
        </div>
      </section>

      {!session && (
        <div className="partnerApply__notice partnerApply__notice--info">
          Tu peux remplir le formulaire dès maintenant. La connexion ou la création de compte te sera demandée juste
          avant la finalisation.
        </div>
      )}

      {infoMsg && <div className="partnerApply__notice partnerApply__notice--success">{infoMsg}</div>}
      {errorMsg && <div className="partnerApply__notice partnerApply__notice--error">{errorMsg}</div>}

      {partner && existingPartnerCopy ? (
        <section className="partnerApply__state card">
          <span className={statusBadgeClass(partner.status)}>{partner.status}</span>
          <h2>{existingPartnerCopy.title}</h2>
          <p className="subtitle">{existingPartnerCopy.body}</p>

          <div className="partnerApply__summary">
            <div>
              <span>Nom partenaire</span>
              <strong>{partner.display_name}</strong>
            </div>
            <div>
              <span>Email contact</span>
              <strong>{partner.contact_email ?? session?.user?.email ?? "-"}</strong>
            </div>
            <div>
              <span>Code partenaire</span>
              <strong className="mono">{partner.referral_code}</strong>
            </div>
          </div>

          <div className="partnerApply__stateActions">
            <Link className="btn btn--primary" to="/me/partner">
              {existingPartnerCopy.cta}
            </Link>
            <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
              Contacter l'équipe
            </a>
          </div>
        </section>
      ) : (
        <div className="partnerApply__grid">
          <section className="card partnerApply__formCard">
            <div className="card__titleRow">
              <h2>Formulaire de demande</h2>
              <span className="badge badge--blue">Public</span>
            </div>

            <p className="partnerApply__intro">
              Renseigne les informations de base du compte partenaire. Si tu n'es pas encore connecté, ton brouillon
              sera conservé avant le passage par l'authentification.
            </p>

            <form className="partnerApply__form" onSubmit={handleSubmit}>
              <label className="partnerApply__label">
                Nom du partenaire *
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.displayName}
                  onChange={handleFieldChange("displayName")}
                  placeholder="Ex. Marie Koné ou Studio Growth CI"
                  autoComplete="organization"
                  required
                />
              </label>

              <label className="partnerApply__label">
                Nom du contact
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.contactName}
                  onChange={handleFieldChange("contactName")}
                  placeholder="Nom de la personne référente"
                  autoComplete="name"
                />
              </label>

              <label className="partnerApply__label">
                Email de contact *
                <input
                  className={`partnerApply__input${form.contactEmail && !emailIsValid ? " is-error" : ""}`}
                  type="email"
                  value={form.contactEmail}
                  onChange={handleFieldChange("contactEmail")}
                  placeholder="contact@exemple.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="partnerApply__label">
                Comment comptes-tu recommander JobRadar ?
                <textarea
                  className="partnerApply__input partnerApply__textarea"
                  value={form.applicationMessage}
                  onChange={handleFieldChange("applicationMessage")}
                  placeholder="Décris brièvement ton audience, tes canaux ou ton mode de recommandation."
                  rows={6}
                />
              </label>

              <label className="partnerApply__checkbox">
                <input type="checkbox" checked={form.acceptedTerms} onChange={handleFieldChange("acceptedTerms")} />
                <span>
                  J'ai lu et j'accepte les conditions partenaires ci-contre ainsi que les{" "}
                  <Link to="/terms">conditions d'utilisation</Link>. Cette acceptation est obligatoire pour créer le
                  compte partenaire.
                </span>
              </label>

              <button className="partnerApply__submit" type="submit" disabled={submitting || (session ? !canFinalize : false)}>
                {submitting
                  ? "Envoi en cours..."
                  : session
                  ? "Créer mon compte partenaire"
                  : "Continuer pour me connecter"}
              </button>
            </form>
          </section>

          <aside className="partnerApply__side">
            <section className="card partnerApply__contractCard">
              <div className="card__titleRow">
                <h2>Contrat / conditions partenaires</h2>
                <span className="badge badge--yellow">Acceptation requise</span>
              </div>

              <p className="partnerApply__contractLead">
                Ce bloc sert de cadre contractuel pour l'étape 1. Il formalise les règles de base avant toute
                activation du programme partenaires.
              </p>

              <div className="partnerApply__contractMeta">
                <div>
                  <span>Version</span>
                  <strong>{PARTNER_TERMS_VERSION}</strong>
                </div>
                <div>
                  <span>Validation</span>
                  <strong>Manuelle</strong>
                </div>
              </div>

              <ol className="partnerApply__conditions">
                {PARTNER_CONDITIONS.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ol>
            </section>

            <section className="card partnerApply__nextSteps">
              <h3>Ce qui se passe ensuite</h3>
              <ul>
                <li>Le compte partenaire est créé en statut pending.</li>
                <li>Il est rattaché au compte utilisateur connecté au moment de la finalisation.</li>
                <li>L'équipe vérifie la demande avant activation.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
