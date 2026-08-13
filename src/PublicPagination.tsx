import { Link } from "react-router-dom";
import { PUBLIC_JOBS_MAX_PAGE } from "./lib/publicJobsPreview";
import "./PublicOffersPreviewPage.css";

// JR-SEO-audit-20260812, bataille prioritaire #1 : pagination reelle sur les
// pages de listing publiques (/offres et les 8 pages pays/ville), a la place
// du plafond fixe de 24 offres sans suite. Fenetre bornee a
// PUBLIC_JOBS_MAX_PAGE (10) pages — decision produit du 13/08/2026, pas une
// limite technique : /offres reste un apercu qui pousse a la creation de
// compte, pas un acces gratuit a la totalite du catalogue (353k+ offres
// deja toutes decouvrables independamment via le sitemap dynamique).
//
// De vrais <Link> (pas des boutons + onClick) : navigables au clavier,
// ouvrables dans un nouvel onglet, et crawlables par un moteur qui execute
// le JS de la page (Googlebot) — meme limite deja documentee ailleurs sur ce
// depot pour l'absence de rendu serveur (usePageMeta.ts).

type PublicPaginationProps = {
  /** Chemin de base sans query string, ex. "/offres" ou "/offres/france". */
  basePath: string;
  currentPage: number;
  /**
   * Vrai si la page courante a retourne une page pleine (PAGE_SIZE lignes) —
   * seul signal fiable pour savoir si une page suivante existe, le compteur
   * total etant parfois indisponible (health snapshot) ou plafonne
   * (jobradar_public_jobs_by_location_count borne a 100 000).
   */
  hasNextPage: boolean;
};

function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

export default function PublicPagination({ basePath, currentPage, hasNextPage }: PublicPaginationProps) {
  // Rien a afficher sur une page 1 sans suite (catalogue local trop petit
  // pour depasser 24 offres) — evite une pagination vide et inutile.
  if (currentPage === 1 && !hasNextPage) return null;

  const highestKnownPage = Math.min(PUBLIC_JOBS_MAX_PAGE, currentPage + (hasNextPage ? 1 : 0));
  const pages = Array.from({ length: highestKnownPage }, (_, i) => i + 1);

  return (
    <nav className="offersPreview__pagination" aria-label="Pagination des offres">
      {currentPage > 1 ? (
        <Link
          to={pageHref(basePath, currentPage - 1)}
          className="offersPreview__pageLink offersPreview__pageLink--prevNext"
          rel="prev"
        >
          ← Précédent
        </Link>
      ) : (
        <span className="offersPreview__pageLink offersPreview__pageLink--disabled">← Précédent</span>
      )}

      <span className="offersPreview__pageNumbers">
        {pages.map((p) => (
          <Link
            key={p}
            to={pageHref(basePath, p)}
            aria-current={p === currentPage ? "page" : undefined}
            className={
              p === currentPage
                ? "offersPreview__pageLink offersPreview__pageLink--current"
                : "offersPreview__pageLink"
            }
          >
            {p}
          </Link>
        ))}
      </span>

      {currentPage < PUBLIC_JOBS_MAX_PAGE && hasNextPage ? (
        <Link
          to={pageHref(basePath, currentPage + 1)}
          className="offersPreview__pageLink offersPreview__pageLink--prevNext"
          rel="next"
        >
          Suivant →
        </Link>
      ) : (
        <span className="offersPreview__pageLink offersPreview__pageLink--disabled">Suivant →</span>
      )}
    </nav>
  );
}
