import { Link, Navigate, useParams } from "react-router-dom";
import { usePageMeta } from "./lib/usePageMeta";
import { CAREER_ARTICLES, getCareerArticleBySlug } from "./lib/careerArticlesContent";
import "./App.css";
import "./CareerArticles.css";

export default function CareerArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const article = getCareerArticleBySlug(slug);

  // Toujours appele (regle des hooks) ; usePageMeta gere en interne un
  // titre/description par defaut si l'article n'existe pas -- la
  // redirection juste apres empeche de toute facon ce cas de rester affiche.
  usePageMeta({
    title: article ? article.title : "Conseils carrière",
    description: article ? article.description : "Guides CapCarrière pour préparer une candidature solide.",
    path: `/conseils-carriere/${slug ?? ""}`,
  });

  if (!article) {
    return <Navigate to="/conseils-carriere" replace />;
  }

  const otherArticles = CAREER_ARTICLES.filter((a) => a.slug !== article.slug);

  return (
    <div className="app-narrow careerArticles">
      <Link className="careerArticles__back" to="/conseils-carriere">
        ← Tous les conseils carrière
      </Link>

      <h1>{article.title}</h1>
      <p className="careerArticles__itemDate careerArticles__publishedAt">
        Publié le{" "}
        {new Date(article.publishedAt).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </p>

      <p className="careerArticles__lead">{article.intro}</p>

      {article.blocks.map((block, i) => {
        if (block.kind === "h2") return <h2 key={i}>{block.text}</h2>;
        if (block.kind === "p") return <p key={i}>{block.text}</p>;
        if (block.kind === "ol")
          return (
            <ol key={i} className="careerArticles__orderedList">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          );
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      })}

      {otherArticles.length > 0 && (
        <div className="careerArticles__more">
          <h2>À lire aussi</h2>
          <ul className="careerArticles__list careerArticles__list--compact">
            {otherArticles.map((a) => (
              <li key={a.slug} className="careerArticles__item">
                <Link className="careerArticles__itemTitle" to={`/conseils-carriere/${a.slug}`}>
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
