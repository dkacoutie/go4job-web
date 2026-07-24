import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import OnboardingStepper from "./components/OnboardingStepper";
import { supabase } from "./lib/supabaseClient";
import { trackProfileCompleted } from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { NextStepCard } from "./components/GuidedUI";
import { useToast } from "./components/ToastCenter";
import "./ProfilePage.css";

type Profile = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  location: string | null;
  country_code?: string | null;
  headline: string | null;
  experience_years: number | null;
  cv_file_path?: string | null;
  cv_filename?: string | null;
  cv_updated_at?: string | null;
};

const COUNTRIES = [
  { code: "CI", name: "Côte d’Ivoire", dial: "+225" },
  { code: "SN", name: "Sénégal", dial: "+221" },
  { code: "BF", name: "Burkina Faso", dial: "+226" },
  { code: "ML", name: "Mali", dial: "+223" },
  { code: "BJ", name: "Bénin", dial: "+229" },
  { code: "TG", name: "Togo", dial: "+228" },
  { code: "GH", name: "Ghana", dial: "+233" },
  { code: "NG", name: "Nigeria", dial: "+234" },
  { code: "CM", name: "Cameroun", dial: "+237" },
  { code: "MA", name: "Maroc", dial: "+212" },
  { code: "TN", name: "Tunisie", dial: "+216" },
  { code: "DZ", name: "Algérie", dial: "+213" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "BE", name: "Belgique", dial: "+32" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "US", name: "États-Unis", dial: "+1" },
  { code: "GB", name: "Royaume-Uni", dial: "+44" },
] as const;

const MAX_CV_MB = 8;
const ALLOWED_EXT = ["pdf", "docx"];

function parseLocation(raw: string | null) {
  if (!raw) return { city: "", countryCode: "CI" };

  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[0];
    const countryName = parts.slice(1).join(" / ");
    const found = COUNTRIES.find((c) => c.name.toLowerCase() === countryName.toLowerCase());
    return { city, countryCode: found?.code ?? "CI" };
  }

  return { city: raw.trim(), countryCode: "CI" };
}

function normalizeSkillLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseSkills(raw: string | null) {
  if (!raw) return [] as string[];
  return raw
    .split(/[,;\n•]/)
    .map((s) => normalizeSkillLabel(s))
    .filter(Boolean)
    .slice(0, 20);
}

function formatSkills(skills: string[]) {
  return skills.join(", ");
}

function normalizePhone(v: string) {
  return v.replace(/[^\d]/g, "").slice(0, 20);
}

