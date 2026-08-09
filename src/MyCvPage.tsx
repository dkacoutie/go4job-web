import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { NextStepCard } from "./components/GuidedUI";
import { useToast } from "./components/useToast";
import OnboardingStepper from "./components/OnboardingStepper";
import "./MyCvPage.css";
import { Document, Packer, Paragraph } from "docx";
import { jsPDF } from "jspdf";

// JR-0026 (09/08/2026) : ne pas remplacer ces @ts-ignore par @ts-expect-error.
// ESLint le recommande (@typescript-eslint/ban-ts-comment) mais tsc -b ne
// considere pas ces lignes en erreur dans cet environnement de build (types
// absents seulement en dev local) : @ts-expect-error y echoue avec
// TS2578 "Unused '@ts-expect-error' directive" et casse le build Netlify.
// Deja tente et revert en production le 09/08/2026 (commits 95d327c/01cb380).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: external module has no types in build environment
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: worker url module has no types
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker?url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
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

const MAX_CV_MB = 8;
const ALLOWED_EXT = ["pdf", "docx"];

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

function clampText(text: string, maxChars: number) {
  if (!text) return "";
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 3).trim()}...`;
}

function pickSection(sections: Record<string, string> | undefined, keys: string[]) {
  if (!sections) return "";
  for (const [k, v] of Object.entries(sections)) {
    const nk = normalizeKey(k);
    if (keys.includes(nk)) return String(v ?? "").trim();
  }
  return "";
}

function guessLocationFromContact(text: string) {
  const lines = String(text ?? "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.includes("@")) continue;
    if (lower.includes("linkedin") || lower.includes("github") || lower.includes("http")) continue;
    if (/\d{2,}/.test(line)) continue;
    if (line.length > 80) continue;
    return line;
  }
  return "";
}

function extractHeadline(profileText: string, fallbackText: string) {
  const source = profileText || fallbackText;
  const lines = String(source ?? "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  return clampText(lines[0], 90);
}

function formatCvResultAsText(payload: {
  headline?: string;
  profile?: string;
  experience?: string;
  skills?: string[];
  languages?: string[];
  contact?: { email?: string | null; phone?: string | null };
  location?: string;
}) {
  const lines: string[] = [];
  if (payload.headline) lines.push(`Titre de profil: ${payload.headline}`);
  if (payload.contact?.email) lines.push(`Email: ${payload.contact.email}`);
  if (payload.contact?.phone) lines.push(`Téléphone: ${payload.contact.phone}`);
  if (payload.location) lines.push(`Localisation: ${payload.location}`);
  if (payload.profile) lines.push(`\nProfil:\n${payload.profile}`);
  if (payload.experience) lines.push(`\nExpérience:\n${payload.experience}`);
  if (payload.skills?.length) lines.push(`\nCompétences:\n- ${payload.skills.join("\n- ")}`);
  if (payload.languages?.length) lines.push(`\nLangues:\n- ${payload.languages.join("\n- ")}`);
  return lines.join("\n");
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

function isPdf(f: File) {
  return f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
}

function isDocx(f: File) {
  return (
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    f.name.toLowerCase().endsWith(".docx")
  );
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
  return "";
}

export default function MyCvPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [searchParams] = useSearchParams();
  const onboardingFlow = searchParams.get("flow") === "onboarding";

  const [label, setLabel] = useState("CV");
  const [cvText, setCvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CvExtractResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "upload" | "analyze" | "saving">("idle");
  const [nextStep, setNextStep] = useState<{
    title: string;
    message: string;
    primary: { label: string; to?: string; onClick?: () => void };
    secondary?: { label: string; to?: string; onClick?: () => void };
    tertiary?: { label: string; to?: string; onClick?: () => void };
    tone?: "info" | "success";
  } | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [editableSkills, setEditableSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [lastParsed, setLastParsed] = useState<CvExtractResponse | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);

  const [cvFilePath, setCvFilePath] = useState<string | null>(null);
  const [cvFilename, setCvFilename] = useState<string | null>(null);
  const [cvUpdatedAt, setCvUpdatedAt] = useState<string | null>(null);
  const [cvUploading, setCvUploading] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const userId = session?.user?.id ?? null;
  const { pushToast } = useToast();
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

  useEffect(() => {
    if (!loading && !session) navigate("/auth");
  }, [loading, session, navigate]);

  const chars = useMemo(() => cvText.length, [cvText]);

  const lines = useMemo(() => {
    const t = cvText.trim();
    if (!t) return 0;
    return t.split(/\r\n|\r|\n/).length;
  }, [cvText]);

  const extracted = useMemo(() => {
    const sections = result?.sections ?? {};
    const profileSection = pickSection(sections, ["profil", "resume", "summary", "objective", "objectif", "body"]);
    const experienceSection = pickSection(sections, ["experience", "experience professionnelle", "experiences"]);
    const contactSection = pickSection(sections, ["contact"]);
    const languagesSection = pickSection(sections, ["langues", "languages"]);

    const headline = extractHeadline(profileSection, cvText);
    const profile = clampText(profileSection || cvText, 680);
    const contact = result?.contact ?? {};
    const location = guessLocationFromContact(contactSection);

    const skills = normalizeSkillsList(editableSkills);
    let languages = normalizeSkillsList(result?.skills_by_category?.languages ?? []);
    if (!languages.length && languagesSection) {
      languages = normalizeSkillsList(
        languagesSection
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }

    return {
      headline,
      profile,
      experience: clampText(experienceSection, 900),
      contact,
      location,
      skills,
      languages,
    };
  }, [result, cvText, editableSkills]);

  const resultText = useMemo(() => formatCvResultAsText(extracted), [extracted]);

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
      setErr(GENERIC_SERVER_ERROR);
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
      const existingSkills = normalizeSkillsList((data as any).skills ?? []);
      const existingEmail = (data as any).contact?.email;
      setNeedsReview(existingSkills.length < 4 || !existingEmail);
    }
  }

  async function loadProfileCv() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("cv_file_path, cv_filename, cv_updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return;
    setCvFilePath(data?.cv_file_path ?? null);
    setCvFilename(data?.cv_filename ?? null);
    setCvUpdatedAt(data?.cv_updated_at ?? null);
  }

  useEffect(() => {
    if (userId) {
      loadActiveCv();
      loadProfileCv();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function uploadCvToProfile(f: File) {
    if (!userId) return;
    setCvError(null);

    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXT.includes(ext)) {
      setCvError("Format non supporté. Utilise uniquement PDF ou DOCX.");
      return;
    }

    if (f.size > MAX_CV_MB * 1024 * 1024) {
      setCvError(`Fichier trop volumineux. Maximum ${MAX_CV_MB} MB.`);
      return;
    }

    setCvUploading(true);
    const previousPath = cvFilePath;
    const path = `${userId}/cv-${Date.now()}.${ext}`;

    try {
      const { error: uploadErr } = await supabase.storage
        .from("cvs")
        .upload(path, f, { upsert: true, contentType: f.type || "application/octet-stream" });

      if (uploadErr) throw uploadErr;

      const updatedAt = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({
          cv_file_path: path,
          cv_filename: f.name,
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
      setCvFilename(f.name);
      setCvUpdatedAt(updatedAt);
      pushToast({
        kind: "success",
        title: "CV téléversé",
        message: "Ton CV est bien enregistré et synchronisé.",
      });
    } catch {
      setCvError("Impossible d’envoyer ce CV. Réessaie avec un fichier plus léger.");
      pushToast({
        kind: "error",
        title: "Téléversement échoué",
        message: GENERIC_SERVER_ERROR,
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
    } catch {
      setCvError("Impossible de supprimer le CV pour le moment.");
      pushToast({
        kind: "error",
        title: "Suppression échouée",
        message: GENERIC_SERVER_ERROR,
      });
    } finally {
      setCvUploading(false);
    }
  }

  async function analyzeAndSave() {
    if (!userId) return;

    setBusy(true);
    setErr(null);
    setNextStep(null);
    setPhase("upload");

    try {
      const existingText = cvText.trim();
      let text = existingText;
      let fileText = "";

      if (file) {
        fileText = improveReadableText(stripDangerousChars((await extractTextFromFile(file)) ?? ""));
      }

      if ((!text || text.length < 50) && fileText.trim().length >= 50) {
        text = fileText.trim();
      }

      text = improveReadableText(stripDangerousChars(text));
      if ((!existingText || existingText.length < 50) && text && text !== cvText) {
        setCvText(text);
      }

      if (!text || text.length < 50) {
        throw new Error("Impossible de lire le texte du CV. Si c'est un PDF scanné, colle le texte manuellement.");
      }

      setPhase("analyze");
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
          msg = "Erreur serveur lors de l'analyse. Réessaie dans quelques instants.";
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

      setPhase("saving");
      await invokeCvSave("upsert", {
        label,
        cv_text: text,
        cv_json: cvJson,
        skills,
        skills_by_category: skillsByCategory,
        contact,
      });

      const needsReviewFlag = extractedSkills.length < 4 || !parsed?.contact?.email;
      setNeedsReview(needsReviewFlag);
      pushToast({
        kind: "success",
        title: "CV analysé avec succès",
        message: "Les informations détectées sont disponibles ci-dessous.",
      });

      setNextStep(
        needsReviewFlag
          ? {
              title: "CV analysé (à vérifier)",
              message: "Certaines informations peuvent être incomplètes. Relis ton profil pour améliorer la précision.",
              primary: onboardingFlow
                ? { label: "Continuer vers les alertes", to: "/jobradar/alerts?flow=onboarding&prefill=onboarding" }
                : { label: "Relire mon profil", to: "/jobradar/profile" },
              secondary: onboardingFlow
                ? { label: "Relire mon profil", to: "/profile?flow=onboarding" }
                : { label: "Voir les offres pour moi", to: "/jobradar/feed" },
              tertiary: onboardingFlow ? undefined : { label: "Gérer mes alertes", to: "/jobradar/alerts" },
              tone: "info",
            }
          : {
              title: "Prochaine étape recommandée",
              message: onboardingFlow
                ? "Ton CV est analysé. Passe maintenant à tes alertes pour recevoir des offres ciblées."
                : "Vérifie ton profil détecté, puis mets à jour tes alertes et découvre les offres recommandées.",
              primary: onboardingFlow
                ? { label: "Continuer vers les alertes", to: "/jobradar/alerts?flow=onboarding&prefill=onboarding" }
                : { label: "Voir les offres pour moi", to: "/jobradar/feed" },
              secondary: onboardingFlow
                ? { label: "Retour au parcours", to: "/jobradar/onboarding?step=cv" }
                : { label: "Mettre à jour mon profil", to: "/jobradar/profile" },
              tertiary: onboardingFlow ? undefined : { label: "Gérer mes alertes", to: "/jobradar/alerts" },
              tone: "success",
            },
      );
    } catch {
      setErr(GENERIC_SERVER_ERROR);
      pushToast({
        kind: "error",
        title: "Impossible d'analyser ce CV",
        message: "Essaie un PDF/DOCX lisible ou complète ton profil manuellement.",
      });
      setNextStep({
        title: "Impossible d'analyser ce CV",
        message: "Essaie un PDF/DOCX plus lisible ou complète ton profil manuellement.",
        primary: { label: "Réessayer", to: onboardingFlow ? "/me/cv?flow=onboarding" : "/me/cv" },
        secondary: { label: "Compléter mon profil", to: onboardingFlow ? "/profile?flow=onboarding" : "/jobradar/profile" },
        tertiary: onboardingFlow ? undefined : { label: "Gérer mes alertes", to: "/jobradar/alerts" },
        tone: "info",
      });
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  async function handleCopy() {
    const content = resultText.trim();
    if (!content) {
      pushToast({
        kind: "info",
        title: "Rien à copier",
        message: "Ajoute un CV pour générer un résumé exploitable.",
      });
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const helper = document.createElement("textarea");
        helper.value = content;
        helper.setAttribute("readonly", "true");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      pushToast({
        kind: "success",
        title: "Copie effectuée",
        message: "Le résumé structuré a été copié.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Copie impossible",
        message: "Essaie à nouveau ou télécharge le fichier TXT.",
      });
    }
  }

  function handleDownloadTxt() {
    const content = resultText.trim();
    if (!content) {
      pushToast({
        kind: "info",
        title: "Aucun résultat",
        message: "Ajoute un CV pour générer le fichier TXT.",
      });
      return;
    }

    const base = safeFileName(label || cvFilename || fileMeta?.name || "cv");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}_jobradar.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
    pushToast({
      kind: "success",
      title: "Export TXT prêt",
      message: "Le fichier a été téléchargé.",
    });
  }

  async function handleDownloadDocx() {
    const content = resultText.trim();
    if (!content) {
      pushToast({
        kind: "info",
        title: "Aucun résultat",
        message: "Ajoute un CV pour générer le fichier DOCX.",
      });
      return;
    }

    try {
      const base = safeFileName(label || cvFilename || fileMeta?.name || "cv");
      const lines = content.split(/\r?\n/);
      const paragraphs = lines.map((line) => new Paragraph({ text: line || " " }));
      const doc = new Document({
        sections: [
          {
            children: paragraphs,
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${base}_jobradar.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      pushToast({
        kind: "success",
        title: "Export DOCX prêt",
        message: "Le fichier a été téléchargé.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Export DOCX impossible",
        message: "Réessaie dans quelques instants.",
      });
    }
  }

  function handleDownloadPdf() {
    const content = resultText.trim();
    if (!content) {
      pushToast({
        kind: "info",
        title: "Aucun résultat",
        message: "Ajoute un CV pour générer le PDF.",
      });
      return;
    }

    try {
      const base = safeFileName(label || cvFilename || fileMeta?.name || "cv");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);

      const margin = 48;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const maxWidth = pageWidth - margin * 2;
      const lineHeight = 14;
      const lines = doc.splitTextToSize(content, maxWidth);

      let y = margin;
      for (const line of lines) {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(String(line), margin, y);
        y += lineHeight;
      }

      doc.save(`${base}_jobradar.pdf`);
      pushToast({
        kind: "success",
        title: "Export PDF prêt",
        message: "Le fichier a été téléchargé.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Export PDF impossible",
        message: "Réessaie dans quelques instants.",
      });
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
      });

      setResult((prev) => (prev ? { ...prev, skills } : prev));
      pushToast({
        kind: "success",
        title: "Compétences mises à jour",
        message: "JobRadar utilisera ces nouvelles compétences pour mieux recommander les offres.",
      });
    } catch {
      setErr(GENERIC_SERVER_ERROR);
      pushToast({
        kind: "error",
        title: "Impossible d'enregistrer les compétences",
        message: GENERIC_SERVER_ERROR,
      });
    } finally {
      setBusy(false);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) {
      setFileMeta({ name: f.name, size: f.size, type: f.type || "" });
      uploadCvToProfile(f);
    } else {
      setFileMeta(null);
    }
    e.currentTarget.value = "";
  }

  const hasResult = Boolean(result && result.ok !== false);
  const isAnalyzing = busy && phase !== "idle";
  const canExport = hasResult && Boolean(resultText.trim());

  if (loading) return null;

  return (
    <div className="mycv-shell">
      <div className="mycv-top">
        <div className="mycv-title">
          <button
            className="btn btnGhost"
            type="button"
            onClick={() => navigate(onboardingFlow ? "/jobradar/onboarding?step=cv" : "/")}
          >
            Retour
          </button>
          <h1>Mon CV</h1>
        </div>
      </div>

      {onboardingFlow && (
        <div style={{ marginBottom: 18 }}>
          <OnboardingStepper
            currentStep="cv"
            completedSteps={["profile", "preferences", "preview", "unlock", "complete-profile"]}
            compact
          />
        </div>
      )}

      <div className="cv-guidance">
        <div className="cv-guidance__title">Ajoute ton CV pour améliorer les offres recommandées</div>
        <div className="cv-guidance__text">
          JobRadar analyse ton CV pour mieux comprendre ton profil et te proposer des offres plus pertinentes.
          Tu pourras vérifier et corriger les informations détectées.
        </div>
      </div>

      <div className="cv-layout">
        <section className="cv-panel">
          <div className="cv-panelHeader">
            <div>
              <div className="cv-panelTitle">Importer un CV</div>
              <div className="cv-panelSub">
                Un seul CV est conservé. Formats acceptés : PDF ou DOCX (max {MAX_CV_MB} MB).
              </div>
            </div>
          </div>

          <div className="cv-fileCard">
            {!cvFilePath ? (
              <div className="cv-fileEmpty">
                <div className="cv-fileEmptyTitle">Aucun CV enregistré</div>
                <div className="cv-fileEmptyText">
                  Téléverse ton CV pour aider JobRadar à mieux comprendre ton profil et recommander les offres.
                </div>
                <button
                  className="btn btnPrimary"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={cvUploading}
                >
                  Téléverser mon CV
                </button>
              </div>
            ) : (
              <div className="cv-fileFilled">
                <div>
                  <div className="cv-fileName">{cvFilename || "CV"}</div>
                  <div className="cv-fileMeta">
                    Mis à jour {cvUpdatedAt ? new Date(cvUpdatedAt).toLocaleDateString("fr-FR") : "—"}
                  </div>
                </div>
                <div className="cv-fileActions">
                  <button className="btn btnGhost" type="button" onClick={handleViewCv} disabled={cvUploading}>
                    Voir
                  </button>
                  <button
                    className="btn btnGhost"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={cvUploading}
                  >
                    Remplacer
                  </button>
                  <button className="btn btnGhost" type="button" onClick={handleDeleteCv} disabled={cvUploading}>
                    Supprimer
                  </button>
                </div>
              </div>
            )}

            {cvUploading && <div className="cv-fileLoading">Téléversement en cours…</div>}
            {cvError && <div className="cv-fileError">{cvError}</div>}

            <input
              ref={fileInputRef}
              className="cv-fileInput"
              type="file"
              accept=".pdf,.docx"
              onChange={onFileChange}
            />
          </div>

          <div className="field">
            <label className="label">Nom du CV</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          {(!onboardingFlow || showAdvanced) && (
            <div className="field">
              <label className="label">Texte du CV (optionnel)</label>
              <textarea
                className="textarea"
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
                placeholder="Colle ton CV ici si besoin..."
              />
            </div>
          )}

          {onboardingFlow && (
            <button className="btn btnGhost btnSm" type="button" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "Masquer les options avancées" : "Plus d'options"}
            </button>
          )}

          <div className="cv-actions">
            <div className="cv-actionsLeft">
              <span className="muted">
                {chars} caractères · {lines} lignes
              </span>
              <button className="btn btnGhost" type="button" onClick={loadActiveCv} disabled={busy}>
                Recharger l’analyse
              </button>
            </div>

            <div className="cv-actionsRight">
              <button className="btn btnPrimary" type="button" onClick={analyzeAndSave} disabled={busy}>
                {busy ? "Analyse..." : "Analyser & enregistrer"}
              </button>
            </div>
          </div>

          {err && <div className="cv-alert">{err}</div>}
          <div className="cv-privacy">
            Tes données CV sont utilisées uniquement pour améliorer les offres recommandées par JobRadar. Tu peux supprimer ton CV à tout moment.
          </div>
        </section>

        <section className="cv-panel cv-output">
          <div className="cv-outputHeader">
            <div>
              <div className="cv-panelTitle">Résultat</div>
              <div className="cv-panelSub">Profil structuré issu de ton CV.</div>
            </div>
            {needsReview && <span className="cv-badge">À vérifier</span>}
          </div>

          {(!onboardingFlow || showAdvanced) && (
            <div className="cv-outputActions">
              <button className="btn btnGhost" type="button" onClick={handleCopy} disabled={!canExport}>
                Copier
              </button>
              <button className="btn btnGhost" type="button" onClick={handleDownloadTxt} disabled={!canExport}>
                Télécharger TXT
              </button>
              <button className="btn btnGhost" type="button" onClick={handleDownloadDocx} disabled={!canExport}>
                Télécharger DOCX
              </button>
              <button className="btn btnGhost" type="button" onClick={handleDownloadPdf} disabled={!canExport}>
                Télécharger PDF
              </button>
            </div>
          )}

          {isAnalyzing && (
            <div className="cv-progress" aria-live="polite">
              <div className="cv-progress__title">Analyse de ton CV en cours...</div>
              <div className="cv-progress__text">
                Nous extrayons tes compétences et expériences pour améliorer tes recommandations.
              </div>
              <div className="cv-progress__steps">
                <span className={phase === "upload" || phase === "analyze" || phase === "saving" ? "done" : ""}>
                  Préparation
                </span>
                <span className={phase === "analyze" || phase === "saving" ? "done" : ""}>Analyse du CV</span>
                <span className={phase === "saving" ? "done" : ""}>Préparation des recommandations</span>
              </div>
            </div>
          )}

          {!isAnalyzing && err && !hasResult && (
            <div className="cv-outputState cv-outputError">
              <div className="cv-outputStateTitle">Impossible d'analyser ce CV</div>
              <div className="cv-outputStateText">
                Essaie un PDF/DOCX plus lisible ou complète ton profil manuellement.
              </div>
              <div className="cv-outputStateActions">
                <button className="btn btnPrimary" type="button" onClick={analyzeAndSave} disabled={busy}>
                  Réessayer
                </button>
                <button
                  className="btn btnGhost"
                  type="button"
                  onClick={() => navigate(onboardingFlow ? "/profile?flow=onboarding" : "/jobradar/profile")}
                >
                  Compléter mon profil
                </button>
              </div>
            </div>
          )}

          {!isAnalyzing && !err && !hasResult && (
            <div className="cv-outputState cv-outputEmpty">
              <div className="cv-outputStateTitle">Ajoute ton CV pour un résultat immédiat</div>
              <div className="cv-outputStateText">
                Tu verras ici un profil structuré (compétences, expérience, localisation, langues) prêt à être utilisé.
              </div>
            </div>
          )}

          {hasResult && (
            <div className="cv-outputBody">
              {needsReview && (
                <div className="cv-verify">
                  <div className="cv-verifyTitle">CV analysé (à vérifier)</div>
                  <div className="cv-verifyText">
                    Certaines informations peuvent être incomplètes. Relis ton profil pour améliorer la précision.
                  </div>
                  <button className="btn btnGhost btnSm" type="button" onClick={() => navigate(onboardingFlow ? "/profile?flow=onboarding" : "/jobradar/profile")}>
                    Relire mon profil
                  </button>
                </div>
              )}

              {extracted.headline && <div className="cv-headline">{extracted.headline}</div>}

              <div className="cv-meta">
                <div>
                  <div className="cv-metaLabel">Email</div>
                  <div className="cv-metaValue">{extracted.contact?.email || "Non renseigné"}</div>
                </div>
                <div>
                  <div className="cv-metaLabel">Téléphone</div>
                  <div className="cv-metaValue">{extracted.contact?.phone || "Non renseigné"}</div>
                </div>
                <div>
                  <div className="cv-metaLabel">Localisation</div>
                  <div className="cv-metaValue">{extracted.location || "Non renseigné"}</div>
                </div>
              </div>

              <div className="cv-block">
                <div className="cv-blockTitle">Profil</div>
                <div className="cv-blockBody">
                  {extracted.profile ? extracted.profile : <span className="muted">Non renseigné</span>}
                </div>
              </div>

              <div className="cv-block">
                <div className="cv-blockTitle">Expérience</div>
                <div className="cv-blockBody">
                  {extracted.experience ? extracted.experience : <span className="muted">Non renseigné</span>}
                </div>
              </div>

              <div className="cv-block">
                <div className="cv-blockTitle">Compétences</div>
                <div className="cv-blockBody">
                  <div className="pills">
                    {editableSkills.length === 0 && <span className="muted">Non renseigné</span>}
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

                  <div className="cv-skillEdit">
                    <input
                      className="input"
                      value={skillInput}
                      onChange={(e) => setSkillInput(e.target.value)}
                      placeholder="Ajouter une compétence (ex: Budget, SAP, Power BI)"
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
                      Enregistrer
                    </button>
                  </div>
                  <div className="cv-blockHint">Tu peux ajuster les compétences pour améliorer les offres recommandées.</div>
                </div>
              </div>

              <div className="cv-block">
                <div className="cv-blockTitle">Langues</div>
                <div className="cv-blockBody">
                  <div className="pills">
                    {extracted.languages.length === 0 && <span className="muted">Non renseigné</span>}
                    {extracted.languages.map((l, i) => (
                      <span className="pill" key={`${l}-${i}`}>
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {onboardingFlow && cvFilePath && !nextStep && (
        <div className="cv-nextStep">
          <NextStepCard
            title="CV enregistré"
            message="Tu peux l'analyser pour affiner tes recommandations, ou continuer directement vers tes alertes."
            primaryAction={{ label: "Continuer vers les alertes", to: "/jobradar/alerts?flow=onboarding&prefill=onboarding" }}
            secondaryAction={{ label: "Analyser mon CV maintenant", onClick: () => void analyzeAndSave() }}
            tone="success"
          />
        </div>
      )}

      {nextStep && (
        <div className="cv-nextStep">
          <NextStepCard
            title={nextStep.title}
            message={nextStep.message}
            primaryAction={nextStep.primary}
            secondaryAction={nextStep.secondary}
            tone={nextStep.tone ?? "info"}
          />
          {nextStep.tertiary && (
            <button
              className="cv-tertiary"
              type="button"
              onClick={() => {
                if (nextStep.tertiary?.onClick) nextStep.tertiary.onClick();
                else if (nextStep.tertiary?.to) navigate(nextStep.tertiary.to);
              }}
            >
              {nextStep.tertiary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
