import { useMemo, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabaseClient";
import "./ContactPage.css";

type SubjectOption = {
  value: string;
  label: string;
};

const CONTACT_EMAIL = "contact@go4jobapp.com";
const SUBJECTS: SubjectOption[] = [
  { value: "support", label: "Support / Problème technique" },
  { value: "feedback", label: "Feedback / Suggestion" },
  { value: "partnership", label: "Partenariat" },
  { value: "other", label: "Autre" },
];

const WHATSAPP_LINK =
  "https://wa.me/2250151676767?text=" +
  encodeURIComponent("Bonjour, j’ai une question sur JobRadar : ");

type FormState = {
  name: string;
  email: string;
  subject: string;
  message: string;
  honey: string;
};

const INITIAL_STATE: FormState = {
  name: "",
  email: "",
  subject: SUBJECTS[0].value,
  message: "",
  honey: "",
};

function mapContactError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("rate_limited")) {
    return "Trop de demandes. Réessayez dans une minute.";
  }
  if (lower.includes("invalid_email")) {
    return "Email invalide. Vérifiez l’adresse.";
  }
  if (lower.includes("invalid_message")) {
    return "Message trop court. Merci d’ajouter plus de détails.";
  }
  if (lower.includes("subject_required")) {
    return "Sujet requis.";
  }
  if (lower.includes("spam_detected")) {
    return "Envoi bloqué par sécurité. Réessayez.";
  }
  return "Impossible d’envoyer votre message pour le moment.";
}

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errors, setErrors] = useState<Record<keyof FormState, string | null>>({
    name: null,
    email: null,
    subject: null,
    message: null,
    honey: null,
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const isEmailValid = useMemo(() => /\S+@\S+\.\S+/.test(form.email.trim()), [form.email]);

  const validate = () => {
    const trimmedMessage = form.message.trim();
    const nextErrors: Record<keyof FormState, string | null> = {
      name: null,
      email: form.email.trim()
        ? isEmailValid
          ? null
          : "Email invalide"
        : "Email requis",
      subject: form.subject ? null : "Sujet requis",
      message: trimmedMessage.length >= 10 ? null : "Message trop court (10 caractères minimum)",
      honey: null,
    };
    setErrors(nextErrors);
    return Object.values(nextErrors).every((e) => e === null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("idle");
    setServerError(null);

    if (!validate()) return;
    setSubmitting(true);

    try {
      const payload = {
        name: form.name.trim() || null,
        email: form.email.trim(),
        subject: form.subject,
        message: form.message.trim(),
        honey: form.honey.trim(),
      };

      const { data, error } = await supabase.functions.invoke("contact_submit", {
        body: payload,
      });

      if (error) {
        let msg = error.message || "Erreur serveur";
        const anyErr = error as any;
        if (anyErr?.context instanceof Response) {
          const t = await anyErr.context.text();
          if (t) {
            try {
              const j = JSON.parse(t);
              msg = j?.message || j?.error || msg;
            } catch {
              msg = t;
            }
          }
        }
        throw new Error(mapContactError(msg));
      }

      if (!data?.ok) {
        throw new Error(mapContactError(data?.message || data?.error || ""));
      }

      setStatus("success");
      setForm(INITIAL_STATE);
      setErrors({
        name: null,
        email: null,
        subject: null,
        message: null,
        honey: null,
      });
    } catch (err: any) {
      setStatus("error");
      setServerError(err?.message || "Impossible d’envoyer votre message pour le moment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-container contact-shell">
      <div className="contact-header">
        <h1>Contactez-nous</h1>
        <p>Notre équipe répond sous 24h ouvrées.</p>
        <span>Pour une réponse plus rapide, privilégiez WhatsApp.</span>
      </div>

      <div className="contact-grid">
        <section className="contact-card contact-form" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title">Envoyer un message</h2>
          <p className="contact-intro">
            Décrivez votre demande et nous vous répondrons rapidement par email.
          </p>
          <form className="contact-form__body" onSubmit={handleSubmit} aria-live="polite">
            <label className="contact-label">
              Nom complet <span className="contact-optional">(optionnel, recommandé)</span>
              <input
                className="contact-input"
                type="text"
                name="name"
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>

            <label className="contact-label">
              Email *
              <input
                className={`contact-input ${errors.email ? "is-error" : ""}`}
                type="email"
                name="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                required
              />
              {errors.email && <span className="contact-error">{errors.email}</span>}
            </label>

            <label className="contact-label">
              Sujet *
              <select
                className={`contact-input ${errors.subject ? "is-error" : ""}`}
                name="subject"
                value={form.subject}
                onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                required
              >
                {SUBJECTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {errors.subject && <span className="contact-error">{errors.subject}</span>}
            </label>

            <label className="contact-label">
              Message *
              <textarea
                className={`contact-input contact-textarea ${errors.message ? "is-error" : ""}`}
                name="message"
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                rows={6}
                minLength={10}
                maxLength={4000}
                required
              />
              {errors.message && <span className="contact-error">{errors.message}</span>}
            </label>

            <input
              className="contact-honey"
              type="text"
              name="company"
              tabIndex={-1}
              autoComplete="off"
              value={form.honey}
              onChange={(e) => setForm((prev) => ({ ...prev, honey: e.target.value }))}
            />

            <button className="contact-btn" type="submit" disabled={submitting}>
              {submitting ? "Envoi..." : "Envoyer le message"}
            </button>

            {status === "success" && (
              <div className="contact-success" role="status">
                <div className="contact-success__title">Merci ! Votre message a été envoyé.</div>
                <div className="contact-success__text">Réponse sous 24h ouvrées.</div>
                <a className="contact-whatsappBtn" href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
                  Écrire sur WhatsApp
                </a>
              </div>
            )}

            {status === "error" && (
              <div className="contact-errorBox" role="status">
                <div className="contact-errorBox__title">Impossible d’envoyer votre message pour le moment.</div>
                <div className="contact-errorBox__text">
                  {serverError || "Réessayez dans quelques instants."}
                </div>
                <div className="contact-errorBox__actions">
                  <button className="contact-btn" type="submit" disabled={submitting}>
                    Réessayer
                  </button>
                  <a className="contact-errorBox__link" href={`mailto:${CONTACT_EMAIL}`}>
                    Ou écrivez-nous à {CONTACT_EMAIL}
                  </a>
                </div>
              </div>
            )}
          </form>
        </section>

        <aside className="contact-side">
          <section className="contact-card contact-whatsapp">
            <div className="contact-whatsapp__badge">Support WhatsApp</div>
            <h2>Support WhatsApp</h2>
            <p>Réponse plus rapide. Idéal pour les urgences et questions courtes.</p>
            <a className="contact-whatsapp__cta" href={WHATSAPP_LINK} target="_blank" rel="noreferrer">
              Écrire sur WhatsApp
            </a>
            <span className="contact-whatsapp__note">Réponse sous 24h ouvrées (souvent plus rapide).</span>
          </section>

          <section className="contact-card contact-email">
            <h3>Email</h3>
            <p>Pour un suivi détaillé, contactez-nous par email.</p>
            <a className="contact-email__link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </section>
        </aside>
      </div>
    </div>
  );
}
