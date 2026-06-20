import { Link } from "react-router-dom";

type Social = {
  label: string;
  href: string;
  icon: "linkedin" | "facebook" | "instagram" | "tiktok";
};

type SiteFooterVariant = "app" | "public";

function SocialIcon({ name }: { name: Social["icon"] }) {
  switch (name) {
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.11 1 2.48 1h.02C3.87 1 4.98 2.12 4.98 3.5ZM.5 8h4V24h-4V8Zm7.5 0h3.84v2.18h.05c.53-1 1.83-2.18 3.77-2.18 4.03 0 4.78 2.65 4.78 6.09V24h-4v-8.5c0-2.03-.04-4.64-2.83-4.64-2.83 0-3.27 2.2-3.27 4.5V24h-4V8Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.5 24v-10h3.3l.5-3.9h-3.8V7.6c0-1.1.3-1.9 1.9-1.9h2V2.2c-.4-.1-1.8-.2-3.4-.2-3.4 0-5.7 2.1-5.7 5.9V10H5v4h3.3v10h5.2Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.2-2.7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.6 3c.6 2.7 2.3 4.4 5.1 4.6V11c-1.8 0-3.3-.6-4.5-1.5v6.7c0 3.5-2.8 6.3-6.3 6.3S4.6 19.7 4.6 16.2s2.8-6.3 6.3-6.3c.4 0 .8 0 1.2.1v3.6c-.4-.1-.8-.2-1.2-.2-1.5 0-2.8 1.2-2.8 2.8S9.4 19 10.9 19s2.8-1.2 2.8-2.8V3h2.9Z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function SiteFooter({ variant = "app" }: { variant?: SiteFooterVariant }) {
  const year = new Date().getFullYear();
  const isPublic = variant === "public";

  const socials: Social[] = [
    { label: "LinkedIn", href: "https://www.linkedin.com", icon: "linkedin" },
    { label: "Facebook", href: "https://www.facebook.com", icon: "facebook" },
    { label: "Instagram", href: "https://www.instagram.com", icon: "instagram" },
    { label: "TikTok", href: "https://www.tiktok.com", icon: "tiktok" },
  ];

  return (
    <footer className="site-footer" aria-label="Pied de page">
      <div className="app-container">
        <div className="site-footer__grid">
          <section className="site-footer__brand" aria-label="JobRadar">
            <div className="site-footer__logoText">JobRadar</div>
            <p className="site-footer__desc">
              JobRadar surveille les offres et met en avant celles qui correspondent à ton profil,
              sans que tu aies à chercher chaque jour. Un produit Go4Job.
            </p>

            <div className="site-footer__socialIcons" aria-label="Réseaux sociaux">
              {socials.map((s) => (
                <a
                  key={s.label}
                  className="site-footer__iconLink"
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  title={s.label}
                >
                  <SocialIcon name={s.icon} />
                </a>
              ))}
            </div>
          </section>

          {isPublic ? (
            <>
              <nav className="site-footer__col" aria-label="Découvrir">
                <div className="site-footer__title">Découvrir</div>
                <ul className="site-footer__list">
                  <li>
                    <Link className="site-footer__link" to="/landing">
                      Accueil
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/pricing">
                      Tarifs
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/contact">
                      Contact
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/auth">
                      Connexion
                    </Link>
                  </li>
                </ul>
              </nav>

              <nav className="site-footer__col" aria-label="Ressources">
                <div className="site-footer__title">Ressources</div>
                <ul className="site-footer__list">
                  <li>
                    <Link className="site-footer__link" to="/contact">
                      Support / Contact
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/pricing">
                      Voir les pass
                    </Link>
                  </li>
                </ul>
              </nav>
            </>
          ) : (
            <>
              <nav className="site-footer__col" aria-label="Fonctionnalités">
                <div className="site-footer__title">Fonctionnalités</div>
                <ul className="site-footer__list">
                  <li>
                    <Link className="site-footer__link" to="/jobradar/feed">
                      Mes offres
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/jobradar/alerts">
                      Mes alertes
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/jobradar/applications">
                      Mes candidatures
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/me/cv">
                      Mon CV
                    </Link>
                  </li>
                </ul>
              </nav>

              <nav className="site-footer__col" aria-label="Liens rapides">
                <div className="site-footer__title">Liens rapides</div>
                <ul className="site-footer__list">
                  <li>
                    <Link className="site-footer__link" to="/">
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/jobradar/feed">
                      Offres recommandées
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/jobradar/profile">
                      Mon profil
                    </Link>
                  </li>
                  <li>
                    <Link className="site-footer__link" to="/contact">
                      Support / Contact
                    </Link>
                  </li>
                </ul>
              </nav>
            </>
          )}

          <nav className="site-footer__col" aria-label="Légal">
            <div className="site-footer__title">Légal</div>
            <ul className="site-footer__list">
              <li>
                <Link className="site-footer__link" to="/legal">
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link className="site-footer__link" to="/terms">
                  Conditions d'utilisation et de vente
                </Link>
              </li>
              <li>
                <Link className="site-footer__link" to="/privacy">
                  Politique de confidentialité
                </Link>
              </li>
              <li>
                <Link className="site-footer__link" to="/refund-policy">
                  Politique de remboursement
                </Link>
              </li>
              <li>
                <Link className="site-footer__link" to="/contact">
                  Contact
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="site-footer__bottom" aria-label="Informations légales">
          <div className="site-footer__copy">
            © {year} Go4Job. JobRadar est un produit Go4Job.
          </div>

          <div className="site-footer__copy">
            Contact: <strong>contact@go4jobapp.com</strong>
          </div>

          <div className="site-footer__note">Plateforme de recherche d'emploi assistée par l'IA.</div>
        </div>
      </div>
    </footer>
  );
}