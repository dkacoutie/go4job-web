import { NavLink } from "react-router-dom";
import go4jobLogo from "../assets/go4job-logo.png";
import "./PublicHeader.css";

const PUBLIC_NAV_ITEMS = [
  { label: "Devenir partenaire", to: "/devenir-partenaire" },
  { label: "Tarifs", to: "/pricing" },
  { label: "Contact", to: "/contact" },
] as const;

export default function PublicHeader() {
  return (
    <div className="public-header">
      <NavLink className="public-header__brand" to="/landing" aria-label="Aller à l’accueil JobRadar">
        <img className="public-header__logo" src={go4jobLogo} alt="Go4Job" />
        <span className="public-header__brandText">
          <strong>Go4Job</strong>
          <span>JobRadar</span>
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
        <NavLink className="public-header__signin" to="/auth">
          Connexion
        </NavLink>
      </div>
    </div>
  );
}
