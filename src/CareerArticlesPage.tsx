import { Link } from "react-router-dom";
import { usePageMeta } from "./lib/usePageMeta";
import { CAREER_ARTICLES } from "./lib/careerArticlesContent";
import "./App.css";
import "./CareerArticles.css";

// JR-SEO : page d'index "Conseils carriere", decidee le 13/08/2026 (voir
// claude/netlinking-strategie-jobradar.md) -- une seule section
// d'articles, rattachee a CapCarriere, plutot que du contenu duplique
// sur JobRadar et CapCarriere separement.
export default function CareerArticlesPage() {
  usePageMeta({
    title: "Conseils carrière",
    description:
      "Guides CapCarrière pour préparer une candidature solide : CV, entretien d'embauche, et plus à venir. Pensés pour l'Afrique francophone et les candidatures remote à l'international.",
    path: "/conseils-carriere",
  });

  const sorted = [...CAREER_ARTICLES].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  return (
    <div className="app-narrow careerArticles">
      <h1>Conseils carrière</h1>
      <p className="careerArticles__lead">
        Les guides CapCarrière pour transformer une offre repérée sur JobRadar en candidature solide — CV, entretien,
        et d'autres sujets à venir. Pensés pour l'Afrique francophone et les candidatures remote à l'international.
      </p>

      <ul className="careerArticles__list">
        {sorted.map((article) => (
          <li key={article.slug} className="careerArticles__item">
            <Link className="careerArticles__itemTitle" to={`/conseils-carriere/${article.slug}`}>
              {article.title}
            </Link>
            <p className="careerArticles__itemDescription">{article.description}</p>
            <span className="careerArticles__itemDate">
              {new Date(article.publishedAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
