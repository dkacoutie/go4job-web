import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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

type FileMeta = {
  name: string;
  size: number;
  type: string;
};

function formatBytes(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(v) / Math.log(k));
  return `${(v / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "_");
}

export default function MyCvPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [label, setLabel] = useState("CV");
  const [cvText, setCvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CvExtractResponse | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);

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
      .select("id,label,cv_text,cv_json,skills,skills_by_category,contact,is_active,updated_at,file_path,file_name,file_size,mime_type")
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
        skills_by_category: (data as any).skills_by_category ?? undefined,
        sections: (data as any).cv_json?.sections ?? undefined,
        stats: (data as any).cv_json?.stats ?? undefined,
      });

      const name = (data as any).file_name as string | undefined;
      const size = (data as any).file_size as number | undefined;
      const type = (data as any).mime_type as string | undefined;
      if (name && size) setFileMeta({ name, size, type: type ?? "" });
    }
  }

  useEffect(() => {
    if (userId) loadActiveCv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function uploadCvFile(f: File) {
    if (!userId) return null;
    const safeName = safeFileName(f.name || "cv");
    const path = `${userId}/${Date.now()}_${safeName}`;

    const { error } = await supabase.storage
      .from("cvs")
      .upload(path, f, { upsert: true, contentType: f.type || "application/octet-stream" });

    if (error) throw error;
    return {
      file_path: path,
      file_name: f.name,
      file_size: f.size,
      mime_type: f.type || "application/octet-stream",
    };
  }

  async function analyzeAndSave() {
    if (!userId) return;

    setBusy(true);
    setErr(null);

    try {
      let text = cvText.trim();
      let fileText = "";
      let fileInfo: any = null;

      const { data: existing, error: exErr } = await supabase
        .from("user_cvs")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (exErr) throw exErr;

      if (file) {
        fileInfo = await uploadCvFile(file);
        try {
          fileText = (await file.text()) ?? "";
        } catch {
          fileText = "";
        }
      }

      if ((!text || text.length < 50) && fileText.trim().length >= 50) {
        text = fileText.trim();
      }

      if (!text || text.length < 50) {
        // store file metadata even if text extraction failed
        if (fileInfo) {
          const payload = {
            label,
            cv_text: text || null,
            cv_json: {},
            skills: [],
            skills_by_category: {},
            contact: {},
            ...fileInfo,
          };

          if (existing?.id) {
            await supabase.from("user_cvs").update(payload).eq("id", existing.id);
          } else {
            await supabase.from("user_cvs").insert({
              user_id: userId,
              is_active: true,
              ...payload,
            });
          }
        }
        throw new Error("Impossible de lire le texte du CV. Si c'est un PDF scanne, colle le texte manuellement.");
      }

      const { data, error } = await supabase.functions.invoke("cv_extract", {
        body: { cv_text: text },
      });

      if (error) throw error;

      const parsed = data as CvExtractResponse;
      setResult(parsed);

      const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
      const skillsByCategory = parsed?.skills_by_category ?? {};
      const contact = parsed?.contact ?? {};
      const cvJson = {
        sections: parsed?.sections ?? {},
        stats: parsed?.stats ?? {},
      };

      const payload = {
        label,
        cv_text: text,
        cv_json: cvJson,
        skills,
        skills_by_category: skillsByCategory,
        contact,
        ...(fileInfo ?? {}),
      };

      if (existing?.id) {
        const { error: upErr } = await supabase.from("user_cvs").update(payload).eq("id", existing.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from("user_cvs").insert({
          user_id: userId,
          is_active: true,
          ...payload,
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
        const { error } = await supabase.from("user_cvs").update({ is_active: false }).eq("id", existing.id);
        if (error) throw error;
      }

      setCvText("");
      setResult(null);
      setFile(null);
      setFileMeta(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) setFileMeta({ name: f.name, size: f.size, type: f.type || "" });
    else setFileMeta(null);
  }

  const hasSkillsByCat = Boolean(
    result?.skills_by_category &&
      Object.values(result.skills_by_category).some((arr) => Array.isArray(arr) && arr.length > 0)
  );

  if (loading) return null;

  return (
    <div className="mycv-shell">
      <div className="mycv-top">
        <div className="mycv-title">
          <button className="btn btnGhost" type="button" onClick={() => navigate("/")}>
            ← Retour
          </button>
          <h1>Mon CV</h1>
        </div>
      </div>

      <p className="mycv-subtitle">
        Importe ton CV (PDF/TXT) ou colle le texte. Clique <b>Analyser & enregistrer</b> pour extraire tes competences.
      </p>

      <div className="mycv-grid">
        {/* LEFT: editor */}
        <div className="card">
          <div className="field">
            <label className="label">Nom/Label du CV</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="field">
            <label className="label">Importer un fichier CV (PDF/TXT)</label>
            <input className="input mycv-file" type="file" accept=".pdf,.txt" onChange={onFileChange} />
            {fileMeta && (
              <div className="file-meta">
                <span>{fileMeta.name}</span>
                <span>• {formatBytes(fileMeta.size)}</span>
                {fileMeta.type ? <span>• {fileMeta.type}</span> : null}
                <button className="btn btnGhost btnSm" type="button" onClick={() => { setFile(null); setFileMeta(null); }}>
                  Retirer
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label className="label">CV (texte)</label>
            <textarea
              className="textarea"
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              placeholder="Colle ton CV ici (texte brut)..."
            />
          </div>

          <div className="actions-row">
            <div className="actions-left">
              <span className="muted">
                {chars} caracteres · {lines} lignes
              </span>

              <button className="btn btnGhost" type="button" onClick={loadActiveCv} disabled={busy}>
                Recharger
              </button>

              <button className="btn btnGhost" type="button" onClick={archiveActiveCv} disabled={busy}>
                Archiver
              </button>
            </div>

            <div className="actions-right">
              <button className="btn btnPrimary" type="button" onClick={analyzeAndSave} disabled={busy}>
                {busy ? "Analyse..." : "Analyser & enregistrer"}
              </button>
            </div>
          </div>

          {err && <div className="alert">{err}</div>}
          <div className="small">Astuce : si le PDF est scanne, colle le texte manuellement.</div>
        </div>

        {/* RIGHT: results */}
        <div className="card">
          <h3>Contact detecte</h3>
          <div className="kv">
            <div>
              <b>Email :</b> {result?.contact?.email ?? "—"}
            </div>
            <div>
              <b>Telephone :</b> {result?.contact?.phone ?? "—"}
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>Competences extraites</h3>
          {hasSkillsByCat ? (
            <div className="skills-grid">
              {([
                ["hard", "Domaines"],
                ["tools", "Outils"],
                ["soft", "Soft skills"],
                ["languages", "Langues"],
                ["other", "Autres"],
              ] as const).map(([key, label]) => {
                const items = result?.skills_by_category?.[key] ?? [];
                if (!items.length) return null;
                return (
                  <div className="skills-col" key={key}>
                    <div className="skills-title">{label}</div>
                    <div className="pills">
                      {items.map((s, i) => (
                        <span className="pill" key={`${key}-${s}-${i}`}>{s}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="pills">
              {(result?.skills ?? []).length === 0 && <span className="muted">—</span>}
              {(result?.skills ?? []).map((s, i) => (
                <span className="pill" key={`${s}-${i}`}>{s}</span>
              ))}
            </div>
          )}

          <div className="small" style={{ marginTop: 10 }}>
            Ces infos servent a ameliorer le score de matching.
          </div>

          <h3 style={{ marginTop: 16 }}>Stats</h3>
          <div className="kv">
            <div>
              <b>Texte colle :</b> {result?.stats?.chars ?? chars} caracteres · {result?.stats?.lines ?? lines} lignes
            </div>
            <div>
              <b>Analyse :</b> {result?.stats?.chars ?? chars} caracteres · {result?.stats?.lines ?? lines} lignes
            </div>
            <div>
              <b>Experience estimee :</b> —
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
