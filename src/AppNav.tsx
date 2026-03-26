import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import go4jobLogo from "./assets/go4job-logo.png";
import "./AppNav.css";
import { useSession } from "./lib/useSession";
import { supabase } from "./lib/supabaseClient";

type MenuKey = "jobradar" | "account" | null;

export default function AppNav() {
  const navigate = useNavigate();
  const loc = useLocation();

  const { session, loading } = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const jobWrapRef = useRef<HTMLDivElement | null>(null);
  const accWrapRef = useRef<HTMLDivElement | null>(null);

  const jobMenuRef = useRef<HTMLDivElement | null>(null);
  const accMenuRef = useRef<HTMLDivElement | null>(null);

  const isActive = (path: string) => {
    if (path === "/") return loc.pathname === "/";
    return loc.pathname === path || loc.pathname.startsWith(path + "/");
  };

  const jobradarActive = useMemo(() => loc.pathname.startsWith("/jobradar"), [loc.pathname]);
  const accountActive = useMemo(
    () => loc.pathname.startsWith("/me") || loc.pathname.startsWith("/jobradar/profile"),
    [loc.pathname]
  );
  const adminActive = useMemo(() => loc.pathname.startsWith("/admin"), [loc.pathname]);

  const userLabel = useMemo(() => {
    const u = session?.user;
    if (!u) return "";
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      "";
    return fullName || u.email || "Compte";
  }, [session]);

  const jobradarItems = useMemo(
    () => [
      { label: "Mes Offres", path: "/jobradar/feed" },
      { label: "Mes alertes", path: "/jobradar/alerts" },
      { label: "Mes candidatures", path: "/jobradar/applications" },
    ],
    []
  );

  const accountItems = useMemo(
    () => [
      { label: "Mon CV", path: "/me/cv" },
      { label: "Mon profil", path: "/jobradar/profile" },
      { label: "Espace partenaire", path: "/me/partner" },
      { label: "Mon abonnement", path: "/me/subscription" },
    ],
    []
  );

  const adminItems = useMemo(
    () => [
      { label: "Partenaires", path: "/admin/partners" },
      { label: "Sources", path: "/admin/sources" },
    ],
    []
  );

  const closeMenus = () => {
    setOpenMenu(null);
    setMobileNavOpen(false);
  };

  const focusFirstItem = (key: Exclude<MenuKey, null>) => {
    const menu = key === "jobradar" ? jobMenuRef.current : accMenuRef.current;
    if (!menu) return;
    requestAnimationFrame(() => {
      const first = menu.querySelector<HTMLButtonElement>('button[data-menuitem="true"]');
      first?.focus();
    });
  };

  const toggleMenu = (key: Exclude<MenuKey, null>) => {
    setOpenMenu((prev) => {
      const next = prev === key ? null : key;
      if (next) {
        setMobileNavOpen(false);
        focusFirstItem(next);
      }
      return next;
    });
  };

  useEffect(() => {
    closeMenus();
  }, [loc.pathname]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!session?.user?.id) {
        if (!cancelled) setIsAdmin(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!cancelled) {
        setIsAdmin(!error && !!data?.is_admin);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!openMenu && !mobileNavOpen) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!openMenu) return;

      const target = e.target as Node | null;
      if (!target) return;

      const wrap = openMenu === "jobradar" ? jobWrapRef.current : accWrapRef.current;
      if (wrap && !wrap.contains(target)) closeMenus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown as EventListener);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu, mobileNavOpen]);

  const onNavigate = (path: string) => {
    closeMenus();
    navigate(path);
  };

  const onSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      const { error: localErr } = await supabase.auth.signOut({ scope: "local" });

      if (localErr) {
        console.warn("[signOut local] error:", localErr);

        try {
          localStorage.removeItem("go4job.auth");
        } catch {
          // ignore
        }
      }

      const { error: globalErr } = await supabase.auth.signOut();
      if (globalErr) console.warn("[signOut global] error:", globalErr);
    } catch (e) {
      console.warn("[signOut] exception:", e);

      try {
        localStorage.removeItem("go4job.auth");
      } catch {
        // ignore
      }
    } finally {
      closeMenus();
      setIsSigningOut(false);
      navigate("/auth", { replace: true, state: { from: "/jobradar/feed" } });
    }
  };

  const isMenuOpen = openMenu !== null || mobileNavOpen;

  return (
    <div className={`appnav${isMenuOpen ? " appnav--menuOpen" : ""}`}>
      {isMenuOpen && (
        <button type="button" className="appnav__backdrop" aria-label="Fermer le menu" onClick={closeMenus} />
      )}

      <button className="appnav__brand" onClick={() => navigate("/")} type="button" aria-label="Aller au dashboard">
        <img className="appnav__logo" src={go4jobLogo} alt="Go4Job" />
      </button>

      {!loading && session && (
        <button
          type="button"
          className={`appnav__mobileToggle${mobileNavOpen ? " is-active" : ""}`}
          aria-expanded={mobileNavOpen}
          aria-controls="appnav-mobile-panel"
          aria-label={mobileNavOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
          onClick={() => {
            setOpenMenu(null);
            setMobileNavOpen((prev) => !prev);
          }}
        >
          <span className="appnav__mobileToggleIcon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="appnav__mobileToggleLabel">Menu</span>
        </button>
      )}

      {session && (
        <nav className="appnav__links" aria-label="Navigation">
          <button type="button" className={"appnav__btn " + (isActive("/") ? "is-active" : "")} onClick={() => onNavigate("/")}>
            Dashboard
          </button>

          {isAdmin && (
            <button
              type="button"
              className={"appnav__btn " + (adminActive ? "is-active" : "")}
              onClick={() => onNavigate("/admin/partners")}
            >
              Admin
            </button>
          )}

          <div className="appnav__menuWrap" ref={jobWrapRef}>
            <button
              type="button"
              className={"appnav__btn appnav__menuBtn " + (jobradarActive ? "is-active" : "")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "jobradar"}
              onClick={() => toggleMenu("jobradar")}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (openMenu !== "jobradar") setOpenMenu("jobradar");
                  focusFirstItem("jobradar");
                }
              }}
            >
              JobRadar <span className="appnav__chev" aria-hidden="true" />
            </button>

            {openMenu === "jobradar" && (
              <div className="appnav__menu" role="menu" ref={jobMenuRef} aria-label="Menu JobRadar">
                {jobradarItems.map((it) => (
                  <button
                    key={it.path}
                    type="button"
                    role="menuitem"
                    data-menuitem="true"
                    className={"appnav__menuItem " + (isActive(it.path) ? "is-active" : "")}
                    onClick={() => onNavigate(it.path)}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      )}

      <div className={`appnav__right${!session ? " appnav__right--public" : ""}`} aria-label="Compte">
        {!loading && session && (
          <div className="appnav__menuWrap" ref={accWrapRef}>
            <button
              type="button"
              className={"appnav__btn appnav__menuBtn " + (accountActive ? "is-active" : "")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "account"}
              onClick={() => toggleMenu("account")}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (openMenu !== "account") setOpenMenu("account");
                  focusFirstItem("account");
                }
              }}
              title={userLabel}
            >
              <span className="appnav__userDot" aria-hidden="true" />
              <span className="appnav__menuLabel">{userLabel}</span>
              <span className="appnav__chev" aria-hidden="true" />
            </button>

            {openMenu === "account" && (
              <div className="appnav__menu appnav__menu--right" role="menu" ref={accMenuRef} aria-label="Menu Compte">
                {accountItems.map((it) => (
                  <button
                    key={it.path}
                    type="button"
                    role="menuitem"
                    data-menuitem="true"
                    className={"appnav__menuItem " + (isActive(it.path) ? "is-active" : "")}
                    onClick={() => onNavigate(it.path)}
                  >
                    {it.label}
                  </button>
                ))}

                <div className="appnav__menuDivider" role="separator" />

                <button
                  type="button"
                  role="menuitem"
                  data-menuitem="true"
                  className="appnav__menuItem appnav__menuItem--danger"
                  onClick={onSignOut}
                  disabled={isSigningOut}
                >
                  {isSigningOut ? "Deconnexion..." : "Se deconnecter"}
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && !session && (
          <button
            type="button"
            className="appnav__btn appnav__btn--primary"
            onClick={() => navigate("/auth")}
            aria-label="Se connecter"
          >
            Se connecter
          </button>
        )}
      </div>

      {!loading && session && mobileNavOpen && (
        <div className="appnav__mobilePanel" id="appnav-mobile-panel" aria-label="Navigation mobile">
          <div className="appnav__mobilePanelHeader">
            <div className="appnav__mobilePanelTitle">Navigation</div>
            <div className="appnav__mobilePanelSub">{userLabel}</div>
          </div>

          <div className="appnav__mobileSection">
            <button
              type="button"
              className={"appnav__mobileItem " + (isActive("/") ? "is-active" : "")}
              onClick={() => onNavigate("/")}
            >
              Dashboard
            </button>
          </div>

          {isAdmin && (
            <div className="appnav__mobileSection">
              <div className="appnav__mobileSectionTitle">Admin</div>
              {adminItems.map((it) => (
                <button
                  key={it.path}
                  type="button"
                  className={"appnav__mobileItem " + (isActive(it.path) ? "is-active" : "")}
                  onClick={() => onNavigate(it.path)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          )}

          <div className="appnav__mobileSection">
            <div className="appnav__mobileSectionTitle">JobRadar</div>
            {jobradarItems.map((it) => (
              <button
                key={it.path}
                type="button"
                className={"appnav__mobileItem " + (isActive(it.path) ? "is-active" : "")}
                onClick={() => onNavigate(it.path)}
              >
                {it.label}
              </button>
            ))}
          </div>

          <div className="appnav__mobileSection">
            <div className="appnav__mobileSectionTitle">Compte</div>
            {accountItems.map((it) => (
              <button
                key={it.path}
                type="button"
                className={"appnav__mobileItem " + (isActive(it.path) ? "is-active" : "")}
                onClick={() => onNavigate(it.path)}
              >
                {it.label}
              </button>
            ))}
            <button
              type="button"
              className="appnav__mobileItem appnav__mobileItem--danger"
              onClick={onSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? "Deconnexion..." : "Se deconnecter"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
