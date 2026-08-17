import { useEffect, useMemo, useState } from "react";
import { useToast } from "./components/useToast";
import {
  fetchAdminTestimonials,
  moderateTestimonial,
  type AdminTestimonialRow,
} from "./lib/adminTestimonialsApi";
import "./AdminTestimonialsPage.css";

// JR-testimonials-20260816, refonte visuelle JR-testimonials-ui-20260817 :
// premiere version utilisait des classes ("btnPill") jamais definies dans le
// CSS du projet -> page rendue quasi sans style, signale par Dieudonne en
// comparant avec /admin/partners. Repris ici sur le meme systeme visuel que
// les autres pages admin : @import AdminSourcesPage.css (chips/card/btn/
// btn--primary/btn--ghost, base commune a AdminSourcesPage.tsx et
// AdminPartnersPage.tsx) + tabs repris du style de AdminPartnersPage.css.

type FilterKey = "pending" | "approved" | "rejected" | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pending", label: "En attente" },
  { key: "approved", label: "Publies" },
  { key: "rejected", label: "Rejetes" },
  { key: "all", label: "Tous" },
];

const STATUS_LABEL: Record<AdminTestimonialRow["status"], string> = {
  pending: "En attente",
  approved: "Publie",
  rejected: "Rejete",
};

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

  const counts = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    }),
    [rows]
  );

  const countFor = (key: FilterKey) => (key === "all" ? counts.total : counts[key]);

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
    <div className="adminTestimonials">
      <div className="adminTestimonials__top">
        <div>
          <h1>Admin · Avis utilisateurs</h1>
          <div className="subtitle">
            Valide ou rejette les avis soumis depuis "Mon profil". Seuls les avis publies apparaissent sur la
            page d'accueil et la page "Qui sommes-nous".
          </div>
          <div className="chips">
            <span className="chip">Total : {counts.total}</span>
            <span className="chip">En attente : {counts.pending}</span>
            <span className="chip">Publies : {counts.approved}</span>
            <span className="chip">Rejetes : {counts.rejected}</span>
          </div>
        </div>

        <div className="topActions">
          <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Chargement..." : "Rafraichir"}
          </button>
        </div>
      </div>

      <div className="adminTestimonials__tabs" role="tablist" aria-label="Filtrer les avis">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`adminTestimonials__tab${filter === f.key ? " is-active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} ({countFor(f.key)})
          </button>
        ))}
      </div>

      {!loading && visibleRows.length === 0 ? (
        <div className="card adminTestimonials__empty">
          <h2>Aucun avis dans cette categorie</h2>
          <p className="subtitle">
            Les avis soumis depuis "Mon profil" apparaitront ici, a valider avant publication.
          </p>
        </div>
      ) : null}

      <div className="adminTestimonials__list">
        {visibleRows.map((row) => (
          <article key={row.id} className="card adminTestimonials__card">
            <div className="adminTestimonials__cardHead">
              <strong>{row.author_display_name}</strong>
              <span className="adminTestimonials__rating">
                {"★".repeat(row.rating)}
                {"☆".repeat(5 - row.rating)}
              </span>
              <span className={`chip adminTestimonials__status--${row.status}`}>{STATUS_LABEL[row.status]}</span>
            </div>
            <p className="adminTestimonials__message">{row.message}</p>
            <p className="muted">Soumis le {new Date(row.created_at).toLocaleDateString("fr-FR")}</p>

            <div className="adminTestimonials__actions">
              {row.status !== "approved" && (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busyId === row.id}
                  onClick={() => handleModerate(row.id, "approved")}
                >
                  Publier
                </button>
              )}
              {row.status !== "rejected" && (
                <button
                  type="button"
                  className="btn btn--ghost"
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
