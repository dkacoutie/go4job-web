import { useEffect, useState } from "react";
import { useToast } from "./useToast";
import {
  fetchMyTestimonial,
  submitTestimonial,
  type MyTestimonial,
} from "../lib/testimonialsApi";
import "./TestimonialForm.css";

// JR-testimonials-20260816 : formulaire de soumission d'avis, integre dans
// ProfilePage.tsx. Reutilise les classes .profile-section de ProfilePage.css
// pour rester coherent visuellement avec le reste de la page.

const STATUS_LABEL: Record<MyTestimonial["status"], string> = {
  pending: "En attente de validation",
  approved: "Publie",
  rejected: "Non retenu",
};

export default function TestimonialForm({ defaultDisplayName }: { defaultDisplayName?: string }) {
  const { pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<MyTestimonial | null>(null);
  const [rating, setRating] = useState(5);
  const [displayName, setDisplayName] = useState(defaultDisplayName ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const mine = await fetchMyTestimonial();
        if (cancelled) return;
        setExisting(mine);
        if (mine) {
          setRating(mine.rating);
          setDisplayName(mine.author_display_name);
          setMessage(mine.message);
        }
      } catch {
        // Silencieux : le formulaire reste utilisable meme si le chargement
        // de l'avis existant echoue.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    if (message.trim().length < 10) {
      pushToast({ kind: "error", title: "Avis trop court", message: "Ecris au moins 10 caracteres." });
      return;
    }
    if (displayName.trim().length < 2) {
      pushToast({ kind: "error", title: "Nom manquant", message: "Indique le nom a afficher avec ton avis." });
      return;
    }

    setSaving(true);
    try {
      const saved = await submitTestimonial({
        message: message.trim(),
        rating,
        displayName: displayName.trim(),
      });
      setExisting(saved);
      pushToast({
        kind: "success",
        title: "Avis envoye",
        message: "Merci ! Ton avis sera visible apres validation par l'equipe.",
      });
    } catch (err) {
      pushToast({
        kind: "error",
        title: "Echec de l'envoi",
        message: err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <section className="profile-section">
      <div className="profile-section__head">
        <h2 className="profile-section__title">Laisser un avis</h2>
        <p className="profile-section__text">
          Ton avis peut etre affiche sur la page d'accueil de JobRadar apres validation.
        </p>
      </div>

      {existing && (
        <p className={existing.status === "rejected" ? "profile-msgErr" : "profile-msg"}>
          Statut actuel : {STATUS_LABEL[existing.status]}
        </p>
      )}

      <div className="field">
        <label htmlFor="testimonial-rating">Note</label>
        <div id="testimonial-rating" className="testimonialForm-stars" role="radiogroup" aria-label="Note sur 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              className={n <= rating ? "testimonialForm-star testimonialForm-starActive" : "testimonialForm-star"}
              onClick={() => setRating(n)}
            >
              {"★"}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="testimonial-name">Nom affiche</label>
        <input
          id="testimonial-name"
          className="input"
          type="text"
          value={displayName}
          maxLength={60}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex. Awa K."
        />
      </div>

      <div className="field">
        <label htmlFor="testimonial-message">Ton avis</label>
        <textarea
          id="testimonial-message"
          className="input"
          rows={4}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Qu'est-ce que JobRadar t'a apporte ?"
        />
      </div>

      <div className="actions">
        <button type="button" className="btn btnPrimary" disabled={saving} onClick={handleSubmit}>
          {saving ? "Envoi..." : existing ? "Mettre a jour mon avis" : "Envoyer mon avis"}
        </button>
      </div>
    </section>
  );
}