function normalizeExperience(v: string) {
  return v.replace(/[^\d]/g, "").slice(0, 2);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, loading } = useSession();
  const { pushToast } = useToast();
  const userId = session?.user?.id;
  const onboardingFlow = searchParams.get("flow") === "onboarding";
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cvUploading, setCvUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [alertsCount, setAlertsCount] = useState(0);
  const [nextStep, setNextStep] = useState<{
    title: string;
    message: string;
    primary: { label: string; to?: string; onClick?: () => void };
    secondary?: { label: string; to?: string; onClick?: () => void };
    tone?: "info" | "success";
  } | null>(null);

  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState<string>("CI");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [experienceYears, setExperienceYears] = useState("");

  const [cvFilePath, setCvFilePath] = useState<string | null>(null);
  const [cvFilename, setCvFilename] = useState<string | null>(null);
  const [cvUpdatedAt, setCvUpdatedAt] = useState<string | null>(null);
  const cvInputRef = useRef<HTMLInputElement | null>(null);
  // Complétude du profil telle que chargée depuis la base, pour ne déclencher
  // profile_completed que sur une vraie transition incomplet -> complet, pas
  // à chaque enregistrement d'un profil déjà complet.
  const wasCompleteOnLoadRef = useRef<boolean | null>(null);

  const selectedCountry = useMemo(
    () => COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0],
    [countryCode]
  );

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      if (!userId) return;

      setPageLoading(true);
      setErrorMsg(null);

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "user_id, full_name, phone, location, country_code, headline, experience_years, cv_file_path, cv_filename, cv_updated_at"
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setErrorMsg(GENERIC_SERVER_ERROR);
        setPageLoading(false);
        return;
      }

      const p = (data ?? null) as Profile | null;

      setFullName(p?.full_name ?? "");
      setPhone(p?.phone ?? "");

      const loc = parseLocation(p?.location ?? null);
      setCity(loc.city);
      setCountryCode(p?.country_code ?? loc.countryCode);

      setSkills(parseSkills(p?.headline ?? null));
      setExperienceYears(
        typeof p?.experience_years === "number" && Number.isFinite(p.experience_years)
          ? String(p.experience_years)
          : ""
      );

      setCvFilePath(p?.cv_file_path ?? null);
      setCvFilename(p?.cv_filename ?? null);
      setCvUpdatedAt(p?.cv_updated_at ?? null);

      const loadedExpMissing = !(
        typeof p?.experience_years === "number" && Number.isFinite(p.experience_years)
      ) && !p?.cv_file_path;
      wasCompleteOnLoadRef.current = Boolean(
        p?.full_name?.trim() && loc.city.trim() && parseSkills(p?.headline ?? null).length > 0 && !loadedExpMissing
      );

      setPageLoading(false);
    }

    if (!loading) loadProfile();

    return () => {
      mounted = false;
    };
  }, [loading, userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { count } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      setAlertsCount(count ?? 0);
    })();
  }, [userId]);

  function addSkillsFromInput(value: string) {
    const parts = value
      .split(/[,;\n]/)
      .map((s) => normalizeSkillLabel(s))
      .filter(Boolean);
    if (!parts.length) return;

    setSkills((prev) => {
      const next = [...prev];
      for (const p of parts) {
        if (!next.some((s) => s.toLowerCase() === p.toLowerCase())) {
          next.push(p);
        }
      }
      return next.slice(0, 20);
    });
    setSkillInput("");
  }

  async function uploadCv(file: File) {
    if (!userId) return;
    setCvError(null);

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXT.includes(ext)) {
      setCvError("Format non supporté. Utilise uniquement PDF ou DOCX.");
      return;
    }

    if (file.size > MAX_CV_MB * 1024 * 1024) {
      setCvError(`Fichier trop volumineux. Maximum ${MAX_CV_MB} MB.`);
      return;
    }

    setCvUploading(true);

    const previousPath = cvFilePath;
    const path = `${userId}/cv-${Date.now()}.${ext}`;

    try {
      const { error: uploadErr } = await supabase.storage
        .from("cvs")
        .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });

      if (uploadErr) throw uploadErr;

      const updatedAt = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          cv_file_path: path,
          cv_filename: file.name,
          cv_updated_at: updatedAt,
        })
        .eq("user_id", userId);

      if (updateErr) {
        await supabase.storage.from("cvs").remove([path]);
        throw updateErr;
      }

      if (previousPath && previousPath !== path) {
        await supabase.storage.from("cvs").remove([previousPath]);
      }

      setCvFilePath(path);
      setCvFilename(file.name);
      setCvUpdatedAt(updatedAt);
      pushToast({
        kind: "success",
        title: "CV téléversé",
        message: "Ton CV est bien enregistré et synchronisé.",
      });
    } catch (e: any) {
      setCvError("Impossible d’envoyer ce CV. Réessaie avec un fichier plus léger.");
      pushToast({
        kind: "error",
        title: "Téléversement échoué",
        message: e?.message ?? "Réessaie dans quelques instants.",
      });
    } finally {
      setCvUploading(false);
    }
  }

  async function handleViewCv() {
    if (!cvFilePath) return;

    const { data, error } = await supabase.storage.from("cvs").createSignedUrl(cvFilePath, 60);
    if (error || !data?.signedUrl) {
      pushToast({
        kind: "error",
        title: "Impossible d’ouvrir le CV",
        message: "Réessaie dans quelques instants.",
      });
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDeleteCv() {
    if (!userId || !cvFilePath) return;
    setCvError(null);
    setCvUploading(true);

    try {
      await supabase.storage.from("cvs").remove([cvFilePath]);
      const { error } = await supabase
        .from("profiles")
        .update({ cv_file_path: null, cv_filename: null, cv_updated_at: null })
        .eq("user_id", userId);

      if (error) throw error;

      setCvFilePath(null);
      setCvFilename(null);
      setCvUpdatedAt(null);
      pushToast({
        kind: "success",
        title: "CV supprimé",
        message: "Le CV a bien été retiré de ton profil.",
      });
    } catch (e: any) {
      setCvError("Impossible de supprimer le CV pour le moment.");
      pushToast({
        kind: "error",
        title: "Suppression échouée",
        message: e?.message ?? "Réessaie dans quelques instants.",
      });
    } finally {
      setCvUploading(false);
    }
  }

  function focusFirstMissing() {
    const missingId = !fullName.trim()
      ? "profile-fullname"
      : !city.trim()
      ? "profile-city"
      : skills.length === 0
      ? "profile-skills"
      : !experienceYears.trim() && !cvFilePath
      ? "profile-experience"
      : null;

    if (!missingId) return;
    const el = document.getElementById(missingId) as HTMLInputElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

  async function save() {
    if (!userId) return;

    setSaving(true);
    setErrorMsg(null);
    setNextStep(null);

    const countryName = selectedCountry?.name ?? "";
    const cityValue = city.trim();
    const locationValue =
      cityValue && countryName ? `${cityValue} / ${countryName}` : (cityValue || countryName || null);
    const expValue = experienceYears.trim() ? Number(experienceYears) : null;
    const expClean = Number.isFinite(expValue) && expValue != null ? Math.max(0, expValue) : null;
    const headlineValue = formatSkills(skills);

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          location: locationValue,
          country_code: countryCode || null,
          headline: headlineValue || null,
          experience_years: expClean,
        },
        { onConflict: "user_id" }
      );

    setSaving(false);

    if (error) {
      setErrorMsg(GENERIC_SERVER_ERROR);
      pushToast({
        kind: "error",
        title: "Impossible d’enregistrer le profil",
        message: "Réessaie dans quelques instants.",
      });
      return;
    }

    pushToast({
      kind: "success",
      title: "Profil mis à jour",
      message: "Tes prochaines offres recommandées seront mieux adaptées à ton profil.",
    });

    const expMissing = !experienceYears.trim() && !cvFilePath;
    const incomplete = !fullName.trim() || !city.trim() || skills.length === 0 || expMissing;

    if (!incomplete && wasCompleteOnLoadRef.current === false) {
      trackProfileCompleted();
    }
    wasCompleteOnLoadRef.current = !incomplete;

    if (incomplete) {
      setNextStep({
        title: onboardingFlow ? "Encore un petit effort sur le profil" : "Profil enregistré (incomplet)",
        message: onboardingFlow
          ? "Complète les points restants pour continuer ton démarrage JobRadar."
          : "Ajoute tes compétences, ta localisation et ton expérience pour améliorer la pertinence des offres.",
        primary: { label: "Continuer la configuration", onClick: () => focusFirstMissing() },
        secondary: onboardingFlow
          ? { label: "Revenir au parcours", to: "/jobradar/onboarding?step=complete-profile" }
          : { label: "Voir mes offres quand même", to: "/jobradar/feed" },
        tone: "info",
      });
      return;
    }

    if (!cvFilePath) {
      setNextStep({
        title: onboardingFlow ? "Étape suivante : ton CV" : "Prochaine étape recommandée",
        message: onboardingFlow
          ? "Ton profil est prêt. Passe au CV pour obtenir des offres mieux ciblées avant d’activer tes alertes."
          : "Ajoute ton CV pour améliorer encore la précision des offres recommandées.",
        primary: onboardingFlow
          ? { label: "Continuer vers le CV", to: "/me/cv?flow=onboarding" }
          : { label: "Ajouter mon CV", onClick: () => cvInputRef.current?.click() },
        secondary: onboardingFlow
          ? { label: "Retour au parcours", to: "/jobradar/onboarding?step=cv" }
          : { label: "Voir mes offres mises à jour", to: "/jobradar/feed" },
        tone: "info",
      });
      return;
    }

    if (alertsCount === 0) {
      setNextStep({
        title: onboardingFlow ? "Dernière étape : les alertes" : "Prochaine étape recommandée",
        message: onboardingFlow
          ? "Parfait. Active maintenant ta première alerte pour terminer ton parcours."
          : "Crée une alerte pour recevoir des offres plus ciblées.",
        primary: { label: "Créer une alerte", to: onboardingFlow ? "/jobradar/alerts?flow=onboarding" : "/jobradar/alerts" },
        secondary: onboardingFlow
          ? { label: "Retour au parcours", to: "/jobradar/onboarding?step=alerts" }
          : { label: "Voir mes offres mises à jour", to: "/jobradar/feed" },
        tone: "info",
      });
      return;
    }

    if (onboardingFlow) {
      setNextStep({
        title: "Profil prêt",
        message: "Ton profil, ton CV et tes alertes sont prêts. Tu peux maintenant ouvrir tes offres au quotidien.",
        primary: { label: "Ouvrir mes offres", to: "/jobradar/feed" },
        secondary: { label: "Revenir au parcours", to: "/jobradar/onboarding?step=alerts" },
        tone: "success",
      });
    }
  }

  const expMissing = !experienceYears.trim() && !cvFilePath;
  const isIncomplete = !fullName.trim() || !city.trim() || skills.length === 0 || expMissing;

  const checklist = [
    { key: "name", label: "Nom", done: Boolean(fullName.trim()) },
    { key: "location", label: "Localisation", done: Boolean(city.trim()) },
    { key: "skills", label: "Compétences", done: skills.length > 0 },
    { key: "experience", label: "Expérience", done: !expMissing },
    { key: "phone", label: "Téléphone", done: Boolean(phone.trim()) },
    { key: "cv", label: "CV", done: Boolean(cvFilePath) },
  ];

  const completed = checklist.filter((item) => item.done).length;
  const completionPercent = Math.round((completed / checklist.length) * 100);

  return (
    <div className="profile-shell">
      <main className="profile-main">
        <section className="profile-card">
          {onboardingFlow && (
            <div style={{ marginBottom: 18 }}>
              <OnboardingStepper currentStep="complete-profile" completedSteps={["profile", "preferences", "preview", "unlock"]} compact />
            </div>
          )}
          <div className="profile-head">
            <div>
              <h1 className="profile-title">Mon profil</h1>
              <p className="profile-sub">
                Complète tes informations pour obtenir des offres mieux ciblées et accélérer tes candidatures.
              </p>
            </div>
            <button className="btn btnGhost profile-backBtn" onClick={() => navigate(onboardingFlow ? "/jobradar/onboarding?step=complete-profile" : "/")}>Retour</button>
          </div>

          {pageLoading ? (
            <div className="profile-loading">Chargement…</div>
          ) : (
            <div className="formGrid">
              <div className="profile-info">
                <div>
                  <div className="profile-info__title">Complète ton profil pour améliorer la pertinence des offres</div>
                  <div className="profile-info__text">
                    Quelques informations (compétences, localisation, expérience, CV) permettent à JobRadar de mieux filtrer
                    et classer les offres.
                  </div>
                </div>
                {isIncomplete && (
                  <button className="btn btnGhost" type="button" onClick={focusFirstMissing}>
                    Compléter maintenant
                  </button>
                )}
              </div>

              <div className="profile-progress">
                <div className="profile-progress__top">
                  <div className="profile-progress__label">Profil complété : {completionPercent}%</div>
                  <div className="profile-progress__value">
                    {completed}/{checklist.length}
                  </div>
                </div>
                <div className="profile-progress__bar">
                  <span style={{ width: `${completionPercent}%` }} />
                </div>
                <div className="profile-checklist">
                  {checklist.map((item) => (
                    <div className={`profile-check ${item.done ? "done" : ""}`} key={item.key}>
                      <span className="profile-check__icon">{item.done ? "✓" : "•"}</span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <label className="field">
                Nom complet
                <input
                  id="profile-fullname"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: KACOUTIE AFFALY Dieudonné"
                />
              </label>

              <div className="row">
                <label className="field">
                  Pays
                  <select className="input" value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.dial})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Ville
                  <input
                    id="profile-city"
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ex: Abidjan"
                  />
                  <div className="fieldHelp">Indique ta ville/pays pour améliorer les offres locales.</div>
                </label>
              </div>

              <label className="field">
                Téléphone (numéro local)
                <div className="phoneRow">
                  <div className="dialPill" title="Indicatif pays">
                    {selectedCountry.dial}
                  </div>
                  <input
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(normalizePhone(e.target.value))}
                    inputMode="numeric"
                    placeholder="Ex: 0151676767"
                  />
                </div>
                <div className="fieldHelp">Utilisé pour ton profil / contact si nécessaire.</div>
              </label>

              <label className="field">
                Compétences
                <div className="skills-input">
                  <div className="pills">
                    {skills.length === 0 && <span className="muted">Ajoute 2-4 compétences clés.</span>}
                    {skills.map((skill, index) => (
                      <span className="pill pill-edit" key={`${skill}-${index}`}>
                        {skill}
                        <button
                          className="pill-remove"
                          type="button"
                          onClick={() => setSkills((prev) => prev.filter((_, i) => i !== index))}
                          aria-label={`Supprimer ${skill}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    id="profile-skills"
                    className="input"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSkillsFromInput(skillInput);
                      }
                    }}
                    placeholder="Ex: Gestion de projet, Data, Marketing"
                  />
                  <div className="skills-actions">
                    <button className="btn btnGhost" type="button" onClick={() => addSkillsFromInput(skillInput)}>
                      Ajouter
                    </button>
                  </div>
                </div>
                <div className="fieldHelp">Ces compétences aident JobRadar à recommander des offres plus adaptées.</div>
              </label>

              <label className="field">
                Expérience (années)
                <input
                  id="profile-experience"
                  className="input"
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(normalizeExperience(e.target.value))}
                  inputMode="numeric"
                  placeholder="Ex: 3"
                />
                <div className="fieldHelp">Si ton CV est présent, cette info est optionnelle.</div>
              </label>

              <div className="profile-section">
                <div className="profile-section__head">
                  <div>
                    <div className="profile-section__title">Mon CV</div>
                    <div className="profile-section__text">
                      Téléverse un PDF ou DOCX (max {MAX_CV_MB} MB). Un seul CV est gardé pour ton profil.
                    </div>
                  </div>
                  <button
                    className="btn btnGhost"
                    type="button"
                    onClick={() => cvInputRef.current?.click()}
                    disabled={cvUploading}
                  >
                    {cvFilePath ? "Remplacer" : "Téléverser mon CV"}
                  </button>
                </div>

                {!cvFilePath ? (
                  <div className="profile-cvEmpty">
                    <div className="profile-cvEmpty__title">Aucun CV ajouté</div>
                    <div className="profile-cvEmpty__text">
                      Ajoute ton CV pour améliorer la pertinence des offres recommandées et préparer tes candidatures.
                    </div>
                  </div>
                ) : (
                  <div className="profile-cvFilled">
                    <div>
                      <div className="profile-cvName">{cvFilename || "CV"}</div>
                      <div className="profile-cvMeta">
                        Mis à jour {cvUpdatedAt ? new Date(cvUpdatedAt).toLocaleDateString("fr-FR") : "—"}
                      </div>
                    </div>
                    <div className="profile-cvActions">
                      <button className="btn btnGhost" type="button" onClick={handleViewCv} disabled={cvUploading}>
                        Voir
                      </button>
                      <button className="btn btnGhost" type="button" onClick={handleDeleteCv} disabled={cvUploading}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                )}

                {cvUploading && <div className="profile-cvLoading">Téléversement en cours…</div>}
                {cvError && <div className="profile-msg profile-msgErr">{cvError}</div>}

                <input
                  ref={cvInputRef}
                  className="profile-cvInput"
                  type="file"
                  accept=".pdf,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (!f) return;
                    uploadCv(f);
                    e.currentTarget.value = "";
                  }}
                />
              </div>

              {errorMsg && <div className="profile-msg profile-msgErr">{errorMsg}</div>}

              <div className="actions">
                <button className="btn btnPrimary" onClick={save} disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>

              {nextStep && (
                <NextStepCard
                  title={nextStep.title}
                  message={nextStep.message}
                  primaryAction={nextStep.primary}
                  secondaryAction={nextStep.secondary}
                  tone={nextStep.tone ?? "info"}
                />
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
