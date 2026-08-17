import { useEffect, useState } from "react";
import {
  fetchPublicTestimonials,
  fetchTestimonialsStats,
  type PublicTestimonial,
  type TestimonialsStats,
} from "../lib/testimonialsApi";
import "./TestimonialsSection.css";

// JR-testimonials-20260816 : bloc public d'avis, affiche sur LandingPage.tsx
// et AboutPage.tsx. Ne rend rien tant qu'il n'y a aucun avis approuve, pour
// eviter d'afficher "0 avis" sur un site jeune.

function Stars({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="testimonials-stars" aria-label={`${rating} sur 5 etoiles`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rounded ? "testimonials-star testimonials-starFilled" : "testimonials-star"}>
          {"★"}
        </span>
      ))}
    </span>
  );
}

export default function TestimonialsSection() {
  const [items, setItems] = useState<PublicTestimonial[] | null>(null);
  const [stats, setStats] = useState<TestimonialsStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [publicItems, publicStats] = await Promise.all([
          fetchPublicTestimonials(6),
          fetchTestimonialsStats(),
        ]);
        if (!cancelled) {
          setItems(publicItems);
          setStats(publicStats);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section className="testimonials-section" aria-labelledby="testimonials-heading">
      <div className="testimonials-header">
        <h2 id="testimonials-heading">Ce que disent nos utilisateurs</h2>
        {stats && stats.average_rating !== null && (
          <div className="testimonials-summary">
            <Stars rating={stats.average_rating} />
            <span className="testimonials-summaryText">
              {stats.average_rating.toFixed(1)} / 5 sur {stats.approved_count} avis
            </span>
          </div>
        )}
      </div>

      <div className="testimonials-grid">
        {items.map((item) => (
          <article key={item.id} className="testimonials-card">
            <Stars rating={item.rating} />
            <p className="testimonials-message">&laquo;&nbsp;{item.message}&nbsp;&raquo;</p>
            <p className="testimonials-author">{item.author_display_name}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
