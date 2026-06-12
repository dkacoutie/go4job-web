import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import capCarriereLogo from "./assets/capcarriere-logo.png";
import { supabase } from "./lib/supabaseClient";
import { trackMetaCustomEvent, trackMetaEvent, trackMetaPageView } from "./lib/metaPixel";
import "./CvAtsLandingPage.css";

type LeadResponse = {
  ok?: boolean;
  lead_id?: string | null;
  already_exists?: boolean;
  email_sent?: boolean;
  error?: string;
  message?: string;
};

type LeadFormState = {
  first_name: string;
  email: string;
};

type IconName = "eye" | "list" | "target" | "check";

const INITIAL_FORM: LeadFormState = {
  first_name: "",
  email: "",
};

const GUIDE_CONTENT_NAME = "capcarriere_cv_ats_guide";
const JOBRADAR_FEED_PATH = "/jobradar/feed";

const HERO_BULLETS: Array<{ icon: IconName; text: string }> = [
  {
    icon: "eye",
    text: "Ce qui rend votre CV difficile à lire — et comment y remédier",
  },
  {
    icon: "list",
    text: "Une structure claire, applicable sans tout réécrire",
  },
  {
    icon: "target",
    text: "Un format lisible par les recruteurs et les outils de tri automatique",
  },
];

const VALUE_CARDS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: "eye",
    title: "Lisibilité",
    text: "Repérez ce qui rend votre CV difficile à parcourir.",
  },
  {
    icon: "list",
    title: "Structure",
    text: "Présentez vos expériences dans l'ordre qui convainc.",
  },
  {
    icon: "target",
    title: "Adaptation",
    text: "Ajustez votre CV à une offre précise sans tout réécrire.",
  },
  {
    icon: "check",
    title: "Checklist finale",
    text: "Vérifiez les points essentiels avant d'envoyer votre prochaine candidature.",
  },
];

const GUIDE_CARDS = [
  {
    title: "Comment un CV est lu",
    text: "Comprenez comment un recruteur et un logiciel de tri parcourent votre document.",
  },
  {
    title: "Erreurs de structure",
    text: "Identifiez les erreurs les plus fréquentes qui nuisent à la lisibilité.",
  },
  {
    title: "Présenter vos expériences",
    text: "Mettez en valeur ce qui compte vraiment pour un recruteur.",
  },
  {
    title: "Adapter à une offre",
    text: "Apprenez à ajuster votre CV à une offre précise, sans tout réécrire.",
  },
];

const PROBLEM_ITEMS = [
  "Mise en page illisible",
  "Structure confuse",
  "Compétences difficiles à repérer",
  "CV peu adapté à l'offre",
];

const FAQ_ITEMS = [
  {
    question: "Le guide est-il vraiment gratuit ?",
    answer:
      "Oui, totalement. Vous entrez votre prénom et votre adresse email, et vous recevez le guide immédiatement. Aucune carte bancaire n'est demandée.",
  },
  {
    question: "À qui s'adresse ce guide ?",
    answer:
      "À toute personne qui cherche un emploi, prépare une candidature ou souhaite améliorer la présentation de son parcours — que vous soyez en recherche active, jeune diplômé, en reconversion ou simplement en veille.",
  },
  {
    question: "Est-ce que ce guide garantit un emploi ?",
    answer:
      "Non. Ce guide vous aide à améliorer la lisibilité et la structure de votre CV. Il ne garantit pas de résultats et ne remplace pas votre effort personnel ni les autres étapes d'une candidature réussie.",
  },
  {
    question: "Vais-je recevoir d'autres emails ?",
    answer:
      "Vous pourrez recevoir ponctuellement des conseils liés à votre recherche d'emploi. Vous pouvez vous désinscrire à tout moment en un clic depuis n'importe quel email.",
  },
  {
    question: "C'est quoi JobRadar ?",
    answer:
      "JobRadar est un outil de veille emploi qui fait partie de l'écosystème Go4Job. Il vous aide à suivre les offres qui correspondent à votre profil en Côte d'Ivoire et en France.",
  },
];

