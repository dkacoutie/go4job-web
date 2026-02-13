import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./MyCvPage.css";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

type CvExtractResponse = {
  ok: boolean;
  contact?: { email?: string | null; phone?: string | null };
  skills?: string[];
  formatted_text?: string;
  raw_text?: string;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
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

function normalizeKey(input: string) {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+.# -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromKey(input: string) {
  const cleaned = normalizeKey(input);
  if (!cleaned) return "Section";
  return cleaned
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function normalizeSkillLabel(input: string) {
  return (input ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqSkills(list: string[] | undefined) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const v = normalizeSkillLabel(raw);
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export default function MyCvPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [label, setLabel] = useState("CV");
  const [cvText, setCvText] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvFileInfo, setCvFileInfo] = useState<string>("");
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

  const skillGroups = useMemo(() => {
    const by = result?.skills_by_category ?? {};
    const groups = [
      { key: "hard", label: "Domaines" },
      { key: "tools", label: "Outils" },
      { key: "soft", label: "Soft skills" },
      { key: "languages", label: "Langues" },
      { key: "other", label: "Autres" }
    ];

    const built = groups
      .map((g) => ({
        label: g.label,
        items: uniqSkills((by as any)?.[g.key] as string[] | undefined)
      }))
      .filter((g) => g.items.length > 0);

    if (!built.length) {
      const flat = uniqSkills(result?.skills ?? []);
      if (flat.length) return [{ label: "Compétences", items: flat }];
    }

    return built;
  }, [result]);

  const structuredSections = useMemo(() => {
    const sections = result?.sections ?? {};
    const keys = Object.keys(sections);
    if (!keys.length) return [];

    const normMap = new Map<string, string>();
    for (const k of keys) normMap.set(normalizeKey(k), k);

    const used = new Set<string>();
    const out: Array<{ title: string; content: string }> = [];

    const pick = (candidates: string[], title: string) => {
      for (const c of candidates) {
        const key = normMap.get(normalizeKey(c));
        if (key && !used.has(key)) {
          const content = String((sections as any)[key] ?? "").trim();
          if (content) {
            used.add(key);
            out.push({ title, content });
            return;
          }
        }
      }
    };

    pick(["profil", "profile", "summary", "resume", "résumé", "objectif"], "Profil");
    pick(["experience", "experiences", "expérience", "expériences", "parcours"], "expériences");
    pick(["formation", "education", "etudes", "études"], "Formation");
    pick(["competences", "Compétences", "skills", "aptitudes"], "Compétences");
    pick(["langues", "languages"], "Langues");
    pick(["contact", "coordonnees", "coordonnées", "informations personnelles"], "Contact");

    for (const k of keys) {
      if (used.has(k)) continue;
      const content = String((sections as any)[k] ?? "").trim();
      if (!content) continue;
      out.push({ title: titleFromKey(k), content });
    }

    return out;
  }, [result]);

  async function loadActiveCv() {
    if (!userId) return;
    setErr(null);

    const { data, error } = await supabase
      .from("user_cvs")
      .select("id,label,cv_text,cv_json,skills,contact,is_active,updated_at,cv_file_path,cv_file_name,cv_file_type,cv_file_size")
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
      const fileName = (data as any).cv_file_name ?? "";
      const fileType = (data as any).cv_file_type ?? "";
      const fileSize = (data as any).cv_file_size ?? null;
      if (fileName) {
        setCvFileInfo(`${fileName}${fileType ? ` (${fileType})` : ""}${fileSize ? ` · ${fileSize} octets` : ""}`);
      } else {
        setCvFileInfo("");
      }
      setResult({
        ok: true,
        contact: (data as any).contact ?? {},
        skills: (data as any).skills ?? [],
        formatted_text: (data as any).cv_json?.formatted_text ?? undefined,
        raw_text: (data as any).cv_text ?? "",
        experience_years_min: (data as any).cv_json?.experience_years_min ?? null,
        experience_years_max: (data as any).cv_json?.experience_years_max ?? null,
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
      let uploaded: {
        path: string;
        name: string;
        type: string;
        size: number;
      } | null = null;

      if (cvFile) {
        const safeName = cvFile.name.replace(/[^\\w.-]/g, "_");
        const path = `${userId}/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase
          .storage
          .from("cvs")
          .upload(path, cvFile, { upsert: true, contentType: cvFile.type || "application/octet-stream" });
        if (upErr) throw upErr;
        uploaded = { path, name: cvFile.name, type: cvFile.type || "application/octet-stream", size: cvFile.size };
      }

      const { data, error } = await supabase.functions.invoke("cv_extract", {
        body: { cv_text: text, file_path: uploaded?.path ?? null }
      });

      if (error) throw error;

      const parsed = data as CvExtractResponse;
      setResult(parsed);

      const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
      const contact = parsed?.contact ?? {};
      const cvJson = {
        sections: parsed?.sections ?? {},
        stats: parsed?.stats ?? {},
        formatted_text: parsed?.formatted_text ?? null,
        experience_years_min: parsed?.experience_years_min ?? null,
        experience_years_max: parsed?.experience_years_max ?? null
      };

      const { data: existing, error: exErr } = await supabase
        .from("user_cvs")
        .select("id,cv_file_path,cv_file_name,cv_file_type,cv_file_size")
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
            contact,
            cv_file_path: uploaded?.path ?? (existing as any).cv_file_path ?? null,
            cv_file_name: uploaded?.name ?? (existing as any).cv_file_name ?? null,
            cv_file_type: uploaded?.type ?? (existing as any).cv_file_type ?? null,
            cv_file_size: uploaded?.size ?? (existing as any).cv_file_size ?? null,
            cv_updated_at: new Date().toISOString()
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
          is_active: true,
          cv_file_path: uploaded?.path ?? null,
          cv_file_name: uploaded?.name ?? null,
          cv_file_type: uploaded?.type ?? null,
          cv_file_size: uploaded?.size ?? null,
          cv_updated_at: new Date().toISOString()
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
      setCvFile(null);
      setCvFileInfo("");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  async function extractTextFromFile(file: File) {
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isText = file.type.startsWith("text/") || name.endsWith(".txt");

    if (!isPdf && !isText) {
      throw new Error("Format non supporté. Utilise PDF ou TXT.");
    }

    if (isText) {
      return await file.text();
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[]).map((it) => (it?.str ?? "")).join(" ");
      out += `${pageText}\n`;
    }
    return out.trim();
  }

  async function onSelectFile(file: File | null) {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const text = await extractTextFromFile(file);
      setCvFile(file);
      setCvFileInfo(`${file.name}${file.type ? ` (${file.type})` : ""} · ${file.size} octets`);
      setCvText(text);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

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
            <span className="label">Importer un fichier CV (PDF/TXT)</span>
            <input
              className="input"
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={(e) => onSelectFile(e.currentTarget.files?.[0] ?? null)}
              disabled={busy}
            />
            {cvFileInfo && <div className="small" style={{ marginTop: 6 }}>{cvFileInfo}</div>}
          </div>

          <div className="field">
            <span className="label">Nom/Label du CV</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex: CV FR, CV EN..."
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
            Astuce : tu peux importer un PDF/TXT ou coller le texte.
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
            <div className="microcopy">Ces infos servent à améliorer le score de matching.</div>
            {skillGroups.length === 0 ? (
              <span className="muted">—</span>
            ) : (
              <div className="skillGroups">
                {skillGroups.map((g) => (
                  <div className="skillGroup" key={g.label}>
                    <div className="skillGroupTitle">{g.label}</div>
                    <div className="pills">
                      {g.items.map((s) => (
                        <span key={`${g.label}-${s}`} className="pill">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="cardHeaderRow">
              <h3>Résumé structuré</h3>
              <span className="cardTag">Profil pour le matching</span>
            </div>
            {structuredSections.length > 0 ? (
              <div className="cvSections">
                {structuredSections.map((s) => (
                  <div className="cvSection" key={s.title}>
                    <div className="cvSectionTitle">{s.title}</div>
                    <div className="cvSectionBody">{s.content}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cvFormatted">
                {result?.formatted_text
                  ? result.formatted_text
                  : (cvText ? cvText : "—")}
              </div>
            )}
            <div className="microcopy">Ces infos servent à améliorer le score de matching.</div>
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
              <div>
                <b>Expérience estimée :</b>{" "}
                {result?.experience_years_min != null || result?.experience_years_max != null
                  ? `${result?.experience_years_min ?? result?.experience_years_max}${result?.experience_years_max && result?.experience_years_min && result?.experience_years_max !== result?.experience_years_min ? `-${result?.experience_years_max}` : ""} ans`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







