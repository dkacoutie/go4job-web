import { useMemo, useState, type FormEvent } from "react";
import "./ContactPage.css";

type SubjectOption = {
  value: string;
  label: string;
};

const SUBJECTS: SubjectOption[] = [
  { value: "support", label: "Support / Problème technique" },
  { value: "sales", label: "Démo / Offre entreprise" },
  { value: "partnership", label: "Partenariat / Intégration" },
  { value: "privacy", label: "Données personnelles / RGPD" },
  { value: "other", label: "Autre demande" },
];

const CONTACT_CARDS = [
  {
    title: "Email",
    value: "contact@go4job.org",
    href: "mailto:contact@go4job.org",
    note: "Réponse sous 24h",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v.2l8 5.1 8-5.1V7H4Zm16 2.9-7.5 4.8a1 1 0 0 1-1.1 0L4 9.9V17h16V9.9Z" />
      </svg>
    ),
  },
  {
    title: "Téléphone",
    value: "+225 01 51 67 67 67",
    href: "tel:+2250151676767",
    note: "Lun–Ven · 9h–18h GMT",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.6 2h2.8c.4 0 .8.3.9.7l.9 3.7c.1.3 0 .6-.2.8l-1.8 1.8a12.7 12.7 0 0 0 5.8 5.8l1.8-1.8c.2-.2.5-.3.8-.2l3.7.9c.4.1.7.5.7.9v2.8c0 .5-.4.9-.9 1A17 17 0 0 1 2 7.5c0-.5.4-.9.9-1l3.7-.9c.3-.1.6 0 .8.2l1.2 1.2-1.8 1.8 1.8-1.8-1.2-1.2c-.2-.2-.3-.5-.2-.8l.9-3.7c.1-.4.5-.7.9-.7Z" />
      </svg>
    ),
  },
  {
    title: "WhatsApp",
    value: "+225 01 51 67 67 67",
    href: "https://wa.me/2250151676767",
    note: "Support instantané",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a9 9 0 0 0-9 9c0 1.6.4 3.1 1.2 4.4l-1 3.8 3.9-1A9.2 9.2 0 0 0 12 20a9 9 0 0 0 0-18Zm0 2a7 7 0 0 1 0 14 7.2 7.2 0 0 1-3.6-1l-.3-.2-2.3.6.6-2.3-.2-.3A7 7 0 0 1 12 4Zm-3.1 3.5-.5 1.5c-.1.4 0 .8.3 1.2.5.7 1.2 1.6 2.1 2.4a8 8 0 0 0 2.6 1.7c.5.2.9.2 1.2 0l1.3-.6c.3-.2.6-.7.4-1.1l-.6-1.4c-.2-.4-.6-.6-1-.5l-1 .2c-.3.1-.5.4-.6.7l-.1.4c-.2.1-.8-.1-1.3-.5-.6-.5-1.1-1-1.5-1.6-.3-.4-.5-.9-.4-1 .3-.5.4-.9.2-1.4l-.4-1c-.2-.4-.7-.7-1.2-.5l-.5.2Z" />
      </svg>
    ),
  },
  {
    title: "Adresse",
    value: "Abidjan, Côte d’Ivoire — Plateau",
    href: "https://maps.google.com/?q=Plateau+Abidjan",
    note: "Sur rendez-vous",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a7 7 0 0 1 7 7c0 4.2-3.8 8.6-6.1 10.8a1.3 1.3 0 0 1-1.8 0C8.8 17.6 5 13.2 5 9a7 7 0 0 1 7-7Zm0 2a5 5 0 0 0-5 5c0 2.9 2.7 6.6 5 8.8 2.3-2.2 5-6 5-8.8a5 5 0 0 0-5-5Zm0 2.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" />
      </svg>
    ),
  },
];

type FormState = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

const INITIAL_STATE: FormState = {
  name: "",
  email: "",
  subject: SUBJECTS[0].value,
  message: "",
};

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<keyof FormState, string | null>>({
    name: null,
    email: null,
    subject: null,
    message: null,
  });

  const isEmailValid = useMemo(() => /\S+@\S+\.\S+/.test(form.email.trim()), [form.email]);

  const validate = () => {
    const nextErrors: Record<keyof FormState, string | null> = {
      name: form.name.trim() ? null : "Nom requis",
      email: form.email.trim()
        ? isEmailValid
          ? null
          : "Email invalide"
        : "Email requis",
      subject: form.subject ? null : "Sujet requis",
      message: form.message.trim() ? null : "Message requis",
    };
    setErrors(nextErrors);
    return Object.values(nextErrors).every((e) => e === null);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccess(null);
    if (!validate()) return;
    setSubmitting(true);

    setTimeout(() => {
      setSubmitting(false);
      setSuccess("Message envoyé. Nous vous répondrons sous 24h.");
      setForm(INITIAL_STATE);
      setErrors({
        name: null,
        email: null,
        subject: null,
        message: null,
      });
    }, 800);
  };

  return (
    <div className="app-container contact-shell">
      <div className="contact-header">
        <h1>Contactez-nous</h1>
        <p>Notre équipe est là pour répondre à toutes vos questions et vous accompagner</p>
      </div>

      <div className="contact-grid">
        <section className="contact-card contact-form" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title">Envoyer un message</h2>
          <form className="contact-form__body" onSubmit={handleSubmit} aria-live="polite">
            <label className="contact-label">
              Nom complet *
              <input
                className={`contact-input ${errors.name ? "is-error" : ""}`}
                type="text"
                name="name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
              {errors.name && <span className="contact-error">{errors.name}</span>}
            </label>

            <label className="contact-label">
              Email *
              <input
                className={`contact-input ${errors.email ? "is-error" : ""}`}
                type="email"
                name="email"
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
                rows={5}
                required
              />
              {errors.message && <span className="contact-error">{errors.message}</span>}
            </label>

            <button className="contact-btn" type="submit" disabled={submitting}>
              {submitting ? "Envoi..." : "Envoyer le message"}
            </button>

            {success && (
              <div className="contact-success" role="status">
                {success}
              </div>
            )}
          </form>
        </section>

        <section className="contact-card contact-info" aria-label="Autres moyens de contact">
          <h2>Autres moyens de contact</h2>
          <div className="contact-info__grid">
            {CONTACT_CARDS.map((card) => (
              <a key={card.title} className="contact-info__item" href={card.href} target="_blank" rel="noreferrer">
                <div className="contact-info__icon" aria-hidden="true">
                  {card.icon}
                </div>
                <div className="contact-info__content">
                  <div className="contact-info__title">{card.title}</div>
                  <div className="contact-info__value">{card.value}</div>
                  <div className="contact-info__note">{card.note}</div>
                </div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
