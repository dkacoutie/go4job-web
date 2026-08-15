import { NavLink } from "react-router-dom";
import go4jobLogo from "../assets/go4job-logo.png";
import { useSession } from "../lib/useSession";
import "./PublicHeader.css";

const PUBLIC_NAV_ITEMS = [
  { label: "Offres", to: "/offres" },
  { label: "Observatoire", to: "/observatoire-emploi" },
  { label: "Conseils carrière", to: "/conseils-carriere" },
  { label: "Tarifs", to: "/pricing" },
  { label: "Qui sommes-nous", to: "/qui-sommes-nous" },
  { label: "Contact", to: "/contact" },
] as const;

export default function PublicHeader() {
  const { session } = useSession();
  const actionTo = session ? "/jobradar/feed" : "/auth";
  const actionLabel = session ? "Mes offres" : "Connexion";

  return (
    <div className="public-header">
      <NavLink className="public-header__brand" to="/landing" aria-label="Aller à l’accueil JobRadar">
        <img className="public-header__logo" src={go4jobLogo} alt="JobRadar" />
        <span className="public-header__brandText">
          <strong>JobRadar</strong>
          <span>par Go4Job</span>
        </span>
      </NavLink>

      <nav className="public-header__nav" aria-label="Navigation publique">
        {PUBLIC_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            className={({ isActive }) =>
              `public-header__link${isActive ? " is-active" : ""}`
            }
            to={item.to}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="public-header__actions">
        <NavLink className="public-header__signin" to={actionTo}>
          {actionLabel}
        </NavLink>
      </div>
    </div>
  );
}