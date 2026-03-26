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
  "Ce lien est reserve aux profils a qui l'equipe Go4Job choisit d'ouvrir l'entree partenaire.",
  "Une fois le formulaire valide et les conditions acceptees, le compte partenaire est cree directement en statut active.",
  "Le code partenaire et le lien de recommandation sont personnels, non cessibles et ne doivent pas etre utilises de maniere trompeuse.",
  "Seules les ventes eligibles validees selon les regles du programme peuvent ouvrir droit a commission.",
  "Go4Job peut mettre un compte en pause ou le desactiver en cas d'abus, de fraude ou de non-respect des conditions.",
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
    return "Connecte-toi d'abord pour finaliser la creation de ton compte partenaire.";
  }
  if (lower.includes("display_name_required")) {
    return "Le nom du partenaire est requis.";
  }
  if (lower.includes("authenticated_email_required")) {
    return "Un email de compte est requis pour creer le compte partenaire.";
  }
  if (lower.includes("duplicate key") && lower.includes("contact_email")) {
    return "Cette adresse email est deja utilisee par un autre compte partenaire.";
  }

  return "Impossible d'activer le compte partenaire pour le moment.";
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
  if (partner.status === "active") {
    return {
      title: "Ton compte partenaire est deja actif",
      body: "Tu peux acceder directement a ton espace partenaire pour retrouver ton code et suivre ton activite.",
      cta: "Ouvrir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "paused") {
    return {
      title: "Ton compte partenaire est actuellement en pause",
      body: "Le compte existe bien et reste rattache a ton profil, mais l'acces est suspendu tant qu'il n'est pas reouvert par l'equipe.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "inactive") {
    return {
      title: "Ton compte partenaire est desactive",
      body: "Le compte est bien rattache a ton profil, mais il est desactive. Contacte l'equipe si une reactivation doit etre etudiee.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  return {
    title: "Compte partenaire existant",
    body: "Un ancien compte partenaire est deja rattache a ton profil. Contacte l'equipe si tu veux le remettre a niveau dans le cadre actuel du programme.",
    cta: "Contacter l'equipe",
    supportOnly: true,
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
          setInfoMsg("Ton brouillon a ete restaure. Tu peux maintenant activer ton compte partenaire.");
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
      setErrorMsg("Tu dois accepter les conditions partenaires avant de finaliser l'activation.");
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
      setInfoMsg(null);
      pushToast({
        kind: "success",
        title: "Compte partenaire active",
        message: "Ton acces partenaire est maintenant disponible.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible d'activer le compte partenaire.";
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
            <span className="chip">Option B</span>
          </div>
          <h1>Devenir partenaire</h1>
          <p className="subtitle">
            Ce lien permet aux profils invites par notre equipe de creer directement leur compte partenaire. Apres
            acceptation des conditions et connexion, le compte est cree en <strong>active</strong> et l'acces a l'espace
            partenaire est immediat.
          </p>
          <div className="partnerApply__heroMeta">
            <div>
              <span>Statut cree</span>
              <strong>active</strong>
            </div>
            <div>
              <span>Acces</span>
              <strong>Immediat</strong>
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
          Tu peux remplir le formulaire des maintenant. La connexion ou la creation de compte te sera demandee juste
          avant l'activation finale.
        </div>
      )}

      {infoMsg && !partner && <div className="partnerApply__notice partnerApply__notice--success">{infoMsg}</div>}
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
            {existingPartnerCopy.supportOnly ? (
              <a className="btn btn--primary" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
                {existingPartnerCopy.cta}
              </a>
            ) : (
              <Link className="btn btn--primary" to="/me/partner">
                {existingPartnerCopy.cta}
              </Link>
            )}
            <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
              Contacter l'equipe
            </a>
          </div>
        </section>
      ) : (
        <div className="partnerApply__grid">
          <section className="card partnerApply__formCard">
            <div className="card__titleRow">
              <h2>Formulaire d'activation</h2>
              <span className="badge badge--blue">Public</span>
            </div>

            <p className="partnerApply__intro">
              Renseigne les informations de base du compte partenaire. Si tu n'es pas encore connecte, ton brouillon
              sera conserve avant le passage par l'authentification.
            </p>

            <form className="partnerApply__form" onSubmit={handleSubmit}>
              <label className="partnerApply__label">
                Nom du partenaire *
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.displayName}
                  onChange={handleFieldChange("displayName")}
                  placeholder="Ex. Marie Kone ou Studio Growth CI"
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
                  placeholder="Nom de la personne referente"
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
                  placeholder="Decris brievement ton audience, tes canaux ou ton mode de recommandation."
                  rows={6}
                />
              </label>

              <label className="partnerApply__checkbox">
                <input type="checkbox" checked={form.acceptedTerms} onChange={handleFieldChange("acceptedTerms")} />
                <span>
                  J'ai lu et j'accepte les conditions partenaires ci-contre ainsi que les{" "}
                  <Link to="/terms">conditions d'utilisation</Link>. Cette acceptation est obligatoire pour creer le
                  compte partenaire.
                </span>
              </label>

              <button className="partnerApply__submit" type="submit" disabled={submitting || (session ? !canFinalize : false)}>
                {submitting ? "Activation en cours..." : session ? "Activer mon compte partenaire" : "Continuer pour me connecter"}
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
                Ce bloc formalise les regles de base du programme partenaires avant creation immediate du compte.
              </p>

              <div className="partnerApply__contractMeta">
                <div>
                  <span>Version</span>
                  <strong>{PARTNER_TERMS_VERSION}</strong>
                </div>
                <div>
                  <span>Effet</span>
                  <strong>Creation immediate</strong>
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
                <li>Le compte partenaire est cree directement en statut active.</li>
                <li>Il est rattache au compte utilisateur connecte au moment de la finalisation.</li>
                <li>L'espace partenaire devient accessible immediatement.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
