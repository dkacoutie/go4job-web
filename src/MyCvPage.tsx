import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./MyCvPage.css";

// @ts-ignore: external module has no types in build environment
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
// @ts-ignore: worker url module has no types
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker?url";
// @ts-ignore: browser bundle has no types
import * as mammoth from "mammoth/mammoth.browser";

GlobalWorkerOptions.workerSrc = pdfWorker;

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
  error?: string;
  message?: string;
};

type CvSaveResponse = {
  ok: boolean;
  data?: any;
  error?: string;
  message?: string;
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

function normalizeKey(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSkillLabel(s: string) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSkillsList(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of list || []) {
    const label = normalizeSkillLabel(raw);
    if (!label) continue;
    if (label.length > 45) continue;
    const words = label.split(" ").filter(Boolean).length;
    if (words >= 7) continue;

    const key = normalizeKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }

  return out.slice(0, 60);
}

function improveReadableText(raw: string) {
  let t = String(raw ?? "").replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  t = t.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return "";

  const lines = t.split(/\r\n|\r|\n/).length;
  const density = t.length / Math.max(1, lines);
  if (lines >= 10 && density < 180) return t;

  t = t.replace(/\s*[\u2022\u00b7]\s*/g, "\n- ");
  t = t.replace(
    /\b(PROFIL|EXPERIENCE PROFESSIONNELLE|EXP[\u00C9E]RIENCE PROFESSIONNELLE|EXPERIENCE|EXP[\u00C9E]RIENCE|FORMATION|EDUCATION|COMP[\u00C9E]TENCES|COMPETENCES|SKILLS|LANGUES|LANGUAGES|CONTACT|OBJECTIF|POSTE VISE|POSTE VIS[\u00C9E])\b\s*[:\uFF1A-]?\s*/gi,
    "\n\n$1\n",
  );
  t = t.replace(/([.!?])\s+(?=[A-Z])/g, "$1\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function stripDangerousChars(input: string) {
  return String(input ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "");
}

const SECTION_LABELS: Record<string, string> = {
  profil: "Profil",
  experience: "Experiences",
  "experience professionnelle": "Experiences",
  formation: "Formation",
  education: "Formation",
  competences: "Competences",
  skills: "Competences",
  langues: "Langues",
  languages: "Langues",
  contact: "Contact",
  body: "Resume",
};

function formatSectionTitle(raw: string) {
  const k = normalizeKey(raw);
  return SECTION_LABELS[k] ?? (raw || "Resume");
}

function isPdf(f: File) {
  return f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
}

function isDocx(f: File) {
  return (
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    f.name.toLowerCase().endsWith(".docx")
  );
}

function isTxt(f: File) {
  return f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt");
}

async function extractTextFromPdf(f: File) {
  const buf = await f.arrayBuffer();
  const pdf = await getDocument({ data: buf }).promise;
  let out = "";

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    let lastY: number | null = null;
    let lastX: number | null = null;
    let line = "";
    const lines: string[] = [];

    for (const it of content.items as any[]) {
      const str = String(it?.str ?? "").trim();
      if (!str) continue;

      const x = typeof it?.transform?.[4] === "number" ? it.transform[4] : null;
      const y = typeof it?.transform?.[5] === "number" ? it.transform[5] : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        if (line) lines.push(line.trim());
        line = "";
      }

      if (lastX !== null && x !== null && x < lastX && y !== null && lastY !== null && Math.abs(y - lastY) < 2) {
        if (line) lines.push(line.trim());
        line = "";
      }

      line += (line ? " " : "") + str;
      lastY = y ?? lastY;
      lastX = x ?? lastX;
    }

    if (line) lines.push(line.trim());
    out += lines.join("\n") + "\n";
  }

  return out.trim();
}

async function extractTextFromDocx(f: File) {
  const buf = await f.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return (res?.value ?? "").trim();
}

async function extractTextFromFile(f: File) {
  if (isPdf(f)) return await extractTextFromPdf(f);
  if (isDocx(f)) return await extractTextFromDocx(f);
  if (isTxt(f)) return await f.text();
  return "";
}

