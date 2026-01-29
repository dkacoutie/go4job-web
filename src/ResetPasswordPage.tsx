import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import go4jobLogo from "./assets/go4job-logo.png";
import "./AuthPage.css";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(err);
}

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Quand on ouvre le lien de reset, Supabase crée une session "recovery".
  // Si on n'a aucune session après chargement, on ne peut pas changer le mot de passe.
  const canReset = useMemo(() => {
    const pOk = password.length >= 6;
    const same = password === confirm;
    return pOk && same;
  }, [password, confirm]);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      setErrorMsg(
        "Lien invalide ou expiré. Reviens sur la page Connexion et clique sur “Mot de passe oublié ?” pour recevoir un nouveau lien."
      );
    }
  }, [loading, session]);

  async function handleReset() {
    if (busy) return;
    setErrorMsg(null);
    setInfoMsg(null);

    if (!session) {
      setErrorMsg(
        "Impossible de changer le mot de passe : pas de session de récupération. Redemande un lien de reset."
      );
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    if (password !== confirm) {
      setErrorMsg("Les deux mots de passe ne sont pas identiques.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setInfoMsg("Mot de passe mis à jour ✅ Tu peux te reconnecter.");
      // Optionnel mais propre : on déconnecte la session de recovery
      await supabase.auth.signOut();
      // Puis on renvoie vers /auth
      navigate("/auth", { replace: true });
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-top">
        <button
          type="button"
          className="auth-brand"
          onClick={() => navigate("/")}
          aria-label="Aller au dashboard"
        >
          <img src={go4jobLogo} alt="Go4Job" className="auth-brand-logo" draggable={false} />
        </button>

        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("/auth", { replace: true });
          }}
        >
          Retour connexion
        </a>
      </div>

      <div className="auth-main">
        {/* LEFT / HERO (réutilise le style AuthPage) */}
        <section className="hero">
          <div className="hero-content">
            <h1 className="heroTitle">Réinitialisation</h1>
            <p>Choisis un nouveau mot de passe pour ton compte.</p>

            <div className="hero-badges">
              <div className="badge">Simple</div>
              <div className="badge">Sécurisé</div>
              <div className="badge">Rapide</div>
            </div>
          </div>
        </section>

        {/* RIGHT / FORM */}
        <aside className="card">
          <h2>Nouveau mot de passe</h2>
          <p className="sub">Minimum 6 caractères.</p>

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              handleReset();
            }}
          >
            <label className="label">
              Nouveau mot de passe
              <input
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Minimum 6 caractères"
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            <label className="label">
              Confirmer le mot de passe
              <input
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                placeholder="Répète le mot de passe"
                autoComplete="new-password"
                disabled={busy}
              />
            </label>

            {errorMsg && <div className="error">{errorMsg}</div>}
            {infoMsg && <div className="foot">{infoMsg}</div>}

            <div className="authActions">
              <button className="btn btnPrimary wFull" disabled={!canReset || busy || !session} type="submit">
                {busy ? "Mise à jour..." : "Mettre à jour le mot de passe"}
              </button>

              <button
                className="btn btnSecondary wFull"
                type="button"
                disabled={busy}
                onClick={() => navigate("/auth", { replace: true })}
              >
                Retour
              </button>
            </div>

            <div className="foot">Si le lien est expiré, redemande un nouveau lien.</div>
          </form>
        </aside>
      </div>
    </div>
  );
}
