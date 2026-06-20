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
    body: "Après activation, vous recevez votre lien personnel et votre code partenaire à partager.",
  },
  {
    title: "Une commission claire",
    body: "Elle s'applique au premier pass payé du client recommandé.",
  },
  {
    title: "Un espace partenaire immédiat",
    body: "Votre compte est créé directement en actif et votre espace devient accessible sans attente.",
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
  "Cette page /devenir-partenaire sert uniquement à rejoindre le programme.",
  "Votre lien personnel et votre code partenaire sont fournis après activation.",
  "La commission porte sur le premier pass payé du client.",
];

function normalizePartnerPageCopy(value: string) {
  return value
    .replace("A quoi", "À quoi")
    .replace(" a rejoindre ", " à rejoindre ")
    .replace("Apres", "Après")
    .replace(" acces ", " accès ")
    .replace("acces ", "accès ")
    .replace("acces", "accès")
    .replace(" active", " activé")
    .replace("recoit-on", "reçoit-on")
    .replace(" paye", " payé")
    .replace(" recommande", " recommandé")
    .replace(" a diffuser", " à diffuser")
    .replace("Ou suivre", "Où suivre")
    .replace("attribuees", "attribuées")
    .replace(" a son audience", " à son audience");
}

const PARTNER_PAGE_FAQ = PARTNER_PROGRAM_FAQ.map((item) => ({
  question: normalizePartnerPageCopy(item.question),
  answers: item.answers.map((answer) => normalizePartnerPageCopy(answer)),
}));

const PARTNER_HELP_ITEMS = PARTNER_PAGE_FAQ.slice(0, 2).map((item) => ({
  question: item.question,
  answer: item.answers[0],
}));

const PARTNER_FORM_PLACEHOLDERS = {
  displayName: "Awa Traore Media",
  contactName: "Awa Traore",
  contactEmail: "awa.traore@example.com",
  applicationMessage:
    "Je partage des opportunités emploi et carrière à une audience jeune et active sur Instagram, TikTok et WhatsApp.",
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
    return "Connectez-vous d'abord pour finaliser la création de votre compte partenaire.";
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
  return "Désactivé";
}

