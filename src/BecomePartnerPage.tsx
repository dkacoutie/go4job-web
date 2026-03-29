import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "./components/ToastCenter";
import { useSession } from "./lib/useSession";
import {
  fetchOwnPartnerAccount,
  fetchOwnPartnerProfile,
  submitPartnerApplication,
} from "./lib/partnerApplicationApi";
import type { PartnerAccountRow } from "./lib/adminPartnersApi";
import { PARTNER_PROGRAM_FAQ } from "./lib/partnerProgramContent";
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

const PARTNER_BENEFITS = [
  {
    title: "Un lien et un code personnels",
    body: "Apres activation, vous recevez votre lien personnel et votre code partenaire a partager.",
  },
  {
    title: "Une commission claire",
    body: "Elle s'applique au premier abonnement paye du client recommande.",
  },
  {
    title: "Un espace partenaire immediat",
    body: "Votre compte est cree directement en actif et votre espace devient accessible sans attente.",
  },
];

const INITIAL_FORM: PartnerApplicationFormState = {
  displayName: "",
  contactName: "",
  contactEmail: "",
  applicationMessage: "",
  acceptedTerms: false,
};

const PARTNER_ESSENTIAL_TERMS = [
  "Cette page /devenir-partenaire sert uniquement a rejoindre le programme.",
  "Votre lien personnel et votre code partenaire sont fournis apres activation.",
  "La commission porte sur le premier abonnement paye du client.",
];

const PARTNER_FORM_PLACEHOLDERS = {
  displayName: "Awa Traore Media",
  contactName: "Awa Traore",
  contactEmail: "awa.traore@example.com",
  applicationMessage:
    "Je partage des opportunites emploi et carriere a une audience jeune et active sur Instagram, TikTok et WhatsApp.",
};

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
    return "Connectez-vous d'abord pour finaliser la creation de votre compte partenaire.";
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

function partnerStatusLabel(status: PartnerAccountRow["status"]) {
  if (status === "active") return "Actif";
  if (status === "pending") return "En attente";
  if (status === "paused") return "En pause";
  return "Desactive";
}

