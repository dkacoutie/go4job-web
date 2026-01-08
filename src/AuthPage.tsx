import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./AuthPage.css";

export default function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // si connecté => dashboard
  useEffect(() => {
    if (!loading && session) navigate("/", { replace: true });
  }, [loading, session, navigate]);

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

  return (
    <div className="auth-shell">
      <div className="auth-top">
        <div className="auth-brand" onClick={() => navigate("/")}>
          <div className="auth-mark" />
          <span>Go4Job</span>
        </div>

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

            <p>
              Postule plus vite, centralise ton suivi, et reçois des opportunités pertinentes.
              Une expérience nette et élégante, pensée pour toi.
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

  <div className="hero-ctaHint">
    Déjà inscrit ? Connecte-toi. Nouveau ? Crée ton espace en 30 secondes.
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

            {/* ✅ boutons alignés / même largeur */}
            <div className="authActions">
              <button
                className="btn btnPrimary wFull"
                disabled={!canSubmit || busy}
                type="submit"
              >
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

            <div className="foot">
              Astuce : pour tester vite, tu peux désactiver “Confirm email” dans Supabase.
              <br />
              Plus tard, on ajoutera{" "}
              <a
                className="smallLink"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                Google Login
              </a>
              .
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