function isEmailValid(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function collectAttribution() {
  const params = new URLSearchParams(window.location.search);

  return {
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_content: params.get("utm_content"),
    utm_term: params.get("utm_term"),
    referrer: document.referrer || null,
    user_agent: navigator.userAgent || null,
    meta_fbp: getCookie("_fbp"),
    meta_fbc: getCookie("_fbc"),
  };
}

function mapLeadError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("first_name")) return "Indiquez votre prénom pour recevoir le guide.";
  if (lower.includes("email")) return "Vérifiez votre adresse email.";
  if (lower.includes("rate")) return "Trop de demandes. Réessayez dans un instant.";
  return "Impossible d'envoyer votre demande pour le moment. Réessayez dans quelques instants.";
}

function LogoMark() {
  return (
    <div className="cvats-brand" aria-label="CapCarrière par Go4Job">
      <img className="cvats-brand__logo" src={capCarriereLogo} alt="CapCarrière" />
      <span className="cvats-brand__fallback">CapCarrière</span>
      <span className="cvats-brand__by">par Go4Job</span>
    </div>
  );
}

function SvgIcon({ name, className = "" }: { name: IconName; className?: string }) {
  if (name === "eye") {
    return (
      <svg className={className} width="16" height="16" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" />
        <circle cx="7" cy="7" r="2" />
      </svg>
    );
  }

  if (name === "list") {
    return (
      <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4h1.5" />
        <path d="M7 4h6" />
        <path d="M3 8h1.5" />
        <path d="M7 8h6" />
        <path d="M3 12h1.5" />
        <path d="M7 12h6" />
      </svg>
    );
  }

  if (name === "target") {
    return (
      <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="3" />
        <circle cx="8" cy="8" r="1" />
      </svg>
    );
  }

  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.3 6.2 11.5 13 4.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="faq-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function GuideMockup() {
  return (
    <div className="cvats-pdfMockup" aria-hidden="true">
      <div className="cvats-pdfMockup__card">
        <span className="cvats-pdfMockup__badge">Guide CapCarrière</span>
        <strong className="cvats-pdfMockup__title">Votre CV mérite d'être lu</strong>
        <hr />
        <div className="cvats-pdfMockup__block cvats-pdfMockup__block--before">
          <span>Avant</span>
          <i />
          <i />
          <i />
        </div>
        <div className="cvats-pdfMockup__block cvats-pdfMockup__block--after">
          <span>Après</span>
          <i />
          <i />
          <i />
        </div>
        <small>capcarriere.go4job.com</small>
      </div>
    </div>
  );
}