function partnerStatusCopy(partner: PartnerAccountRow) {
  if (partner.status === "active") {
    return {
      title: "Votre acces partenaire est deja actif",
      body: "Votre espace partenaire est pret. Vous pouvez y retrouver votre code, votre lien de recommandation et le suivi de votre activite.",
      cta: "Ouvrir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "paused") {
    return {
      title: "Votre compte partenaire est actuellement en pause",
      body: "Le compte existe bien et reste rattache a votre profil, mais l'acces est suspendu tant qu'il n'est pas reouvert par l'equipe.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "inactive") {
    return {
      title: "Votre compte partenaire est desactive",
      body: "Le compte est bien rattache a votre profil, mais il est desactive. Contactez l'equipe si une reactivation doit etre etudiee.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  return {
    title: "Compte partenaire existant",
    body: "Un ancien compte partenaire est deja rattache a votre profil. Contactez l'equipe si vous souhaitez le remettre a niveau dans le cadre actuel du programme.",
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
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

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
          setInfoMsg("Votre brouillon a ete restaure. Vous pouvez maintenant finaliser votre activation partenaire.");
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
      setErrorMsg("Vous devez accepter les conditions partenaires avant de finaliser l'activation.");
      return;
    }

    if (!form.displayName.trim()) {
      setErrorMsg("Le nom du partenaire est requis.");
      return;
    }

    if (!emailIsValid) {
      setErrorMsg("Renseignez une adresse email valide.");
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

      clearDraft();
      setRestoredDraft(false);
      setInfoMsg(null);
      pushToast({
        kind: "success",
        title: "Acces partenaire active",
        message: "Votre espace partenaire est pret.",
      });
      navigate("/me/partner", {
        replace: true,
        state: {
          partnerOnboarding: "activated",
          activatedDisplayName: createdPartner.display_name,
        },
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
          <div className="partnerApply__heroLead">
            <div className="chips partnerApply__heroChips">
              <span className="chip">Sur invitation</span>
              <span className="chip">Premier abonnement paye</span>
            </div>
            <h1 className="partnerApply__heroTitle">
              <span>Rejoignez le programme</span>
              <span>partenaires JobRadar</span>
            </h1>
            <p className="subtitle">
              Le lien /devenir-partenaire sert a rejoindre le programme. Une fois votre acces active, votre espace
              partenaire vous donne votre lien personnel a partager et votre code partenaire.
            </p>
            <div className="partnerApply__heroActions">
              {!partner ? (
                <a className="btn btn--primary partnerApply__heroCta" href="#partner-activation-form">
                  Rejoindre le programme
                </a>
              ) : (
                <Link className="btn btn--primary partnerApply__heroCta" to="/me/partner">
                  Acceder a mon espace partenaire
                </Link>
              )}
            </div>
          </div>
          <div className="partnerApply__heroMeta">
            <div>
              <span>Programme</span>
              <strong>Acces sur invitation</strong>
            </div>
            <div>
              <span>Commission</span>
              <strong>Premier abonnement paye du client</strong>
            </div>
            <div>
              <span>Acces</span>
              <strong>Compte actif et espace immediat</strong>
            </div>
          </div>
        </div>
      </section>

      {!session && (
        <div className="partnerApply__notice partnerApply__notice--info">
          Vous pouvez preparer le formulaire des maintenant. La connexion ou la creation de compte vous sera demandee
          juste avant l'activation finale.
        </div>
      )}

      {infoMsg && !partner && <div className="partnerApply__notice partnerApply__notice--success">{infoMsg}</div>}
      {errorMsg && <div className="partnerApply__notice partnerApply__notice--error">{errorMsg}</div>}

      {partner && existingPartnerCopy ? (
        <section className="partnerApply__state card">
          <span className={statusBadgeClass(partner.status)}>{partnerStatusLabel(partner.status)}</span>
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
              <span>Code de recommandation</span>
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
          </div>
        </section>
      ) : (
        <div className="partnerApply__grid">
          <section className="card partnerApply__formCard" id="partner-activation-form">
            <div className="card__titleRow">
              <h2>Devenir partenaire</h2>
              <span className="badge badge--blue">Lien d'entree officiel</span>
            </div>

            <p className="partnerApply__intro">
              Cette page vous permet uniquement de rejoindre le programme. Votre lien personnel de recommandation et
              votre code partenaire seront ensuite disponibles dans votre espace partenaire. Si vous etes connecte,
              vos informations connues sont pre-remplies. Sinon, les exemples affiches servent uniquement de repere.
            </p>

            <form className="partnerApply__form" onSubmit={handleSubmit}>
              <label className="partnerApply__label">
                Nom du partenaire ou de la structure *
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.displayName}
                  onChange={handleFieldChange("displayName")}
                  placeholder={PARTNER_FORM_PLACEHOLDERS.displayName}
                  autoComplete="organization"
                  required
                />
              </label>

              <label className="partnerApply__label">
                Nom du contact referent
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.contactName}
                  onChange={handleFieldChange("contactName")}
                  placeholder={PARTNER_FORM_PLACEHOLDERS.contactName}
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
                  placeholder={PARTNER_FORM_PLACEHOLDERS.contactEmail}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="partnerApply__label">
                Comment allez-vous recommander JobRadar ?
                <textarea
                  className="partnerApply__input partnerApply__textarea"
                  value={form.applicationMessage}
                  onChange={handleFieldChange("applicationMessage")}
                  placeholder={PARTNER_FORM_PLACEHOLDERS.applicationMessage}
                  rows={4}
                />
              </label>

              <label className="partnerApply__checkbox">
                <input type="checkbox" checked={form.acceptedTerms} onChange={handleFieldChange("acceptedTerms")} />
                <span>
                  J'ai lu et j'accepte les conditions partenaires ci-contre ainsi que les{" "}
                  <Link to="/terms">conditions d'utilisation</Link>.
                </span>
              </label>

              <button
                className="partnerApply__submit"
                type="submit"
                disabled={submitting || (session ? !canFinalize : false)}
              >
                {submitting
                  ? "Activation en cours..."
                  : session
                    ? "Rejoindre le programme partenaire"
                    : "Me connecter pour rejoindre le programme"}
              </button>
            </form>
          </section>

          <aside className="partnerApply__side">
            <section className="card partnerApply__compactCard">
              <div className="card__titleRow">
                <h2>En bref</h2>
                <span className="badge badge--yellow">Essentiel</span>
              </div>

              <div className="partnerApply__compactFacts">
                <div>
                  <span>Statut cree</span>
                  <strong>Actif</strong>
                </div>
                <div>
                  <span>Espace partenaire</span>
                  <strong>Disponible immediatement</strong>
                </div>
              </div>

              <ul className="partnerApply__conditions">
                {PARTNER_ESSENTIAL_TERMS.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ul>

              <p className="partnerApply__footnote">
                Besoin d'un point rapide ?{" "}
                <a href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>Contacter l'equipe</a>
              </p>
            </section>

            <section className="card partnerApply__faqCard" aria-label="Mini FAQ partenaires">
              <div className="card__titleRow">
                <h2>Mini FAQ</h2>
                <span className="badge badge--blue">Clair et rapide</span>
              </div>

              <div className="partnerApply__faqList">
                {PARTNER_PROGRAM_FAQ.map((item, index) => {
                  const isOpen = openFaqIndex === index;
                  const panelId = `partner-faq-panel-${index}`;
                  const buttonId = `partner-faq-button-${index}`;

                  return (
                    <article key={item.question} className={`partnerApply__faqItem${isOpen ? " is-open" : ""}`}>
                      <button
                        id={buttonId}
                        type="button"
                        className="partnerApply__faqTrigger"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => setOpenFaqIndex((prev) => (prev === index ? null : index))}
                      >
                        <span>{item.question}</span>
                        <span className="partnerApply__faqChevron" aria-hidden="true">
                          v
                        </span>
                      </button>

                      <div
                        id={panelId}
                        className="partnerApply__faqPanel"
                        role="region"
                        aria-labelledby={buttonId}
                        hidden={!isOpen}
                      >
                        {item.answers.map((answer) => (
                          <p key={answer}>{answer}</p>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="partnerApply__benefits partnerApply__benefits--side" aria-label="Avantages partenaires">
              {PARTNER_BENEFITS.map((item) => (
                <article key={item.title} className="card partnerApply__benefitCard">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
