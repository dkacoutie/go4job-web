import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./MyCvPage.css";

type CvExtractResponse = {
  ok: boolean;
  contact?: { email?: string | null; phone?: string | null };
  skills?: string[];
  skills_by_category?: {
    hard?: string[];
    soft?: string[];
    tools?: string[];
    languages?: string[];
    other?: string[];
  };
  sections?: Record<string, string>;
  stats?: { chars?: number; lines?: number };
  match?: { keyword_score?: number };
};

export default function MyCvPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [label, setLabel] = useState("CV");
  const [cvText, setCvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CvExtractResponse | null>(null);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!loading && !session) navigate("/auth");
  }, [loading, session, navigate]);

  const chars = useMemo(() => cvText.length, [cvText]);

  const lines = useMemo(() => {
    const t = cvText.trim();
    if (!t) return 0;
    return t.split(/\r\n|\r|\n/).length;
  }, [cvText]);

  async function loadActiveCv() {
    if (!userId) return;
    setErr(null);

    const { data, error } = await supabase
      .from("user_cvs")
      .select("id,label,cv_text,cv_json,skills,contact,is_active,updated_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      setErr(error.message);
      return;
    }

    if (data) {
      setLabel((data as any).label ?? "CV");
      setCvText((data as any).cv_text ?? "");
      setResult({
        ok: true,
        contact: (data as any).contact ?? {},
        skills: (data as any).skills ?? [],
        sections: (data as any).cv_json?.sections ?? undefined,
        stats: (data as any).cv_json?.stats ?? undefined
      });
    }
  }

  useEffect(() => {
    if (userId) loadActiveCv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function analyzeAndSave() {
    if (!userId) return;

    const text = cvText.trim();
    if (text.length < 50) {
      setErr("Colle un CV plus long (au moins ~50 caractères).");
      return;
    }

    setBusy(true);
    setErr(null);

    try {
      const { data, error } = await supabase.functions.invoke("cv_extract", {
        body: { cv_text: text }
      });

      if (error) throw error;

      const parsed = data as CvExtractResponse;
      setResult(parsed);

      const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
      const contact = parsed?.contact ?? {};
      const cvJson = {
        sections: parsed?.sections ?? {},
        stats: parsed?.stats ?? {}
      };

      const { data: existing, error: exErr } = await supabase
        .from("user_cvs")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.id) {
        const { error: upErr } = await supabase
          .from("user_cvs")
          .update({
            label,
            cv_text: text,
            cv_json: cvJson,
            skills,
            contact
          })
          .eq("id", existing.id);

        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from("user_cvs").insert({
          user_id: userId,
          label,
          cv_text: text,
          cv_json: cvJson,
          skills,
          contact,
          is_active: true
        });

        if (insErr) throw insErr;
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function archiveActiveCv() {
    if (!userId) return;

    const ok = confirm("Archiver le CV actif ? (Tu pourras en ajouter un autre ensuite)");
    if (!ok) return;

    setBusy(true);
    setErr(null);

    try {
      const { data: existing, error: exErr } = await supabase
        .from("user_cvs")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.id) {
        const { error } = await supabase
          .from("user_cvs")
          .update({ is_active: false })
          .eq("id", existing.id);

        if (error) throw error;
      }

      setCvText("");
      setResult(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <div className="mycv-shell">
      <div className="mycv-top">
        <div className="mycv-title">
          <button className="btn btn-secondary" type="button" onClick={() => navigate("/")}>
            ← Retour
          </button>
          <h1>Mon CV</h1>
        </div>
      </div>

      <p className="mycv-subtitle">
        Colle ton CV (texte). Clique <b>Analyser & enregistrer</b> pour extraire tes compétences et préparer le matching.
      </p>

      <div className="mycv-grid">
        {/* LEFT: editor */}
        <div className="card">
          <div className="field">
            <span className="label">Nom/Label du CV</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex: CV FR, CV EN…"
            />
          </div>

          <div className="field">
            <span className="label">CV (texte)</span>
            <textarea
              className="textarea"
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              rows={14}
              placeholder="Colle ici le texte de ton CV..."
            />
          </div>

          <div className="actions-row">
            <div className="actions-left">
              <span className="muted">
                {chars} caractères · {lines} lignes
              </span>

              <button className="btn btn-secondary" type="button" onClick={loadActiveCv} disabled={busy}>
                Recharger
              </button>

              <button className="btn btn-secondary" type="button" onClick={archiveActiveCv} disabled={busy}>
                Archiver
              </button>
            </div>

            <div className="actions-right">
              <button className="btn btn-primary" type="button" onClick={analyzeAndSave} disabled={busy}>
                {busy ? "Analyse..." : "Analyser & enregistrer"}
              </button>
            </div>
          </div>

          {err && (
            <div className="alert">
              <b>Erreur :</b> {err}
            </div>
          )}

          <div className="small" style={{ marginTop: 10 }}>
            Astuce : colle ton CV en texte brut (Word/PDF → copier-coller).
          </div>
        </div>

        {/* RIGHT: results */}
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <h3>Contact détecté</h3>
            <div className="kv">
              <div>
                <b>Email :</b> {result?.contact?.email ?? "—"}
              </div>
              <div>
                <b>Téléphone :</b> {result?.contact?.phone ?? "—"}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Compétences extraites</h3>
            <div className="pills">
              {(result?.skills ?? []).length === 0 ? (
                <span className="muted">—</span>
              ) : (
                (result?.skills ?? []).map((s) => (
                  <span key={s} className="pill">
                    {s}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Option pro : stats détectées */}
          <div className="card">
            <h3>Stats</h3>
            <div className="kv">
              <div>
                <b>Texte collé :</b> {chars} caractères · {lines} lignes
              </div>
              <div>
                <b>Analyse :</b>{" "}
                {result?.stats?.chars ?? "—"} caractères · {result?.stats?.lines ?? "—"} lignes
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
