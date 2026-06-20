import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import go4jobLogo from "./assets/go4job-logo.png";
import "./AuthPage.css";

type AuthLocationState = {
  from?: string;
};

const REDIRECT_STORAGE_KEY = "go4job_auth_redirect_to";
const AUTH_CREDENTIALS_ERROR = "L’email ou le mot de passe ne correspond pas. Vérifie et réessaie.";
const GENERIC_NETWORK_ERROR = "Une erreur est survenue. Vérifie ta connexion et réessaie.";
const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string") return false;

  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.includes("..")) return false;

  if (path.startsWith("/auth")) return false;
  if (path.startsWith("/reset-password")) return false;

  return true;
}

function readStoredRedirect(): string | null {
  try {
    const v = localStorage.getItem(REDIRECT_STORAGE_KEY);
    if (isSafeInternalPath(v)) return v;
    return null;
  } catch {
    return null;
  }
}

function storeRedirect(path: string) {
  try {
    if (isSafeInternalPath(path)) localStorage.setItem(REDIRECT_STORAGE_KEY, path);
  } catch {
    // ignore
  }
}

function clearStoredRedirect() {
  try {
    localStorage.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading } = useSession();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // ✅ où aller après login :
  // 1) state.from (quand on vient d'une page protégée)
  // 2) localStorage (utile pour OAuth Google car location.state est perdu)
  // 3) fallback feed
  const redirectTo = useMemo(() => {
    const st = (location.state ?? {}) as AuthLocationState;
    if (isSafeInternalPath(st.from)) return st.from;

    const stored = readStoredRedirect();
    if (stored) return stored;

    return "/jobradar/feed";
  }, [location.state]);

  // ✅ si connecté => rediriger vers la destination (pas "/")
  useEffect(() => {
    if (!loading && session) {
      clearStoredRedirect();
      navigate(redirectTo, { replace: true });
    }
  }, [loading, session, navigate, redirectTo]);

  const canSubmit = useMemo(() => {
    return email.trim().length > 3 && password.length >= 6;
  }, [email, password]);

  async function handleSubmit() {
    if (!canSubmit || busy) return;

    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setErrorMsg(GENERIC_SERVER_ERROR);
          return;
        }

        // Si confirmation email activée, session peut être null
        if (!data.session) {
          setInfoMsg("Compte créé ✅ Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.");
          return;
        }

        // Sinon, connecté directement → useEffect redirige
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg(AUTH_CREDENTIALS_ERROR);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (busy) return;

    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      // ✅ mémorise la destination avant de quitter l’app (OAuth)
      storeRedirect(redirectTo);

      // retour après OAuth
      const oauthRedirectTo = `${window.location.origin}/auth`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: oauthRedirectTo },
      });

      if (error) {
        setErrorMsg(GENERIC_NETWORK_ERROR);
        clearStoredRedirect();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    const e = email.trim();
    if (!e) {
      setErrorMsg("Entre ton email pour recevoir le lien de réinitialisation.");
      setInfoMsg(null);
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });
      if (error) {
        setErrorMsg(GENERIC_NETWORK_ERROR);
        return;
      }

      setInfoMsg("Lien envoyé ✅ Vérifie ta boîte mail (et les spams).");
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (next: "signin" | "signup") => {
    setErrorMsg(null);
    setInfoMsg(null);
    setMode(next);
  };

  return (
    <div className="auth-shell">
      <div className="auth-top">
        <button type="button" className="auth-brand" onClick={() => navigate("/")} aria-label="Retour au hub">
          <img src={go4jobLogo} alt="JobRadar" className="auth-brand-logo" draggable={false} />
        </button>

        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchMode(mode === "signin" ? "signup" : "signin");
          }}
        >
          {mode === "signin" ? "Créer un compte" : "Se connecter"}
        </a>
      </div>

      <div className="auth-main">
        {/* LEFT / HERO */}
        <section className="hero">
          <div className="hero-content">
            <h1 className="heroTitle">Espace candidat</h1>

            <p className="heroSubtitle">
              JobRadar surveille les offres pour toi et met en avant celles qui correspondent à ton profil.
              Toi, tu choisis où postuler.
            </p>

            <div className="hero-badges">
              <div className="badge">Offres ciblées pour toi</div>
              <div className="badge">Candidature en 1 clic</div>
              <div className="badge">Suivi centralisé</div>
              <div className="badge">Données sécurisées</div>
            </div>

            <div className="hero-ctaWrap">
              <div className="hero-ctaRow">
                <button className="hero-cta hero-ctaPrimary" type="button" onClick={() => switchMode("signup")}>
                  Créer mon compte
                </button>

                <button className="hero-cta hero-ctaGhost" type="button" onClick={() => switchMode("signin")}>
                  J’ai déjà un compte
                </button>
              </div>

              {/* ✅ 2 textes alignés sous chaque bouton */}
              <div className="hero-ctaHints">
                <p className="hero-ctaHint">Nouveau ? Crée ton espace en 30 secondes.</p>
                <p className="hero-ctaHint">Déjà inscrit ? Connecte-toi.</p>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT / FORM */}
        <aside className="card">
          <h2>{mode === "signup" ? "Créer un compte" : "Connexion"}</h2>

          <p className="sub">
            {mode === "signup" ? "Crée ton espace candidat en moins d’une minute." : "Accède à ton espace candidat."}
          </p>

          {/* ✅ Google OAuth */}
          <div style={{ display: "grid", gap: 10, marginTop: 10, marginBottom: 10 }}>
            <button className="btn btnSecondary wFull btnGoogle" type="button" disabled={busy} onClick={signInWithGoogle}>
              <svg className="googleIcon" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.35 1.54 7.8 2.83l5.68-5.68C34.1 3.6 29.6 1.5 24 1.5 14.61 1.5 6.51 6.88 2.56 14.7l6.63 5.15C11.02 13.52 17.02 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.5 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.65c-.55 2.97-2.2 5.49-4.67 7.2l7.17 5.57C43.56 37.41 46.5 31.51 46.5 24.5z"
                />
                <path
                  fill="#FBBC05"
                  d="M9.19 28.85A14.5 14.5 0 0 1 8.43 24c0-1.69.29-3.33.76-4.85L2.56 14.7A23.97 23.97 0 0 0 .5 24c0 3.89.93 7.58 2.56 10.9l6.13-6.05z"
                />
                <path
                  fill="#34A853"
                  d="M24 46.5c5.6 0 10.29-1.85 13.72-5.03l-7.17-5.57c-1.99 1.34-4.53 2.13-6.55 2.13-6.98 0-12.98-4.02-14.81-10.33l-6.63 5.15C6.51 41.12 14.61 46.5 24 46.5z"
                />
              </svg>
              Continuer avec Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.7 }}>
              <div style={{ height: 1, background: "rgba(15,23,42,0.12)", flex: 1 }} />
              <span style={{ fontSize: 12, fontWeight: 800 }}>OU</span>
              <div style={{ height: 1, background: "rgba(15,23,42,0.12)", flex: 1 }} />
            </div>
          </div>

          {/* ✅ form : Enter = submit */}
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <label className="label">
              Email
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="ex: contact@go4jobapp.com"
                autoComplete="email"
              />
            </label>

            <label className="label">
              Mot de passe
              <input
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Minimum 6 caractères"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </label>

            {mode === "signin" && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={busy}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: 13,
                    opacity: busy ? 0.6 : 0.9,
                  }}
                >
                  Mot de passe oublié ?
                </button>
              </div>
            )}

            {errorMsg && <div className="error">{errorMsg}</div>}
            {infoMsg && <div className="foot">{infoMsg}</div>}

            {/* ✅ boutons alignés / même largeur */}
            <div className="authActions">
              <button className="btn btnPrimary wFull" disabled={!canSubmit || busy} type="submit">
                {busy ? "Patiente..." : mode === "signup" ? "Créer un compte" : "Se connecter"}
              </button>

              <button
                className="btn btnSecondary wFull"
                disabled={busy}
                type="button"
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Je n’ai pas de compte" : "J’ai déjà un compte"}
              </button>
            </div>

            <div className="foot">Connexion par email ou Google.</div>
          </form>
        </aside>
      </div>
    </div>
  );
}
