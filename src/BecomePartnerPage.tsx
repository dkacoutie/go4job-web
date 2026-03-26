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

const PARTNER_AUDIENCE = [
  {
    title: "Profils a forte credibilite",
    body: "Consultants, coachs, formateurs, recruteurs, createurs ou medias capables de recommander JobRadar a une audience qualifiee.",
  },
  {
    title: "Communautes et reseaux utiles",
    body: "Structures d'accompagnement, reseaux professionnels, associations, cabinets ou partenaires terrain avec une vraie proximite avec les candidats.",
  },
  {
    title: "Partenaires selectionnes",
    body: "Le programme n'est pas ouvert en inscription publique. L'entree se fait uniquement via un lien d'invitation partage par l'equipe Go4Job.",
  },
];

const PARTNER_VALUE_PROPS = [
  {
    title: "Une offre simple a recommander",
    body: "Vous orientez vos contacts vers JobRadar avec un lien personnel ou un code dedie, sans avoir a gerer un tunnel commercial complexe.",
  },
  {
    title: "Une commission claire",
    body: "La commission porte sur le premier abonnement paye du client recommande. Les renouvellements ne sont pas commissionnes.",
  },
  {
    title: "Un suivi visible",
    body: "Votre espace partenaire centralise votre code, votre lien, vos ventes attribuees, vos commissions et le suivi des paiements.",
  },
];

const PARTNER_RECOMMENDATION_STEPS = [
  {
    step: "1",
    title: "Vous partagez votre lien partenaire",
    body: "Le lien ou le code attribue identifie la recommandation lorsque votre audience decouvre JobRadar.",
  },
  {
    step: "2",
    title: "Le client souscrit a JobRadar",
    body: "L'attribution est prise en compte quand le client recommande paie son premier abonnement eligible.",
  },
  {
    step: "3",
    title: "La vente remonte dans votre espace",
    body: "Vous retrouvez ensuite les conversions et les commissions dans votre dashboard partenaire, avec un traitement de paiement encore manuel pour cette phase MVP.",
  },
];

const INITIAL_FORM: PartnerApplicationFormState = {
  displayName: "",
  contactName: "",
  contactEmail: "",
  applicationMessage: "",
  acceptedTerms: false,
};

