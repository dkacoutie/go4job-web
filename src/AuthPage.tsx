import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import "./App.css";

export default function AuthPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      if (!email || !password) {
        setMsg("Renseigne ton email et ton mot de passe.");
        return;
      }

      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/me/jobs");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Compte créé ✅ Si une confirmation email est activée, vérifie ta boîte mail.");
      }
    } catch (err: any) {
      setMsg(err?.message ? `Erreur : ${err.message}` : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-logo" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
            <div className="app-logo-circle">G</div>
            <span className="app-logo-text">Go4Job</span>
          </div>

          <div className="app-lang">
            <button type="button">FR</button>
            <span className="app-lang-sep">|</span>
            <button type="button">EN</button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="auth-grid">
          {/* Panel gauche */}
          <section className="auth-panel">
            <h1>Accède à tes jobs recommandés</h1>
            <p>
              Connecte-toi pour voir tes recommandations, enregistrer ton profil, et suivre tes candidatures.
            </p>

            <div className="auth-bullets">
              <div className="auth-bullet">✅ Recos personnalisées</div>
              <div className="auth-bullet">✅ Profil & CV (bientôt)</div>
              <div className="auth-bullet">✅ Suivi des candidatures</div>
            </div>
          </section>

          {/* Carte formulaire */}
          <section className="auth-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "signin" ? "auth-tab active" : "auth-tab"}
                onClick={() => setMode("signin")}
              >
                Connexion
              </button>
              <button
                type="button"
                className={mode === "signup" ? "auth-tab active" : "auth-tab"}
                onClick={() => setMode("signup")}
              >
                Créer un compte
              </button>
            </div>

            <div className="auth-title">
              <h2>{mode === "signin" ? "Bienvenue 👋" : "Créer ton compte"}</h2>
              <p>{mode === "signin" ? "Connecte-toi pour continuer." : "2 minutes et c’est bon."}</p>
            </div>

            {msg && <div className="auth-alert">{msg}</div>}

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="field">
                <label>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="ex: dkacoutie@gmail.com"
                  autoComplete="email"
                />
              </div>

              <div className="field">
                <label>Mot de passe</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </div>

              <div className="auth-row">
                <span className="auth-hint">
                  {mode === "signup" ? "Min. 8 caractères recommandé." : " "}
                </span>

                <button
                  className="auth-link"
                  type="button"
                  onClick={async () => {
                    if (!email) return setMsg("Entre ton email puis clique “Mot de passe oublié”.");
                    const { error } = await supabase.auth.resetPasswordForEmail(email);
                    setMsg(error ? `Erreur : ${error.message}` : "Email de récupération envoyé ✅");
                  }}
                >
                  Mot de passe oublié ?
                </button>
              </div>

              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? "Chargement..." : mode === "signin" ? "Se connecter" : "Créer mon compte"}
              </button>

              <div className="auth-footer">
                En continuant, tu acceptes nos conditions d’utilisation (à ajouter).
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
