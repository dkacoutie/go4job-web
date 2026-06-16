import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import capCarriereLogo from "./assets/capcarriere-logo.png";
import { supabase, supabaseConfigError } from "./lib/supabaseClient";
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
const CVATS_BUILD_MARKER = "cv-ats-v2-1-whatsapp";
const WHATSAPP_PHONE = "2250151676767";
const WHATSAPP_MESSAGE =
  "Bonjour, je souhaite recevoir le guide gratuit « Votre CV mérite d’être lu ». J’ai vu votre publication sur Facebook.";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
const SUPABASE_REST_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const SUPABASE_FRONTEND_CONFIG_MESSAGE =
  "Configuration momentanément indisponible. Réessayez dans quelques minutes ou contactez contact@go4jobapp.com.";

const HERO_BULLETS: Array<{ icon: IconName; text: string }> = [
  {
    icon: "eye",
    text: "Comprendre pourquoi votre CV peut rester invisible",
  },
  {
    icon: "list",
    text: "Corriger les points essentiels avant la prochaine candidature",
  },
  {
    icon: "target",
    text: "Rendre votre valeur plus claire dès les premières secondes",
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
    title: "Les erreurs qui font passer un CV inaperçu",
    text: "Repérez les détails qui empêchent un recruteur de comprendre rapidement votre valeur.",
  },
  {
    title: "Comment rendre votre parcours plus clair en quelques minutes",
    text: "Réorganisez l'essentiel sans devoir tout réécrire.",
  },
  {
    title: "Ce que le recruteur doit comprendre dès les premières secondes",
    text: "Mettez en avant les informations qui donnent envie de lire la suite.",
  },
  {
    title: "Une checklist simple avant votre prochaine candidature",
    text: "Vérifiez les points clés avant d'envoyer votre CV.",
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
    question: "Est-ce vraiment gratuit ?",
    answer:
      "Oui. Le guide est gratuit et aucune carte bancaire n'est demandée.",
  },
  {
    question: "Comment vais-je recevoir le guide ?",
    answer:
      "Vous pouvez ouvrir une conversation WhatsApp avec le message prérempli, ou choisir l'email avec le formulaire prénom + adresse email.",
  },
  {
    question: "Mes coordonnées sont-elles protégées ?",
    answer:
      "Oui. Elles servent uniquement à vous envoyer le guide et à comprendre l'origine de votre demande.",
  },
  {
    question: "Est-ce adapté à mon secteur ?",
    answer:
      "Oui. Les conseils portent sur la clarté, la structure et la lisibilité du CV, quel que soit votre domaine.",
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

function buildWhatsappEventPayload(buttonLocation: string) {
  const collectedAttribution = collectAttribution();

  return {
    event_type: "whatsapp_cta_click",
    source: "cv_ats_landing",
    utm_source: collectedAttribution.utm_source,
    utm_medium: collectedAttribution.utm_medium,
    utm_campaign: collectedAttribution.utm_campaign,
    utm_content: collectedAttribution.utm_content,
    metadata: {
      button_location: buttonLocation,
      guide: GUIDE_CONTENT_NAME,
      page_path: window.location.pathname,
      page_url: window.location.href,
      clicked_at: new Date().toISOString(),
      utm_term: collectedAttribution.utm_term,
      referrer: collectedAttribution.referrer,
      user_agent: collectedAttribution.user_agent,
      meta_fbp: collectedAttribution.meta_fbp,
      meta_fbc: collectedAttribution.meta_fbc,
    },
  };
}

function logWhatsappTrackingFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("CV ATS WhatsApp event tracking failed", message);
}

function trackWhatsappEvent(buttonLocation: string) {
  if (supabaseConfigError || !SUPABASE_REST_URL || !SUPABASE_ANON_KEY) return;

  try {
    void fetch(`${SUPABASE_REST_URL}/rest/v1/cv_ats_events`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(buildWhatsappEventPayload(buttonLocation)),
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) {
          logWhatsappTrackingFailure(`${response.status} ${response.statusText}`);
        }
      })
      .catch(logWhatsappTrackingFailure);
  } catch (error) {
    logWhatsappTrackingFailure(error);
  }
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
      if (supabaseConfigError) {
        throw new Error(SUPABASE_FRONTEND_CONFIG_MESSAGE);
      }

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

  const trackWhatsappClick = (buttonLocation: string) => {
    try {
      trackMetaCustomEvent("whatsapp_cta_click", {
        content_name: GUIDE_CONTENT_NAME,
        button_location: buttonLocation,
      });
    } catch (error) {
      logWhatsappTrackingFailure(error);
    }

    trackWhatsappEvent(buttonLocation);
  };

  return (
    <div className="cvats-page" data-capcarriere-cvats-build={CVATS_BUILD_MARKER}>
      <header className="cvats-header">
        <LogoMark />
        <nav className="cvats-header__nav" aria-label="Navigation CapCarrière">
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => trackWhatsappClick("header")}>
            Recevoir le guide
          </a>
        </nav>
      </header>

      <main>
        <section className="cvats-hero" aria-labelledby="cvats-title">
          <div className="cvats-hero__copy">
            <div className="cvats-eyebrow">Guide gratuit · WhatsApp ou Email</div>
            <h1 id="cvats-title">CV envoyé. Silence radio. Voici pourquoi — et comment changer ça.</h1>
            <p className="cvats-guideName">Guide gratuit : « Votre CV mérite d'être lu »</p>
            <p className="cvats-hero__subtitle">
              Le problème ne vient pas toujours de votre profil. Souvent, c'est votre CV qui ne montre pas clairement
              sa valeur. Ce guide gratuit vous aide à repérer ce qui bloque et à corriger l'essentiel avant votre
              prochaine candidature.
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
              <a
                className="cvats-primaryBtn cvats-whatsappBtn"
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackWhatsappClick("hero")}
              >
                Recevoir le guide sur WhatsApp
              </a>
              <button className="cvats-emailLink" type="button" onClick={focusForm}>
                Je préfère le recevoir par email
              </button>
              <span>Gratuit. Aucun spam. Vos coordonnées servent uniquement à vous envoyer le guide.</span>
            </div>
          </div>

          <div className="cvats-hero__visual">
            <picture>
              <source srcSet="/cv-ats-hero-positive.jpg" media="(max-width: 768px)" />
              <img
                src="/cv-ats-hero-positive.jpg"
                alt="Candidate souriante préparant sa candidature avec CapCarrière"
                width="720"
                height="900"
                loading="eager"
                fetchPriority="high"
              />
            </picture>
          </div>
        </section>

        <section className="cvats-emailSection" aria-labelledby="cvats-email-title">
          <div className="cvats-emailSection__copy">
            <span className="cvats-section__eyebrow">Option email</span>
            <h2 id="cvats-email-title">Recevoir le guide par email</h2>
            <p>Indiquez votre prénom et votre adresse email si vous préférez recevoir le guide dans votre boîte mail.</p>
          </div>

          <form id="cvats-guide-form" ref={formRef} className="cvats-form" onSubmit={handleSubmit} noValidate>
            <div className="cvats-form__badge">Email · Sans carte bancaire</div>
            <h2>Guide gratuit : « Votre CV mérite d'être lu »</h2>
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
            <button className="cvats-primaryBtn" type="submit" disabled={submitting || supabaseConfigError}>
              {submitting ? "Envoi en cours..." : "Recevoir le guide par email"}
            </button>
            <p className="cvats-microcopy">
              Gratuit. Aucun spam. Vos coordonnées servent uniquement à vous envoyer le guide.
            </p>
            {supabaseConfigError && (
              <div className="cvats-errorBox" role="status">
                {SUPABASE_FRONTEND_CONFIG_MESSAGE}
              </div>
            )}
            {serverError && (
              <div className="cvats-errorBox" role="status">
                {serverError}
              </div>
            )}
          </form>
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
            <h2 id="cvats-guide-content-title">Ce que vous allez trouver dans le guide</h2>
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

        <section className="cvats-section cvats-different" aria-labelledby="cvats-different-title">
          <span className="cvats-section__eyebrow">Pourquoi ce guide est différent</span>
          <h2 id="cvats-different-title">Pensé pour l'Afrique francophone</h2>
          <p>
            Il est pensé pour les candidats en Côte d'Ivoire et en Afrique francophone, avec des conseils simples,
            concrets et applicables sans jargon.
          </p>
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
            <p>Le guide est gratuit. Choisissez WhatsApp ou l'email.</p>
          </div>
          <a
            className="cvats-finalCta__button"
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackWhatsappClick("final_cta")}
          >
            Recevoir le guide sur WhatsApp
          </a>
          <button type="button" className="cvats-finalCta__email" onClick={focusForm}>
            Je préfère le recevoir par email
          </button>
          <span>Gratuit. Aucun spam. Vos coordonnées servent uniquement à vous envoyer le guide.</span>
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

