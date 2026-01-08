// supabase/functions/job_extract/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type JobExtractRequest = { job_text: string };

type SkillsByCategory = {
  hard: string[];
  soft: string[];
  tools: string[];
  languages: string[];
  other: string[];
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  const body = new TextEncoder().encode(JSON.stringify(data));
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeText(input: string) {
  return input
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9+.# -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBullets(s: string) {
  return s.replace(/^[•\-–—]\s*/, "").trim();
}

function isSentenceLike(raw: string) {
  // évite “Nous recherchons…”, “Qualifications…”
  const k = normalizeKey(raw);
  if (k.length > 70) return true;
  const badStarts = [
    "nous recherchons",
    "nous recrutons",
    "nous recherchons un",
    "nous recherchons une",
    "we are looking",
    "we re looking",
    "hiring",
    "poste",
    "job",
    "mission",
    "missions",
    "profil",
    "profile",
    "qualifications",
    "qualification",
    "requirements",
    "requirement",
  ];
  return badStarts.some((p) => k.startsWith(p));
}

// ---------- dictionnaires ----------
const TOOL_HINTS = [
  "excel",
  "word",
  "powerpoint",
  "power bi",
  "google sheets",
  "google docs",
  "outlook",
  "jira",
  "trello",
  "asana",
  "notion",
  "sql",
  "sap",
];

const SOFT_HINTS = [
  "leadership",
  "communication",
  "coordination",
  "organisation",
  "travail en equipe",
  "teamwork",
  "rigueur",
  "autonomie",
  "negociation",
  "gestion des priorites",
  "resolution de problemes",
  "problem solving",
  "esprit d analyse",
  "redaction",
  "redaction de rapports",
];

const LANG_HINTS = [
  "francais",
  "anglais",
  "allemand",
  "espagnol",
  "portugais",
  "arabic",
  "english",
  "french",
  "german",
  "spanish",
];

// Hard skills “mots-pivots” (simple et efficace)
const HARD_HINTS = [
  "gestion de projet",
  "management de projet",
  "pilotage",
  "reporting",
  "analyse",
  "analyse de donnees",
  "planification",
  "budget",
  "budg",
  "suivi",
  "coordination de projet",
];

// Canonicalisation légère (pour “faire pro”)
function canonicalize(raw: string) {
  const k = normalizeKey(raw);

  // outils (cas spéciaux)
  if (/^power\s*bi$/.test(k)) return "Power BI";
  if (/^excel$/.test(k)) return "Excel";
  if (/^sql$/.test(k)) return "SQL";

  // hard skills fréquentes
  if (k.includes("gestion de projet") || k.includes("management de projet")) return "Gestion de projet";
  if (k.includes("reporting")) return "Reporting";
  if (k.includes("planification")) return "Planification";
  if (k.includes("budget") || k.includes("budg")) return "Gestion budgétaire";

  // soft
  if (k.includes("coordination")) return "Coordination";
  if (k.includes("communication")) return "Communication";
  if (k.includes("leadership")) return "Leadership";

  // Title-case léger
  const words = raw
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
  return words.join(" ");
}

// ---------- extraction title ----------
function extractJobTitle(jobText: string): string | null {
  const t = normalizeText(jobText);

  // “Nous recherchons un/une X.” / “We are looking for a X.”
  const m =
    t.match(/(?:nous\s+(?:recherchons|recrutons)\s+(?:un|une)\s+)([^.\n]{5,90})/i) ||
    t.match(/(?:we\s+are\s+looking\s+for\s+(?:a|an)\s+)([^.\n]{5,90})/i) ||
    t.match(/(?:poste\s*:\s*)([^\n]{5,90})/i) ||
    t.match(/(?:job\s+title\s*:\s*)([^\n]{5,90})/i);

  const title = m?.[1]?.trim() ?? null;
  if (!title) return null;

  // coupe si ça contient “compétences …” après
  return title.replace(/\s*(comp[ée]tences?|skills?).*$/i, "").trim() || null;
}

// ---------- extraction skills ----------
function splitToItems(text: string) {
  return text
    .replace(/[•·|;]/g, "\n")
    .replace(/\s*,\s*/g, "\n")
    .split("\n")
    .map((s) => stripBullets(s))
    .map((s) => s.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

function extractSkillsChunk(jobText: string): string {
  const t = normalizeText(jobText);

  // priorité: ce qui suit “Compétences requises: ...” jusqu’à (Qualifications|Profil|Missions|fin phrase)
  const m =
    t.match(/comp[ée]tences?\s+requises?\s*:\s*(.*?)(?:\n|\.|qualifications?\s*:|profil\s*:|missions?\s*:|requirements?\s*:|$)/i) ||
    t.match(/required\s+skills?\s*:\s*(.*?)(?:\n|\.|qualifications?\s*:|requirements?\s*:|$)/i);

  if (m?.[1]?.trim()) return m[1].trim();

  // sinon: lignes qui contiennent “compétences” / “skills”
  const lines = t.split("\n");
  const picked: string[] = [];
  for (const line of lines) {
    const k = normalizeKey(line);
    if (k.includes("competence") || k.includes("skills") || k.includes("technologies") || k.includes("outils")) {
      picked.push(line);
    }
    // bullets = souvent listes utiles
    if (/^[•\-–—]\s+/.test(line.trim())) picked.push(line);
  }
  return picked.join("\n").trim();
}

function isNoiseItem(raw: string) {
  const s = raw.trim();
  const k = normalizeKey(s);

  if (!k || k.length < 2) return true;
  if (isSentenceLike(s)) return true;

  // années / exp (“3 ans”)
  if (/\b(19|20)\d{2}\b/.test(k)) return true;
  if (/\b\d{1,2}\s*(ans?|years?)\b/.test(k)) return true;
  if (/\d{4,}/.test(k)) return true;

  // urls/emails/tel
  if (/(https?:\/\/|www\.|linkedin\.com)/i.test(s)) return true;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return true;
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(s)) return true;

  // libellés
  const badPrefixes = [
    "competences",
    "competences requises",
    "skills",
    "required skills",
    "qualifications",
    "profil",
    "missions",
    "poste",
  ];
  if (badPrefixes.some((p) => k === p || k.startsWith(p + " "))) return true;

  return false;
}

function categorize(itemRaw: string): { cat: keyof SkillsByCategory; value: string; key: string } {
  const cleaned = itemRaw.trim();
  const key = normalizeKey(cleaned);

  if (LANG_HINTS.some((l) => key.includes(l))) return { cat: "languages", value: canonicalize(cleaned), key };
  if (TOOL_HINTS.some((h) => key.includes(normalizeKey(h)))) return { cat: "tools", value: canonicalize(cleaned), key };
  if (SOFT_HINTS.some((s) => key.includes(s))) return { cat: "soft", value: canonicalize(cleaned), key };
  if (HARD_HINTS.some((h) => key.includes(normalizeKey(h))) || key.includes("gestion") || key.includes("management")) {
    return { cat: "hard", value: canonicalize(cleaned), key };
  }

  return { cat: "other", value: canonicalize(cleaned), key };
}

function uniqPush(arr: string[], seen: Set<string>, key: string, value: string) {
  if (!key || seen.has(key)) return;
  seen.add(key);
  arr.push(value);
}

function extract(jobTextRaw: string) {
  const jobText = normalizeText(jobTextRaw);

  // 1) required skills chunk (prioritaire)
  const chunk = extractSkillsChunk(jobText);
  const itemsFromChunk = splitToItems(chunk)
    .filter((x) => !isNoiseItem(x))
    .filter((x) => x.length >= 2 && x.length <= 60);

  // 2) fallback intelligent: scan du texte pour mots-clés (évite “Nous recherchons…”)
  const tkey = normalizeKey(jobText);
  const fallbackTokens: string[] = [];

  for (const tool of TOOL_HINTS) if (tkey.includes(normalizeKey(tool))) fallbackTokens.push(tool);
  for (const soft of SOFT_HINTS) if (tkey.includes(soft)) fallbackTokens.push(soft);
  for (const hard of HARD_HINTS) if (tkey.includes(normalizeKey(hard))) fallbackTokens.push(hard);
  for (const lang of LANG_HINTS) if (tkey.includes(lang)) fallbackTokens.push(lang);

  const out: SkillsByCategory = { hard: [], soft: [], tools: [], languages: [], other: [] };
  const seen = new Set<string>();

  // required_skills = d’abord depuis chunk (si présent), sinon fallback
  const requiredSkills: string[] = [];

  const requiredSeed = itemsFromChunk.length ? itemsFromChunk : fallbackTokens;
  for (const raw of requiredSeed) {
    const c = categorize(raw);
    if (c.cat === "other") continue; // required = seulement hard/tools/soft/lang (pas “other”)
    uniqPush(out[c.cat], seen, c.key, c.value);
    requiredSkills.push(c.value);
  }

  // ensuite, complète avec items du chunk (y compris other si utile)
  for (const raw of itemsFromChunk) {
    const c = categorize(raw);
    uniqPush(out[c.cat], seen, c.key, c.value);
    if (seen.size >= 120) break;
  }

  // limites
  out.hard = out.hard.slice(0, 40);
  out.tools = out.tools.slice(0, 30);
  out.soft = out.soft.slice(0, 30);
  out.languages = out.languages.slice(0, 10);
  out.other = out.other.slice(0, 30);

  const skillsFlat = [...out.hard, ...out.tools, ...out.soft, ...out.languages, ...out.other].slice(0, 80);

  // requiredSkills sans doublons
  const reqSeen = new Set<string>();
  const req = requiredSkills.filter((s) => {
    const k = normalizeKey(s);
    if (!k || reqSeen.has(k)) return false;
    reqSeen.add(k);
    return true;
  }).slice(0, 25);

  return { jobText, skills_by_category: out, skills: skillsFlat, required_skills: req };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    const body = (await req.json()) as JobExtractRequest;
    const jobInput = body?.job_text ?? "";

    if (!jobInput || jobInput.trim().length < 30) {
      return json({ ok: false, error: "job_text manquant ou trop court (min ~30 caractères)" }, 400);
    }

    const job_title = extractJobTitle(jobInput);
    const { jobText, skills_by_category, skills, required_skills } = extract(jobInput);

    return json(
      {
        ok: true,
        stats: { chars: jobText.length, lines: jobText.split("\n").length },
        job_title,
        skills,
        skills_by_category,
        required_skills,
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