const PARTNER_CONDITIONS = [
  "Ce lien d'activation est reserve aux profils invites par l'equipe Go4Job dans le cadre du programme partenaires JobRadar.",
  "Une fois ce formulaire valide et les conditions acceptees, le compte partenaire est cree directement en statut active.",
  "Le lien de recommandation et le code partenaire sont personnels. Ils doivent etre utilises de bonne foi, sans promesse trompeuse ni usurpation.",
  "La commission s'applique uniquement au premier abonnement paye par un client attribue a votre recommandation et valide selon les regles du programme.",
  "Go4Job peut suspendre ou desactiver un compte partenaire en cas d'abus, de fraude ou de non-respect des conditions.",
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
          <div className="chips">
            <span className="chip">Programme partenaires</span>
            <span className="chip">Sur invitation</span>
            <span className="chip">Premier abonnement paye</span>
          </div>
          <h1>Programme partenaires JobRadar</h1>
          <p className="subtitle">
            Un parcours d'entree concu pour les profils capables de recommander JobRadar a une audience qualifiee.
            Ce lien permet uniquement aux partenaires invites par notre equipe d'activer leur acces, d'obtenir leur
            lien de recommandation et de suivre leurs performances dans un espace dedie.
          </p>
          <div className="partnerApply__heroActions">
            {!partner ? (
              <>
                <a className="btn btn--primary" href="#partner-activation-form">
                  Activer mon invitation
                </a>
                <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
                  Contacter l'equipe
                </a>
              </>
            ) : (
              <>
                <Link className="btn btn--primary" to="/me/partner">
                  Ouvrir mon espace partenaire
                </Link>
                <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
                  Contacter l'equipe
                </a>
              </>
            )}
          </div>
          <div className="partnerApply__heroMeta">
            <div>
              <span>Mode d'entree</span>
              <strong>Invitation envoyee par notre equipe</strong>
            </div>
            <div>
              <span>Commission</span>
              <strong>Premier abonnement paye du client</strong>
            </div>
            <div>
              <span>Activation</span>
              <strong>Compte actif et acces immediat</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="partnerApply__invitation card">
        <div>
          <span className="badge badge--blue">Acces reserve</span>
          <h2>Ce programme n'est pas ouvert en inscription publique</h2>
        </div>
        <p>
          Cette page sert a finaliser une invitation deja envoyee par l'equipe Go4Job. Si vous n'avez pas recu ce lien
          dans le cadre d'un echange avec nous, l'entree au programme doit d'abord etre validee par notre equipe.
        </p>
        <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
          Demander une verification
        </a>
      </section>

      <section className="partnerApply__highlights">
        <article className="card partnerApply__highlightCard">
          <div className="card__titleRow">
            <h2>A qui s'adresse le programme</h2>
            <span className="badge badge--blue">Selection</span>
          </div>
          <div className="partnerApply__bulletList">
            {PARTNER_AUDIENCE.map((item) => (
              <div key={item.title} className="partnerApply__bulletItem">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card partnerApply__highlightCard">
          <div className="card__titleRow">
            <h2>Ce que gagne le partenaire</h2>
            <span className="badge badge--green">Business</span>
          </div>
          <div className="partnerApply__bulletList">
            {PARTNER_VALUE_PROPS.map((item) => (
              <div key={item.title} className="partnerApply__bulletItem">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card partnerApply__highlightCard">
          <div className="card__titleRow">
            <h2>Comment fonctionne la recommandation</h2>
            <span className="badge badge--yellow">MVP clair</span>
          </div>
          <div className="partnerApply__journey">
            {PARTNER_RECOMMENDATION_STEPS.map((item) => (
              <div key={item.step} className="partnerApply__journeyStep">
                <span>{item.step}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
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
            <a className="btn" href={`mailto:${PARTNER_SUPPORT_EMAIL}?subject=Programme%20partenaires`}>
              Contacter l'equipe
            </a>
          </div>
        </section>
      ) : (
        <div className="partnerApply__grid">
          <section className="card partnerApply__formCard" id="partner-activation-form">
            <div className="card__titleRow">
              <h2>Activer mon acces partenaire</h2>
              <span className="badge badge--blue">Lien prive</span>
            </div>

            <p className="partnerApply__intro">
              Ce formulaire finalise une invitation deja accordee par notre equipe. Si vous n'etes pas encore
              connecte, votre brouillon sera conserve avant le passage par l'authentification.
            </p>

            <form className="partnerApply__form" onSubmit={handleSubmit}>
              <label className="partnerApply__label">
                Nom du partenaire ou de la structure *
                <input
                  className="partnerApply__input"
                  type="text"
                  value={form.displayName}
                  onChange={handleFieldChange("displayName")}
                  placeholder="Ex. Marie Kone, Cabinet Horizon RH ou Studio Growth CI"
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
                  placeholder="Nom de la personne qui portera la relation partenaire"
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
                Comment allez-vous recommander JobRadar ?
                <textarea
                  className="partnerApply__input partnerApply__textarea"
                  value={form.applicationMessage}
                  onChange={handleFieldChange("applicationMessage")}
                  placeholder="Decrivez brievement votre audience, vos canaux, votre positionnement et la facon dont vous comptez recommander JobRadar."
                  rows={6}
                />
              </label>

              <label className="partnerApply__checkbox">
                <input type="checkbox" checked={form.acceptedTerms} onChange={handleFieldChange("acceptedTerms")} />
                <span>
                  J'ai lu et j'accepte les conditions partenaires ci-contre ainsi que les{" "}
                  <Link to="/terms">conditions d'utilisation</Link>. Cette validation est obligatoire pour activer
                  l'acces partenaire.
                </span>
              </label>

              <button
                className="partnerApply__submit"
                type="submit"
                disabled={submitting || (session ? !canFinalize : false)}
              >
                {submitting ? "Activation en cours..." : session ? "Activer mon compte partenaire" : "Continuer pour me connecter"}
              </button>
            </form>
          </section>

          <aside className="partnerApply__side">
            <section className="card partnerApply__contractCard">
              <div className="card__titleRow">
                <h2>Conditions d'entree au programme</h2>
                <span className="badge badge--yellow">Acceptation requise</span>
              </div>

              <p className="partnerApply__contractLead">
                Ces points encadrent l'activation de votre acces et clarifient les regles MVP du programme partenaires.
              </p>

              <div className="partnerApply__contractMeta">
                <div>
                  <span>Version</span>
                  <strong>{PARTNER_TERMS_VERSION}</strong>
                </div>
                <div>
                  <span>Effet</span>
                  <strong>Activation immediate si validation</strong>
                </div>
              </div>

              <ol className="partnerApply__conditions">
                {PARTNER_CONDITIONS.map((condition) => (
                  <li key={condition}>{condition}</li>
                ))}
              </ol>
            </section>

            <section className="card partnerApply__nextSteps">
              <h3>Apres activation</h3>
              <ul>
                <li>Le compte partenaire est cree directement en statut actif.</li>
                <li>Il est rattache au compte utilisateur connecte au moment de la finalisation.</li>
                <li>Vous arrivez ensuite dans votre espace partenaire pour recuperer votre lien et votre code.</li>
                <li>Les conversions et commissions y seront visibles des les premieres ventes attribuees.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
