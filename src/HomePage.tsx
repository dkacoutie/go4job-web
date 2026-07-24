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
  const [hasCv, setHasCv] = useState<boolean | null>(null);

  const [appsCount, setAppsCount] = useState(0);
  const [appsLoading, setAppsLoading] = useState(true);

  const [alertsCount, setAlertsCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

  const profileStatus = useMemo(() => {
    if (!profile) return "À compléter";
    return profile.full_name?.trim() ? "OK" : "À compléter";
  }, [profile]);

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

      // Les 4 sections (profil, candidatures, alertes, CV) sont indépendantes
      // les unes des autres : aucune n'a besoin du résultat d'une autre pour
      // s'afficher. Seule l'étape "créer le profil s'il n'existe pas" dépend
      // de la lecture du profil, donc elle reste séquentielle À L'INTÉRIEUR de
      // loadProfile(). Les 4 fonctions tournent en parallèle via
      // Promise.allSettled (pas Promise.all) pour qu'un échec sur l'une
      // n'empêche pas les autres cartes de s'afficher normalement — chacune
      // gère déjà son propre état de chargement/erreur.

      const loadProfile = async () => {
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, phone, location, headline")
          .eq("user_id", userId)
          .maybeSingle();

        if (profErr) {
          setErrorMsg((m) => m ?? GENERIC_SERVER_ERROR);
          setProfileLoading(false);
          return;
        }

        if (!prof) {
          const { data: created, error: upsertErr } = await supabase
            .from("profiles")
            .upsert(
              { user_id: userId, full_name: null, phone: null, location: null, headline: null },
              { onConflict: "user_id" },
            )
            .select("user_id, full_name, phone, location, headline")
            .single();

          if (upsertErr) {
            setErrorMsg((m) => m ?? GENERIC_SERVER_ERROR);
            setProfileLoading(false);
            return;
          }

          setProfile(created as Profile);
        } else {
          setProfile(prof as Profile);
        }

        setProfileLoading(false);
      };

      const loadApplications = async () => {
        const { count: cApps, error: appsErr } = await supabase
          .from("applications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);

        if (appsErr) setErrorMsg((m) => m ?? GENERIC_SERVER_ERROR);
        setAppsCount(cApps ?? 0);
        setAppsLoading(false);
      };

      const loadAlerts = async () => {
        const { count: cAlerts, error: alertsErr } = await supabase
          .from("alerts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);

        if (alertsErr) setErrorMsg((m) => m ?? GENERIC_SERVER_ERROR);
        setAlertsCount(cAlerts ?? 0);
        setAlertsLoading(false);
      };

      const loadCv = async () => {
        try {
          const { data: cvData, error: cvErr } = await supabase.functions.invoke("cv_save", {
            body: { action: "get_active" },
          });
          if (cvErr) {
            setHasCv(null);
          } else {
            setHasCv(Boolean(cvData?.ok && cvData?.data));
          }
        } catch {
          setHasCv(null);
        }
      };

      await Promise.allSettled([loadProfile(), loadApplications(), loadAlerts(), loadCv()]);
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

  const profileComplete = Boolean(profile?.full_name?.trim() && profile?.location?.trim());
  const alertsReady = alertsCount > 0;
  const savedEnough = appsCount >= 3;
  const hasCvReady = hasCv === true;

  return (
    <div className="home-shell">
      <main className="home-main">
        <section className="heroCard">
          <h1 className="heroTitle">Bienvenue</h1>
          <p className="heroSub">
            Tu es connecté en tant que <b>{session?.user.email ?? "-"}</b>.
            <br />
            Prochaine étape : construire ton profil et suivre tes candidatures.
          </p>
        </section>

        {errorMsg && <div className="home-error">Erreur : {errorMsg}</div>}

        <section className="onboard-card">
          <div className="onboard-head">
            <div>
              <div className="onboard-title">Commencer ici</div>
              <div className="onboard-sub">Plus ton profil est complet, plus les offres recommandées sont précises.</div>
            </div>
            <button className="btn btnGhost btnPill" type="button" onClick={() => navigate("/jobradar/feed")}>
              Explorer les offres
            </button>
          </div>

          <div className="onboard-list">
            <button
              className={`onboard-item ${profileComplete ? "done" : ""}`}
              type="button"
              onClick={() => navigate("/jobradar/profile")}
            >
              <span className="onboard-check">{profileComplete ? "✓" : "•"}</span>
              <span className="onboard-label">Compléter mon profil</span>
              <span className="onboard-status">{profileComplete ? "OK" : "À faire"}</span>
            </button>

            <button
              className={`onboard-item ${hasCvReady ? "done" : ""}`}
              type="button"
              onClick={() => navigate("/me/cv")}
            >
              <span className="onboard-check">{hasCvReady ? "✓" : "•"}</span>
              <span className="onboard-label">Ajouter mon CV</span>
              <span className="onboard-status">{hasCvReady ? "OK" : "À faire"}</span>
            </button>

            <button
              className={`onboard-item ${alertsReady ? "done" : ""}`}
              type="button"
              onClick={() => navigate("/jobradar/alerts")}
            >
              <span className="onboard-check">{alertsReady ? "✓" : "•"}</span>
              <span className="onboard-label">Créer ma première alerte</span>
              <span className="onboard-status">{alertsReady ? "OK" : "À faire"}</span>
            </button>

            <button className="onboard-item" type="button" onClick={() => navigate("/jobradar/feed")}>
              <span className="onboard-check">•</span>
              <span className="onboard-label">Explorer les offres</span>
              <span className="onboard-status">Découvrir</span>
            </button>

            <button
              className={`onboard-item ${savedEnough ? "done" : ""}`}
              type="button"
              onClick={() => navigate("/jobradar/applications")}
            >
              <span className="onboard-check">{savedEnough ? "✓" : "•"}</span>
              <span className="onboard-label">Sauvegarder 3 offres</span>
              <span className="onboard-status">{savedEnough ? "OK" : `${appsCount}/3`}</span>
            </button>
          </div>
        </section>

        <section className="grid">
          <div className="card" {...makeCardProps("/jobradar/profile")} aria-label="Ouvrir mon profil">
            <div className="cardTitle">Profil</div>
            <p className="cardValue">{profileLoading ? "Chargement..." : profileStatus}</p>
          </div>

          <div className="card" {...makeCardProps("/jobradar/applications")} aria-label="Ouvrir mes candidatures">
            <div className="cardTitle">Candidatures</div>
            <p className="cardValue">{appsLoading ? "..." : appsCount}</p>
          </div>

          <div className="card" {...makeCardProps("/jobradar/alerts")} aria-label="Ouvrir mes alertes">
            <div className="cardTitle">Alertes</div>
            <p className="cardValue">{alertsLoading ? "..." : alertsCount}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
