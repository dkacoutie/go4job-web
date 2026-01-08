import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./HomePage.css";

type Profile = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
};

export default function HomePage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [appsCount, setAppsCount] = useState(0);
  const [appsLoading, setAppsLoading] = useState(true);

  const [alertsCount, setAlertsCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(true);

  const profileStatus = useMemo(() => {
    if (!profile) return "À compléter";
    return profile.full_name?.trim() ? "OK" : "À compléter";
  }, [profile]);

  // Si pas connecté → /auth
  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      queueMicrotask(() => {
        setProfileLoading(false);
        setAppsLoading(false);
        setAlertsLoading(false);
      });
      return;
    }

    async function loadAll() {
      setErrorMsg(null);
      setProfileLoading(true);
      setAppsLoading(true);
      setAlertsLoading(true);

      // 1) Profil
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, phone, location, headline")
        .eq("user_id", userId)
        .maybeSingle();

      if (profErr) {
        setErrorMsg(profErr.message);
        setProfileLoading(false);
        setAppsLoading(false);
        setAlertsLoading(false);
        return;
      }

      // si profil inexistant → le créer
      if (!prof) {
        const { data: created, error: upsertErr } = await supabase
          .from("profiles")
          .upsert(
            { user_id: userId, full_name: null, phone: null, location: null, headline: null },
            { onConflict: "user_id" }
          )
          .select("user_id, full_name, phone, location, headline")
          .single();

        if (upsertErr) {
          setErrorMsg(upsertErr.message);
          setProfileLoading(false);
          setAppsLoading(false);
          setAlertsLoading(false);
          return;
        }

        setProfile(created as Profile);
      } else {
        setProfile(prof as Profile);
      }

      setProfileLoading(false);

      // 2) Compteur candidatures
      const { count: cApps, error: appsErr } = await supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (appsErr) setErrorMsg((m) => m ?? appsErr.message);
      setAppsCount(cApps ?? 0);
      setAppsLoading(false);

      // 3) Compteur alertes
      const { count: cAlerts, error: alertsErr } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (alertsErr) setErrorMsg((m) => m ?? alertsErr.message);
      setAlertsCount(cAlerts ?? 0);
      setAlertsLoading(false);
    }

    loadAll();
  }, [loading, userId, navigate]);

  const makeCardProps = (to: string) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => navigate(to),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        navigate(to);
      }
    },
  });

  return (
    <div className="home-shell">
      <main className="home-main">
        <section className="heroCard">
          <h1 className="heroTitle">Bienvenue 👋</h1>
          <p className="heroSub">
            Tu es connecté en tant que <b>{session?.user.email ?? "—"}</b>.
            <br />
            Prochaine étape : construire ton profil et suivre tes candidatures.
          </p>
        </section>

        {errorMsg && (
          <div className="home-error">
            Erreur : {errorMsg}
          </div>
        )}

        <section className="grid">
          <div className="card" {...makeCardProps("/jobradar/profile")} aria-label="Ouvrir mon profil">
            <div className="cardTitle">Profil</div>
            <p className="cardValue">{profileLoading ? "Chargement..." : profileStatus}</p>
          </div>

          <div className="card" {...makeCardProps("/jobradar/applications")} aria-label="Ouvrir mes candidatures">
            <div className="cardTitle">Candidatures</div>
            <p className="cardValue">{appsLoading ? "…" : appsCount}</p>
          </div>

          <div className="card" {...makeCardProps("/jobradar/alerts")} aria-label="Ouvrir mes alertes">
            <div className="cardTitle">Alertes</div>
            <p className="cardValue">{alertsLoading ? "…" : alertsCount}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
