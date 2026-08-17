import { useEffect, useMemo, useState } from "react";
import { useToast } from "./components/useToast";
import {
  fetchAdminTestimonials,
  moderateTestimonial,
  type AdminTestimonialRow,
} from "./lib/adminTestimonialsApi";
import "./AdminTestimonialsPage.css";

// JR-testimonials-20260816 : moderation admin des avis, accessible via
// /admin/testimonials (route ajoutee dans App.tsx, entree ajoutee dans
// AppNav.tsx -> adminItems). Meme structure que les autres pages admin :
// chargement via RPC, actions ponctuelles, pas d'etat global.

type FilterKey = "pending" | "approved" | "rejected" | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pending", label: "En attente" },
  { key: "approved", label: "Publies" },
  { key: "rejected", label: "Rejetes" },
  { key: "all", label: "Tous" },
];

export default function AdminTestimonialsPage() {
  const { pushToast } = useToast();
  const [rows, setRows] = useState<AdminTestimonialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAdminTestimonials();
      setRows(data);
    } catch (err) {
      pushToast({
        kind: "error",
        title: "Chargement impossible",
        message: err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter]
  );

  async function handleModerate(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    try {
      const updated = await moderateTestimonial(id, status);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      pushToast({
        kind: "success",
        title: status === "approved" ? "Avis publie" : "Avis rejete",
        message: "Le statut a ete mis a jour.",
      });
    } catch (err) {
      pushToast({
        kind: "error",
        title: "Action impossible",
        message: err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app-narrow admin-testimonials">
      <h1>Avis utilisateurs</h1>
      <p className="admin-testimonials__intro">
        Valide ou rejette les avis soumis par les utilisateurs. Seuls les avis publies apparaissent
        sur la page d'accueil et la page "Qui sommes-nous".
      </p>

      <div className="admin-testimonials__filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={f.key === filter ? "btn btnPill btnPill--active" : "btn btnGhost btnPill"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key !== "all" && ` (${rows.filter((r) => r.status === f.key).length})`}
          </button>
        ))}
      </div>

      {loading && <p>Chargement...</p>}

      {!loading && visibleRows.length === 0 && <p>Aucun avis dans cette categorie.</p>}

      <div className="admin-testimonials__list">
        {visibleRows.map((row) => (
          <article key={row.id} className="admin-testimonials__card">
            <div className="admin-testimonials__cardHead">
              <strong>{row.author_display_name}</strong>
              <span className="admin-testimonials__rating">{"★".repeat(row.rating)}{"☆".repeat(5 - row.rating)}</span>
              <span className={`admin-testimonials__status admin-testimonials__status--${row.status}`}>
                {row.status}
              </span>
            </div>
            <p className="admin-testimonials__message">{row.message}</p>
            <p className="admin-testimonials__meta">
              Soumis le {new Date(row.created_at).toLocaleDateString("fr-FR")}
            </p>

            <div className="admin-testimonials__actions">
              {row.status !== "approved" && (
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={busyId === row.id}
                  onClick={() => handleModerate(row.id, "approved")}
                >
                  Publier
                </button>
              )}
              {row.status !== "rejected" && (
                <button
                  type="button"
                  className="btn btnGhost"
                  disabled={busyId === row.id}
                  onClick={() => handleModerate(row.id, "rejected")}
                >
                  Rejeter
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
