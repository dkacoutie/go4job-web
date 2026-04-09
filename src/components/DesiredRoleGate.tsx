import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import go4jobLogo from "../assets/go4job-logo.png";
import { useSession } from "../lib/useSession";
import { supabase } from "../lib/supabaseClient";
import {
  EMPTY_JOBRADAR_ONBOARDING,
  mergeJobRadarOnboardingState,
  normalizeJobRadarOnboardingState,
  type JobRadarOnboardingState,
} from "../lib/jobradarOnboarding";
import "./DesiredRoleGate.css";

type ProfileRow = {
  jobradar_onboarding?: JobRadarOnboardingState | null;
};

function normalizeDesiredRole(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function GateLoader() {
  return (
    <div className="desiredRoleGate desiredRoleGate--loading">
      <div className="desiredRoleGate__loader">Chargement...</div>
    </div>
  );
}

export default function DesiredRoleGate({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [desiredRoleInput, setDesiredRoleInput] = useState("");
  const [onboardingState, setOnboardingState] = useState<JobRadarOnboardingState>(EMPTY_JOBRADAR_ONBOARDING);

  const currentDesiredRole = useMemo(
    () => normalizeDesiredRole(onboardingState.profile?.desiredRole ?? ""),
    [onboardingState.profile?.desiredRole]
  );

  const needsDesiredRole = currentDesiredRole.length === 0;

  const loadDesiredRole = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase
      .from("profiles")
      .select("jobradar_onboarding")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      setErrorMsg("Impossible de verifier ton poste recherche pour le moment.");
      setLoading(false);
      return;
    }

    const profile = (data as ProfileRow | null) ?? null;
    const nextOnboarding = normalizeJobRadarOnboardingState(profile?.jobradar_onboarding ?? EMPTY_JOBRADAR_ONBOARDING);

    setOnboardingState(nextOnboarding);
    setDesiredRoleInput(nextOnboarding.profile?.desiredRole ?? "");
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (sessionLoading) return;
    void loadDesiredRole();
  }, [sessionLoading, loadDesiredRole]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.user?.id || saving) return;

    const nextDesiredRole = normalizeDesiredRole(desiredRoleInput);
    if (!nextDesiredRole) {
      setErrorMsg("Renseigne le poste recherche pour continuer.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const nextOnboarding = mergeJobRadarOnboardingState(onboardingState, {
      profile: {
        desiredRole: nextDesiredRole,
      },
    });

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: session.user.id,
          jobradar_onboarding: nextOnboarding,
        },
        { onConflict: "user_id" }
      );

    setSaving(false);

    if (error) {
      setErrorMsg("Impossible d'enregistrer ton poste recherche pour le moment.");
      return;
    }

    setOnboardingState(nextOnboarding);
    setDesiredRoleInput(nextDesiredRole);

    if (location.pathname.startsWith("/jobradar/onboarding")) {
      navigate("/jobradar/feed", { replace: true });
    }
  }

  if (sessionLoading || loading) {
    return <GateLoader />;
  }

  if (!needsDesiredRole) {
    return <>{children}</>;
  }

  return (
    <div className="desiredRoleGate">
      <div className="desiredRoleGate__panel">
        <img className="desiredRoleGate__logo" src={go4jobLogo} alt="Go4Job" />
        <div className="desiredRoleGate__eyebrow">Configuration rapide</div>
        <h1 className="desiredRoleGate__title">Quel poste recherches-tu ?</h1>
        <p className="desiredRoleGate__body">
          Une seule information nous manque pour t'ouvrir le produit avec un ciblage plus fiable.
        </p>

        <form className="desiredRoleGate__form" onSubmit={handleSubmit}>
          <label className="desiredRoleGate__field">
            Poste recherche
            <input
              className="desiredRoleGate__input"
              value={desiredRoleInput}
              onChange={(event) => setDesiredRoleInput(event.target.value)}
              placeholder="Ex : Data Analyst"
              autoFocus
              autoComplete="organization-title"
              spellCheck={false}
            />
          </label>

          {errorMsg ? <div className="desiredRoleGate__error">{errorMsg}</div> : null}

          <button className="desiredRoleGate__submit" type="submit" disabled={saving}>
            {saving ? "Enregistrement..." : "Continuer"}
          </button>
        </form>
      </div>
    </div>
  );
}
