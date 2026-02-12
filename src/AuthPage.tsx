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

  // si connecté => redirect (si connu) sinon "/"
  useEffect(() => {
    if (loading) return;
    if (!session) return;

    const stored = localStorage.getItem(REDIRECT_STORAGE_KEY);
    if (stored && isSafeInternalPath(stored)) {
      localStorage.removeItem(REDIRECT_STORAGE_KEY);
      navigate(stored, { replace: true });
      return;
    }

    navigate("/", { replace: true });
  }, [loading, session, navigate]);

  // stocke un "from" safe si on arrive depuis une route protégée
  useEffect(() => {
    const state = location.state as AuthLocationState | null;
    if (state?.from && isSafeInternalPath(state.from)) {
      localStorage.setItem(REDIRECT_STORAGE_KEY, state.from);
    }
  }, [location.state]);

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
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setErrorMsg(error.message);
          return;
        }

        setInfoMsg(
          "Compte créé. Si la confirmation email est activée, vérifie ta boîte mail. Sinon tu seras connecté automatiquement."
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const redirectTo = `${window.location.origin}/auth`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) setErrorMsg(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-top">
        <button className="auth-brand" type="button" onClick={() => navigate("/")}>
          <img className="auth-brand-logo" src={go4jobLogo} alt="Go4Job" />
        </button>

        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setErrorMsg(null);
            setInfoMsg(null);
            setMode("signin");
          }}
        >
          Log in
        </a>
      </div>

      <div className="auth-main">
        {/* LEFT / HERO */}
        <section className="hero">
          <div className="hero-content">
            <h1 className="heroTitle">Espace candidat</h1>

            <p className="heroSubtitle">
              Postule plus vite, centralise ton suivi, et reçois des opportunités pertinentes. Une
              expérience nette et élégante, pensée pour toi.
            </p>

            <div className="hero-badges">
              <div className="badge">Matching intelligent</div>
              <div className="badge">Candidature en 1 clic</div>
              <div className="badge">Suivi centralisé</div>
              <div className="badge">Données sécurisées</div>
            </div>

            <div className="hero-ctaWrap">
              <div className="hero-ctaRow">
                <button
                  className="hero-cta hero-ctaPrimary"
                  type="button"
                  onClick={() => setMode("signup")}
                >
                  Créer mon compte
                </button>

                <button
                  className="hero-cta hero-ctaGhost"
                  type="button"
                  onClick={() => setMode("signin")}
                >
                  J’ai déjà un compte
                </button>
              </div>

              {/* ✅ 2 colonnes, chacune sous son bouton */}
              <div className="hero-ctaHints">
                <div className="hero-ctaHintItem">Nouveau ? Crée ton espace en 30 secondes.</div>
                <div className="hero-ctaHintItem">Déjà inscrit ? Connecte-toi.</div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT / FORM */}
        <aside className="card">
          <h2>{mode === "signup" ? "Créer un compte" : "Connexion"}</h2>

          <p className="sub">
            {mode === "signup"
              ? "Crée ton espace candidat en moins d’une minute."
              : "Accède à ton espace candidat."}
          </p>

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <button className="btn btnSecondary wFull btnGoogle" type="button" onClick={handleGoogle}>
              <span className="googleIcon" aria-hidden="true">
                G
              </span>
              Continuer avec Google
            </button>

            <div className="dividerRow">
              <span className="dividerLine" />
              <span className="dividerText">OU</span>
              <span className="dividerLine" />
            </div>

            <label className="label">
              Email
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="ex: contact@go4job.org"
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

            {errorMsg && <div className="error">{errorMsg}</div>}
            {infoMsg && <div className="foot">{infoMsg}</div>}

            <div className="authActions">
              <button className="btn btnPrimary wFull" disabled={!canSubmit || busy} type="submit">
                {busy ? "Patiente..." : mode === "signup" ? "Créer un compte" : "Se connecter"}
              </button>

              <button
                className="btn btnSecondary wFull"
                disabled={busy}
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setInfoMsg(null);
                  setMode((m) => (m === "signin" ? "signup" : "signin"));
                }}
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