export default function CvAtsLandingPage() {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [form, setForm] = useState<LeadFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedEmail = form.email.trim();
  const trimmedFirstName = form.first_name.trim();
  useEffect(() => {
    trackMetaPageView(window.location.pathname, window.location.search);
    trackMetaEvent("ViewContent", { content_name: GUIDE_CONTENT_NAME });
  }, []);

  const validate = () => {
    const nextErrors: Partial<Record<keyof LeadFormState, string>> = {};
    if (!trimmedFirstName) nextErrors.first_name = "Prénom requis.";
    if (!trimmedEmail) {
      nextErrors.email = "Email requis.";
    } else if (!isEmailValid(trimmedEmail)) {
      nextErrors.email = "Email invalide.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (!validate()) return;
    setSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke<LeadResponse>("submit-cv-ats-lead", {
        body: {
          first_name: trimmedFirstName,
          email: trimmedEmail,
          ...collectAttribution(),
        },
      });

      if (error) {
        let message = error.message || "server_error";
        const maybeError = error as { context?: unknown };
        if (maybeError.context instanceof Response) {
          const text = await maybeError.context.text();
          if (text) {
            try {
              const parsed = JSON.parse(text) as LeadResponse;
              message = parsed.message || parsed.error || message;
            } catch {
              message = text;
            }
          }
        }
        throw new Error(mapLeadError(message));
      }

      if (!data?.ok || !data.lead_id) {
        throw new Error(mapLeadError(data?.message || data?.error || "capture_failed"));
      }

      sessionStorage.setItem("cv_ats_lead_id", data.lead_id);
      trackMetaEvent("Lead", {
        content_name: GUIDE_CONTENT_NAME,
        email_sent: Boolean(data.email_sent),
        already_exists: Boolean(data.already_exists),
      });
      navigate("/cv-ats/merci");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Impossible d'envoyer votre demande pour le moment.");
    } finally {
      setSubmitting(false);
    }
  };

  const focusForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = formRef.current?.querySelector<HTMLInputElement>("input[name='first_name']");
    window.setTimeout(() => input?.focus(), 360);
    trackMetaCustomEvent("CVATSFinalCtaClick", { content_name: GUIDE_CONTENT_NAME });
  };

  return (
    <div className="cvats-page">
      <header className="cvats-header">
        <LogoMark />
        <nav className="cvats-header__nav" aria-label="Navigation CapCarrière">
          <a href="#cvats-guide-form">Recevoir le guide</a>
        </nav>
      </header>

      <main>
        <section className="cvats-hero" aria-labelledby="cvats-title">
          <div className="cvats-hero__copy">
            <div className="cvats-eyebrow">Guide PDF gratuit · Reçu immédiatement par email</div>
            <h1 id="cvats-title">
              Votre CV mérite <em>d'être lu</em>
            </h1>
            <p className="cvats-hero__subtitle">
              Un guide gratuit pour repérer en quelques minutes ce qui freine la lecture de votre CV — et corriger
              l'essentiel avant votre prochaine candidature.
            </p>
            <ul className="cvats-checklist" aria-label="Ce que le guide vous aide à faire">
              {HERO_BULLETS.map((item) => (
                <li key={item.text}>
                  <SvgIcon name={item.icon} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <div className="cvats-hero__actions">
              <a className="cvats-primaryBtn" href="#cvats-guide-form">
                Recevoir mon guide gratuit →
              </a>
              <span>PDF envoyé immédiatement · Gratuit · Désinscription en un clic</span>
            </div>
          </div>

          <div className="cvats-hero__conversion">
            <GuideMockup />

            <form id="cvats-guide-form" ref={formRef} className="cvats-form" onSubmit={handleSubmit} noValidate>
              <div className="cvats-form__badge">Envoi immédiat · Sans carte bancaire</div>
              <h2>Recevez votre guide en moins de 2 minutes</h2>
              <label>
                Prénom
                <input
                  className={errors.first_name ? "is-error" : ""}
                  type="text"
                  name="first_name"
                  autoComplete="given-name"
                  placeholder="Votre prénom"
                  value={form.first_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))}
                  aria-invalid={Boolean(errors.first_name)}
                />
                {errors.first_name && <span className="cvats-field-error">{errors.first_name}</span>}
              </label>
              <label>
                Email
                <input
                  className={errors.email ? "is-error" : ""}
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="votre@email.com"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && <span className="cvats-field-error">{errors.email}</span>}
              </label>
              <button className="cvats-primaryBtn" type="submit" disabled={submitting}>
                {submitting ? "Envoi en cours..." : "Recevoir mon guide gratuit →"}
              </button>
              <p className="cvats-microcopy">Votre adresse sert uniquement à l'envoi du guide.</p>
              {serverError && (
                <div className="cvats-errorBox" role="status">
                  {serverError}
                </div>
              )}
            </form>
          </div>
        </section>

        <section className="cvats-section cvats-value" aria-labelledby="cvats-value-title">
          <div className="cvats-section__header">
            <span className="cvats-section__eyebrow">Ce que vous allez corriger</span>
            <h2 id="cvats-value-title">Repérez ce qui bloque — et corrigez l'essentiel</h2>
            <p>
              Le guide vous aide à identifier ce qui freine la lecture de votre CV, humaine ou automatisée, et à
              corriger les points clés.
            </p>
          </div>
          <div className="cvats-value__grid">
            {VALUE_CARDS.map((card) => (
              <article className="cvats-valueCard" key={card.title}>
                <div className="cvats-valueCard__icon">
                  <SvgIcon name={card.icon} />
                </div>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="cvats-section cvats-problem" aria-labelledby="cvats-problem-title">
          <div className="cvats-problem__copy">
            <span className="cvats-section__eyebrow">Le vrai problème</span>
            <h2 id="cvats-problem-title">Le problème n'est pas toujours votre parcours</h2>
            <p>
              Vous avez peut-être les compétences et la motivation. Mais si votre CV est difficile à lire ou mal
              structuré, un recruteur — humain ou automatisé — peut passer à côté de votre profil avant même d'avoir
              compris votre valeur.
            </p>
            <blockquote>
              Des candidatures envoyées, peu de réponses — et parfois une vraie valeur qui reste invisible.
            </blockquote>
          </div>
          <aside className="cvats-problemCard" aria-label="Ce qui bloque souvent la lecture d'un CV">
            <h3>Ce qui bloque souvent la lecture d'un CV</h3>
            <ul>
              {PROBLEM_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </section>

        <section className="cvats-section cvats-guideContent" aria-labelledby="cvats-guide-content-title">
          <div className="cvats-section__header">
            <span className="cvats-section__eyebrow">Dans le guide</span>
            <h2 id="cvats-guide-content-title">Ce que vous trouverez à l'intérieur</h2>
          </div>
          <div className="cvats-guide-grid">
            {GUIDE_CARDS.map((card) => (
              <article key={card.title}>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="cvats-section cvats-ecosystem" aria-labelledby="cvats-ecosystem-title">
          <div className="cvats-ecosystem__copy">
            <h2 id="cvats-ecosystem-title">
              CapCarrière prépare votre profil. JobRadar vous aide à trouver les bonnes offres.
            </h2>
            <p>
              CapCarrière fait partie de l'écosystème Go4Job. Ce guide vous aide à mieux présenter votre profil.
              JobRadar vous aide ensuite à repérer les opportunités qui correspondent à votre recherche.
            </p>
          </div>
          <aside className="cvats-jobradarCard">
            <h3>JobRadar</h3>
            <p>Alertes emploi personnalisées · Côte d'Ivoire & France</p>
            <a href={JOBRADAR_FEED_PATH}>Découvrir JobRadar →</a>
          </aside>
        </section>

        <section className="cvats-finalCta" aria-labelledby="cvats-final-title">
          <div>
            <h2 id="cvats-final-title">Avant votre prochaine candidature, vérifiez votre CV.</h2>
            <p>Le guide est gratuit. Vous le recevez par email en quelques minutes.</p>
          </div>
          <button type="button" className="cvats-finalCta__button" onClick={focusForm}>
            Recevoir mon guide gratuit →
          </button>
          <span>Gratuit · Sans carte bancaire · Votre adresse ne sera pas revendue</span>
        </section>

        <section className="cvats-section cvats-faq" aria-label="Questions fréquentes">
          <h2>Questions fréquentes</h2>
          {FAQ_ITEMS.map((item, index) => (
            <details className="faq-item" key={item.question} open={index === 0}>
              <summary className="faq-question">
                {item.question}
                <ChevronIcon />
              </summary>
              <p className="faq-answer">{item.answer}</p>
            </details>
          ))}
        </section>
      </main>

      <footer className="cvats-footer">
        <div className="cvats-footer__inner">
          <LogoMark />
          <nav aria-label="Liens utiles">
            <a href="/privacy">Politique de confidentialité</a>
            <a href="mailto:contact@go4jobapp.com?subject=Désinscription">Se désinscrire</a>
          </nav>
          <p>© 2025 Go4Job. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}