export default function MyCvPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [label, setLabel] = useState("CV");
  const [cvText, setCvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CvExtractResponse | null>(null);
  const [editableSkills, setEditableSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [lastParsed, setLastParsed] = useState<CvExtractResponse | null>(null);
  const [lastFileInfo, setLastFileInfo] = useState<any>(null);

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

  const structuredSections = useMemo(() => {
    const sections = result?.sections ?? {};
    const entries: Array<{ title: string; body: string }> = [];
    const seen = new Set<string>();

    for (const [k, v] of Object.entries(sections)) {
      const body = (v ?? "").trim();
      if (!body || body.length < 40) continue;
      const nk = normalizeKey(k);
      if (nk === "body") continue;
      if (seen.has(nk)) continue;
      seen.add(nk);
      entries.push({ title: formatSectionTitle(k), body });
    }

    if (entries.length === 0 && sections.body) {
      entries.push({ title: "Resume", body: sections.body });
    }

    return entries.slice(0, 8);
  }, [result?.sections]);

  async function invokeCvSave(action: "get_active" | "upsert" | "archive", payload?: any) {
    const { data, error } = await supabase.functions.invoke("cv_save", {
      body: { action, payload },
    });

    if (error) {
      let msg = error.message ?? "Erreur Edge Function";
      const anyErr = error as any;
      if (anyErr?.context instanceof Response) {
        const t = await anyErr.context.text();
        if (t) {
          try {
            const j = JSON.parse(t);
            msg = j?.error || j?.message || t;
          } catch {
            msg = t;
          }
        }
      }
      throw new Error(msg);
    }

    return data as CvSaveResponse;
  }

  async function loadActiveCv() {
    if (!userId) return;
    setErr(null);

    const res = await invokeCvSave("get_active");
    if (!res?.ok) {
      setErr(res?.error || res?.message || "Erreur lors du chargement du CV");
      return;
    }

    const data = res?.data ?? null;
    if (data) {
      setLabel((data as any).label ?? "CV");
      setCvText(improveReadableText((data as any).cv_text ?? ""));
      setEditableSkills(normalizeSkillsList((data as any).skills ?? []));
      setResult({
        ok: true,
        contact: (data as any).contact ?? {},
        skills: (data as any).skills ?? [],
        skills_by_category: (data as any).skills_by_category ?? undefined,
        sections: (data as any).cv_json?.sections ?? undefined,
        stats: (data as any).cv_json?.stats ?? undefined,
      });
      setLastParsed({
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
      setLastFileInfo({
        file_path: (data as any).file_path ?? null,
        file_name: name ?? null,
        file_size: size ?? null,
        mime_type: type ?? null,
      });
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
      const existingText = cvText.trim();
      let text = existingText;
      let fileText = "";
      let fileInfo: any = null;

      if (file) {
        if (!isPdf(file) && !isTxt(file) && !isDocx(file)) {
          throw new Error("Format non supporte. Utilise PDF, DOCX ou TXT.");
        }

        fileInfo = await uploadCvFile(file);
        setLastFileInfo(fileInfo);
        try {
          fileText = improveReadableText(stripDangerousChars((await extractTextFromFile(file)) ?? ""));
        } catch {
          fileText = "";
        }
      }

      if ((!text || text.length < 50) && fileText.trim().length >= 50) {
        text = fileText.trim();
      }

      text = improveReadableText(stripDangerousChars(text));
      if ((!existingText || existingText.length < 50) && text && text !== cvText) {
        setCvText(text);
      }

      if (!text || text.length < 50) {
        if (fileInfo) {
          await invokeCvSave("upsert", {
            label,
            cv_text: text || null,
            cv_json: {},
            skills: [],
            skills_by_category: {},
            contact: {},
            ...fileInfo,
          });
        }
        throw new Error("Impossible de lire le texte du CV. Si c'est un PDF scanne, colle le texte manuellement.");
      }

      const { data, error } = await supabase.functions.invoke("cv_extract", {
        body: { cv_text: text },
      });

      if (error) {
        let msg = error.message ?? "Erreur Edge Function";
        const anyErr = error as any;
        if (anyErr?.context instanceof Response) {
          const t = await anyErr.context.text();
          if (t) {
            try {
              const j = JSON.parse(t);
              msg = j?.error || j?.message || t;
            } catch {
              msg = t;
            }
          }
        }
        if (msg.includes("non-2xx")) {
          msg = "Erreur serveur lors de l'analyse. Reessaie dans quelques instants.";
        }
        throw new Error(msg);
      }

      const parsed = data as CvExtractResponse;
      if (parsed && parsed.ok === false) {
        throw new Error(parsed.error || parsed.message || "Analyse impossible");
      }

      const extractedSkills = normalizeSkillsList(Array.isArray(parsed?.skills) ? parsed.skills : []);
      setResult(parsed);
      setLastParsed(parsed);
      setEditableSkills(extractedSkills);

      const skills = extractedSkills;
      const skillsByCategory = parsed?.skills_by_category ?? {};
      const contact = parsed?.contact ?? {};
      const cvJson = {
        sections: parsed?.sections ?? {},
        stats: parsed?.stats ?? {},
      };

      await invokeCvSave("upsert", {
        label,
        cv_text: text,
        cv_json: cvJson,
        skills,
        skills_by_category: skillsByCategory,
        contact,
        ...(fileInfo ?? {}),
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSkillsOnly() {
    if (!userId) return;
    if (!lastParsed) return;

    setBusy(true);
    setErr(null);

    try {
      const skills = normalizeSkillsList(editableSkills);
      const skillsByCategory = lastParsed?.skills_by_category ?? {};
      const contact = lastParsed?.contact ?? {};
      const cvJson = {
        sections: lastParsed?.sections ?? {},
        stats: lastParsed?.stats ?? {},
      };

      await invokeCvSave("upsert", {
        label,
        cv_text: cvText,
        cv_json: cvJson,
        skills,
        skills_by_category: skillsByCategory,
        contact,
        ...(lastFileInfo ?? {}),
      });

      setResult((prev) => (prev ? { ...prev, skills } : prev));
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
      await invokeCvSave("archive");
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
          <button className="btn btnGhost" type="button" onClick={() => navigate("/")}>Retour</button>
          <h1>Mon CV</h1>
        </div>
      </div>

      <p className="mycv-subtitle">
        Importe ton CV (PDF/TXT/DOCX) ou colle le texte. Clique <b>Analyser & enregistrer</b> pour extraire tes competences.
      </p>

      <div className="mycv-grid">
        <div className="card">
          <div className="field">
            <label className="label">Nom/Label du CV</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="field">
            <label className="label">Importer un fichier CV (PDF/TXT/DOCX)</label>
            <input className="input mycv-file" type="file" accept=".pdf,.txt,.docx" onChange={onFileChange} />
            {fileMeta && (
              <div className="file-meta">
                <span>{fileMeta.name}</span>
                <span> - {formatBytes(fileMeta.size)}</span>
                {fileMeta.type ? <span> - {fileMeta.type}</span> : null}
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
                {chars} caracteres - {lines} lignes
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

        <div className="card">
          <h3>Contact detecte</h3>
          <div className="kv">
            <div>
              <b>Email :</b> {result?.contact?.email ?? "-"}
            </div>
            <div>
              <b>Telephone :</b> {result?.contact?.phone ?? "-"}
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
              {(result?.skills ?? []).length === 0 && <span className="muted">-</span>}
              {(result?.skills ?? []).map((s, i) => (
                <span className="pill" key={`${s}-${i}`}>{s}</span>
              ))}
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Competences utilisees pour le matching</h3>
          <div className="small" style={{ marginBottom: 8 }}>
            Tu peux retirer des competences imprecises ou en ajouter manuellement.
          </div>
          <div className="pills">
            {editableSkills.length === 0 && <span className="muted">-</span>}
            {editableSkills.map((s, i) => (
              <span className="pill pill-edit" key={`${s}-${i}`}>
                {s}
                <button
                  className="pill-remove"
                  type="button"
                  onClick={() => setEditableSkills((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`Supprimer ${s}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="skill-edit-row">
            <input
              className="input"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              placeholder="Ajouter une competence (ex: Budgeting, SAP, Power BI)"
            />
            <button
              className="btn btnGhost"
              type="button"
              onClick={() => {
                const v = normalizeSkillLabel(skillInput);
                if (!v) return;
                setEditableSkills((prev) => normalizeSkillsList([...prev, v]));
                setSkillInput("");
              }}
              disabled={busy}
            >
              Ajouter
            </button>
            <button className="btn btnPrimary" type="button" onClick={saveSkillsOnly} disabled={busy || !lastParsed}>
              Enregistrer competences
            </button>
          </div>

          {structuredSections.length > 0 && (
            <div className="cv-structured">
              <h3 style={{ marginTop: 16 }}>Resume structure</h3>
              {structuredSections.map((s) => (
                <div className="cv-section" key={s.title}>
                  <div className="cv-section-title">{s.title}</div>
                  <div className="cv-section-body">{s.body}</div>
                </div>
              ))}
            </div>
          )}

          <div className="small" style={{ marginTop: 10 }}>
            Ces infos servent a ameliorer le score de matching.
          </div>

          <h3 style={{ marginTop: 16 }}>Stats</h3>
          <div className="kv">
            <div>
              <b>Texte colle :</b> {result?.stats?.chars ?? chars} caracteres - {result?.stats?.lines ?? lines} lignes
            </div>
            <div>
              <b>Analyse :</b> {result?.stats?.chars ?? chars} caracteres - {result?.stats?.lines ?? lines} lignes
            </div>
            <div>
              <b>Experience estimee :</b> -
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
