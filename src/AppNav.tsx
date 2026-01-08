import { useLocation, useNavigate } from "react-router-dom";
import go4jobLogo from "./assets/go4job-logo.png";
import "./AppNav.css";

export default function AppNav() {
  const navigate = useNavigate();
  const loc = useLocation();

  const items = [
    { label: "Dashboard", path: "/" },
    { label: "JobRadar", path: "/jobradar/feed" },
    { label: "Mes alertes", path: "/jobradar/alerts" },
    { label: "Mes candidatures", path: "/jobradar/applications" },

    // ✅ Nouveau
    { label: "Mon CV", path: "/me/cv" },

    { label: "Mon profil", path: "/jobradar/profile" }
  ];

  const isActive = (path: string) => {
    if (path === "/") return loc.pathname === "/";
    return loc.pathname === path || loc.pathname.startsWith(path + "/");
  };

  return (
    <div className="appnav">
      <button
        className="appnav__brand"
        onClick={() => navigate("/")}
        type="button"
        aria-label="Aller au dashboard"
      >
        <img className="appnav__logo" src={go4jobLogo} alt="Go4Job" />
        <span className="appnav__name">Go4Job</span>
      </button>

      <nav className="appnav__links" aria-label="Navigation">
        {items.map((it) => (
          <button
            key={it.path}
            type="button"
            className={"appnav__btn " + (isActive(it.path) ? "is-active" : "")}
            onClick={() => navigate(it.path)}
          >
            {it.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
