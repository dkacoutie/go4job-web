import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./ProfilePage.css";

type Profile = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
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

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id;

  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState<string>("CI");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [headline, setHeadline] = useState("");

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
        .select("user_id, full_name, phone, location, headline")
        .eq("user_id", userId)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setErrorMsg(error.message);
        setPageLoading(false);
        return;
      }

      const p = (data ?? null) as Profile | null;

      setFullName(p?.full_name ?? "");
      setPhone(p?.phone ?? "");

      const loc = parseLocation(p?.location ?? null);
      setCity(loc.city);
      setCountryCode(loc.countryCode);

      setHeadline(p?.headline ?? "");
      setPageLoading(false);
    }

    if (!loading) loadProfile();

    return () => {
      mounted = false;
    };
  }, [loading, userId]);

  function normalizePhone(v: string) {
    // On garde seulement les chiffres, max 20
    return v.replace(/[^\d]/g, "").slice(0, 20);
  }

  async function save() {
    if (!userId) return;

    setSaving(true);
    setErrorMsg(null);
    setOkMsg(null);

    const countryName = selectedCountry?.name ?? "";
    const cityValue = city.trim();
    const locationValue =
      cityValue && countryName ? `${cityValue} / ${countryName}` : (cityValue || countryName || null);

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          location: locationValue,
          headline: headline.trim() || null,
        },
        { onConflict: "user_id" }
      );

    setSaving(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setOkMsg("Profil enregistré ✅");
  }

  return (
    <div className="profile-shell">
      <main className="profile-main">
        <section className="profile-card">
          <div className="profile-head">
            <div>
              <h1 className="profile-title">Mon profil</h1>
              <p className="profile-sub">
                Complète tes infos pour améliorer le matching et accélérer tes candidatures.
              </p>
            </div>

            <button className="btn btnGhost profile-backBtn" onClick={() => navigate("/")}>
              Retour au dashboard
            </button>
          </div>

          {pageLoading ? (
            <div className="profile-loading">Chargement…</div>
          ) : (
            <div className="formGrid">
              <label className="field">
                Nom complet
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: KACOUTIE AFFALY Dieudonné"
                />
              </label>

              <div className="row">
                <label className="field">
                  Pays
                  <select
                    className="input"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
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
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ex: Abidjan"
                  />
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
              </label>

              <label className="field">
                Titre (headline)
                <input
                  className="input"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Ex: Gestionnaire en pharmacie • Project Manager"
                />
              </label>

              {errorMsg && <div className="profile-msg profile-msgErr">{errorMsg}</div>}
              {okMsg && <div className="profile-msg profile-msgOk">{okMsg}</div>}

              <div className="actions">
                <button className="btn btnPrimary" onClick={save} disabled={saving}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