function partnerStatusCopy(partner: PartnerAccountRow) {
  if (partner.status === "active") {
    return {
      title: "Votre accès partenaire est déjà actif",
      body: "Votre espace partenaire est prêt. Vous pouvez y retrouver votre code, votre lien de recommandation et le suivi de votre activité.",
      cta: "Ouvrir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "paused") {
    return {
      title: "Votre compte partenaire est actuellement en pause",
      body: "Le compte existe bien et reste rattaché à votre profil, mais l'accès est suspendu tant qu'il n'est pas réouvert par l'équipe.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  if (partner.status === "inactive") {
    return {
      title: "Votre compte partenaire est désactivé",
      body: "Le compte est bien rattaché à votre profil, mais il est désactivé. Contactez l'équipe si une réactivation doit être étudiée.",
      cta: "Voir mon espace partenaire",
      supportOnly: false,
    };
  }

  return {
    title: "Compte partenaire existant",
    body: "Un ancien compte partenaire est déjà rattaché à votre profil. Contactez l'équipe si vous souhaitez le remettre à niveau dans le cadre actuel du programme.",
    cta: "Contacter l'équipe",
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
          setInfoMsg("Votre brouillon a été restauré. Vous pouvez maintenant finaliser votre activation partenaire.");
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
        title: "Accès partenaire activé",
        message: "Votre espace partenaire est prêt.",
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
            <h1 className="partnerApply__heroTitle">
              <span>Rejoignez le programme</span>
              <span>partenaires JobRadar</span>
            </h1>
            <p className="subtitle">
              Recommandez JobRadar à votre audience et gagnez une commission lorsqu’un client recommandé achète son premier pass. Après activation, vous recevez votre lien personnel et votre code partenaire.
            </p>
            <div className="partnerApply__heroActions">
              {!partner ? (
                <a className="btn btn--primary partnerApply__heroCta" href="#partner-activation-form">
                  Rejoindre le programme
                </a>
              ) : (
                <Link className="btn btn--primary partnerApply__heroCta" to="/me/partner">
                  Accéder à mon espace partenaire
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

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
        <div className="partnerApply__content">
          <div className="partnerApply__grid">
            <section className="card partnerApply__formCard partnerApply__formCard--primary" id="partner-activation-form">
              <div className="card__titleRow partnerApply__sectionHeader">
                <div>
                  <h2>Devenir partenaire</h2>
                  <div className="partnerApply__formLead">
                    Présentez simplement votre profil, votre structure ou votre audience. Votre espace partenaire sera créé après activation.
                  </div>
                </div>
                <span className="badge badge--blue">Programme officiel</span>
              </div>

              <p className="partnerApply__intro">
                Cette page permet de rejoindre le programme partenaires JobRadar. Une fois l’accès activé, votre espace partenaire vous donne votre lien personnel, votre code de recommandation et le suivi de votre activité.
              </p>

              {(!session || infoMsg || errorMsg) && (
                <div className="partnerApply__noticeStack">
                  {!session && (
                    <div className="partnerApply__notice partnerApply__notice--info">
                      Vous pouvez préparer le formulaire dès maintenant. La connexion ou la création de compte vous sera
                      demandée juste avant l'activation finale.
                    </div>
                  )}
                  {infoMsg && <div className="partnerApply__notice partnerApply__notice--success">{infoMsg}</div>}
                  {errorMsg && <div className="partnerApply__notice partnerApply__notice--error">{errorMsg}</div>}
                </div>
              )}

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
                  Nom du contact référent
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
                <div className="card__titleRow partnerApply__sectionHeader">
                  <h2>En bref</h2>
                  <span className="badge badge--yellow">Essentiel</span>
                </div>

                <div className="partnerApply__compactFacts">
                  <div>
                    <span>Statut créé</span>
                    <strong>Actif</strong>
                  </div>
                  <div>
                    <span>Espace partenaire</span>
                    <strong>Disponible immédiatement</strong>
                  </div>
                </div>

                <ul className="partnerApply__conditions">
                  {PARTNER_ESSENTIAL_TERMS.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>

                <p className="partnerApply__footnote">
                  Besoin d'un point rapide ?{" "}
                  <a href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>Contacter l'équipe</a>
                </p>
              </section>

              <section className="card partnerApply__helpCard" aria-label="Questions fréquentes partenaires">
                <div className="card__titleRow partnerApply__sectionHeader">
                  <h2>Questions fréquentes</h2>
                  <span className="badge badge--blue">Aide</span>
                </div>

                <div className="partnerApply__helpList">
                  {PARTNER_HELP_ITEMS.map((item) => (
                    <article key={item.question} className="partnerApply__helpItem">
                      <strong>{item.question}</strong>
                      <p>{item.answer}</p>
                    </article>
                  ))}
                </div>

                <a className="partnerApply__helpCta" href="#partner-faq-complete">
                  Voir toutes les réponses
                </a>
              </section>
            </aside>
          </div>

          <section className="partnerApply__benefits partnerApply__benefits--footer" aria-label="Avantages partenaires">
            {PARTNER_BENEFITS.map((item) => (
              <article key={item.title} className="card partnerApply__benefitCard">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </section>

          <section
            className="card partnerApply__faqSection"
            id="partner-faq-complete"
            aria-label="FAQ complète partenaires"
          >
            <div className="card__titleRow partnerApply__sectionHeader">
              <div>
                <h2>FAQ complète</h2>
                <div className="partnerApply__faqLead">
                  Les réponses utiles si vous voulez vérifier le fonctionnement du programme avant de finaliser.
                </div>
              </div>
            </div>

            <div className="partnerApply__faqGrid">
              {PARTNER_PAGE_FAQ.map((item) => (
                <article key={item.question} className="partnerApply__faqEntry">
                  <h3>{item.question}</h3>
                  <div className="partnerApply__faqAnswers">
                    {item.answers.map((answer) => (
                      <p key={answer}>{answer}</p>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <p className="partnerApply__footnote partnerApply__footnote--faq">
              Une question plus spécifique ?{" "}
              <a href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>Contacter l'équipe</a>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
