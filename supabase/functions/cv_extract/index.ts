import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type SkillsByCategory = {
  hard: string[];
  soft: string[];
  tools: string[];
  languages: string[];
  other: string[];
};

// ---------- Skills extraction (intelligent + pertinent) ----------

const SECTION_NOISE = [
  "informations personnelles",
  "profil professionnel",
  "profil",
  "experience professionnelle",
  "education et formation",
  "informations complementaires",
  "references",
  "poste vise",
  "objectif",
];

const ORG_WORDS = [
  "ministere",
  "banque",
  "africaine",
  "developpement",
  "foundation",
  "san pedro",
  "abidjan",
  "plateau",
  "cote d'ivoire",
  "cote d ivoire",
  "bad",
  "afdb",
];

const SKILL_HINT_WORDS = [
  "gestion",
  "management",
  "planification",
  "budget",
  "reporting",
  "supervision",
  "coordination",
  "pharmacie",
  "pharmaceutique",
  "hospital",
  "hopital",
  "sante",
  "programme",
  "projet",
  "contrat",
  "tableau de bord",
  "tableaux de bord",
  "optimisation",
  "audit",
  "communication",
  "redaction",
  "excel",
  "word",
  "powerpoint",
  "power bi",
  "sql",
  "sap",
  "francais",
  "anglais",
  "allemand",
];

const CANONICAL_RULES: Array<{ re: RegExp; skill: string; cat?: keyof SkillsByCategory }> = [
  { re: /gestion.*budget|budget.*gestion/i, skill: "gestion budgetaire", cat: "hard" },
  { re: /planification.*budget|budget.*planification/i, skill: "planification budgetaire", cat: "hard" },
  { re: /redaction.*contrat|contrat.*redaction/i, skill: "gestion de contrats", cat: "hard" },
  { re: /supervision.*programme|programme.*supervision/i, skill: "supervision de programmes", cat: "hard" },
  { re: /coordination.*(equipe|equipes)/i, skill: "coordination d'equipes", cat: "soft" },
  { re: /communication institutionnelle/i, skill: "communication institutionnelle", cat: "soft" },
  { re: /redaction de rapports|rapports.*redaction/i, skill: "redaction de rapports", cat: "soft" },
  { re: /gestion pharmaceutique|pharmaceutique/i, skill: "gestion pharmaceutique", cat: "hard" },
  { re: /gestion hospitaliere|management hospitalier/i, skill: "gestion hospitaliere", cat: "hard" },
  { re: /sante publique/i, skill: "sante publique", cat: "hard" },
  { re: /tableaux? de bord|dashboard/i, skill: "creation de tableaux de bord", cat: "hard" },

  { re: /\bpower bi\b/i, skill: "power bi", cat: "tools" },
  { re: /\bexcel\b/i, skill: "excel", cat: "tools" },
  { re: /\bword\b/i, skill: "word", cat: "tools" },
  { re: /\bpowerpoint\b/i, skill: "powerpoint", cat: "tools" },

  { re: /\bfran[\u00E7c]ais\b/i, skill: "francais", cat: "languages" },
  { re: /\banglais\b/i, skill: "anglais", cat: "languages" },
  { re: /\ballemand\b/i, skill: "allemand", cat: "languages" },
];

function stripBullets(s: string) {
  return s.replace(/^[\u2022\-\u2013\u2014]\s*/, "").trim();
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

function looksLikeSectionTitle(s: string) {
  const k = normalizeKey(s);
  return SECTION_NOISE.some((t) => k === normalizeKey(t));
}

function looksLikeOrgOrPlace(s: string) {
  const k = normalizeKey(s);
  return ORG_WORDS.some((w) => k.includes(normalizeKey(w)));
}

function looksLikePureAchievement(s: string) {
  const k = normalizeKey(s);
  if (/\b(19|20)\d{2}\b/.test(k)) return true;
  if (/\d{2,}/.test(k) && (k.includes("xof") || k.includes("m ") || k.includes("million") || k.includes("beneficia"))) {
    return true;
  }
  return false;
}

function hasSkillSignal(s: string) {
  const k = normalizeKey(s);
  return SKILL_HINT_WORDS.some((h) => k.includes(normalizeKey(h)));
}

function isLikelyNoise(s: string) {
  const k = normalizeKey(s);

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return true;
  if (/(https?:\/\/|www\.|linkedin\.com)/i.test(s)) return true;
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(s)) return true;
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(k)) return true;

  if (looksLikeSectionTitle(s)) return true;
  if (looksLikeOrgOrPlace(s)) return true;

  if (k.startsWith("cadre confirme") || k.startsWith("avec une vision") || k.startsWith("specialise")) return true;

  if (k.length > 90) return true;

  return false;
}

function splitToItems(text: string) {
  return text
    .replace(/[,;\u2022\u00b7|]/g, "\n")
    .split("\n")
    .map((s) => stripBullets(s))
    .map((s) => s.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

function canonicalizeSkill(raw: string): { value: string | null; forcedCat?: keyof SkillsByCategory } {
  const t = stripBullets(raw);
  let k = normalizeKey(t);

  k = k
    .replace(/^specialise(e)? en\s+/i, "")
    .replace(/^specialise en\s+/i, "")
    .replace(/^avec une vision.*$/i, "")
    .replace(/^cadre confirme.*$/i, "")
    .trim();

  if (!k) return { value: null };

  for (const r of CANONICAL_RULES) {
    if (r.re.test(raw) || r.re.test(k)) {
      return { value: r.skill, forcedCat: r.cat };
    }
  }

  if (looksLikePureAchievement(raw) && !hasSkillSignal(raw)) {
    return { value: null };
  }

  if (!hasSkillSignal(k)) return { value: null };

  if (k.length > 60) k = k.slice(0, 60).trim();

  return { value: k };
}

function categorizeSkill(value: string): keyof SkillsByCategory {
  const k = normalizeKey(value);

  if (k.includes("excel") || k.includes("power bi") || k.includes("word") || k.includes("powerpoint") || k.includes("sql") || k.includes("sap")) {
    return "tools";
  }
  if (k === "francais" || k === "anglais" || k === "allemand") return "languages";
  if (k.includes("communication") || k.includes("leadership") || k.includes("coordination") || k.includes("redaction")) {
    return "soft";
  }
  return "hard";
}

function uniqPush(arr: string[], seen: Set<string>, value: string) {
  const key = normalizeKey(value);
  if (!key) return;
  if (seen.has(key)) return;
  seen.add(key);
  arr.push(value);
}

function extractSkillsByCategory(sections: Record<string, string>, cvText: string): SkillsByCategory {
  const skillsText =
    sections["competences"] ||
    sections["skills"] ||
    sections["aptitudes"] ||
    "";

  const toolsText =
    sections["numeriques"] ||
    sections["outils"] ||
    sections["tools"] ||
    "";

  const langText = sections["langues"] || sections["languages"] || "";

  const fallback = skillsText || toolsText || langText ? "" : cvText.slice(0, 2200);

  const pool = [skillsText, toolsText, langText, fallback].filter(Boolean).join("\n");
  const items = splitToItems(pool);

  const out: SkillsByCategory = { hard: [], soft: [], tools: [], languages: [], other: [] };
  const seen = new Set<string>();

  for (const raw of items) {
    if (isLikelyNoise(raw)) continue;

    const { value, forcedCat } = canonicalizeSkill(raw);
    if (!value) continue;

    const cat = forcedCat ?? categorizeSkill(value);
    uniqPush(out[cat], seen, value);

    if (seen.size >= 80) break;
  }

  out.hard = out.hard.slice(0, 25);
  out.tools = out.tools.slice(0, 15);
  out.soft = out.soft.slice(0, 15);
  out.languages = out.languages.slice(0, 8);
  out.other = out.other.slice(0, 10);

  return out;
}

const MAX_CV_LENGTH = 20000;

function normalizeCvText(input: string) {
  const raw = String(input ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");
  const collapsed = raw.replace(/\t/g, " ").replace(/\n{3,}/g, "\n\n");
  const sliced = collapsed.length > MAX_CV_LENGTH ? collapsed.slice(0, MAX_CV_LENGTH) : collapsed;
  return sliced.trim();
}

function improveStructure(text: string) {
  let t = text.replace(/\s{2,}/g, " ").trim();
  if (!t) return t;

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

function detectContact(text: string) {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/(\+?\d[\d\s().-]{7,}\d)/);

  const phone = phoneMatch?.[1]?.replace(/[^\d+]/g, "") ?? null;

  return {
    email: emailMatch?.[0] ?? null,
    phone: phone && phone.length >= 8 ? phone : null,
  };
}

function splitSections(rawText: string): Record<string, string> {
  const lines = rawText.split("\n");
  const sections: Record<string, string> = {};

  let currentKey = "body";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (!content) return;
    const rawKey = currentKey.trim().toLowerCase() || "body";
    const normKey = normalizeKey(rawKey);
    sections[rawKey] = content;
    if (normKey && normKey !== rawKey) sections[normKey] = content;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const key = normalizeKey(trimmed);
    const letters = (trimmed.match(/[A-Za-z]/g) || []).length;
    const upper = (trimmed.match(/[A-Z]/g) || []).length;
    const upperRatio = letters > 0 ? upper / letters : 0;
    const headingLike = key.length >= 3 && key.length <= 40 && (upperRatio >= 0.6 || /[:\uFF1A]$/.test(trimmed));

    if (headingLike) {
      flush();
      buffer = [];
      currentKey = key.replace(/[:\uFF1A]$/, "") || trimmed;
      continue;
    }

    buffer.push(trimmed);
  }

  flush();
  if (Object.keys(sections).length === 0) sections.body = rawText.trim();
  return sections;
}

function flattenSkills(byCat: SkillsByCategory): string[] {
  return [...byCat.hard, ...byCat.tools, ...byCat.soft, ...byCat.languages, ...byCat.other].slice(0, 120);
}

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://jobradar.go4jobapp.com",
]);

function getCorsHeaders(origin: string | null) {
  const o = origin && allowedOrigins.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    }

    let body: { cv_text?: unknown } | null = null;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "invalid_json_body" }, corsHeaders);
    }

    const rawCv = typeof body?.cv_text === "string" ? body.cv_text : "";
    if (!rawCv || rawCv.trim().length < 30) {
      return jsonResponse(400, { ok: false, error: "cv_text_missing_or_too_short" }, corsHeaders);
    }

    let cleaned = normalizeCvText(rawCv);
    cleaned = improveStructure(cleaned);
    const truncated = cleaned.length < rawCv.length;

    const sections = splitSections(cleaned);
    const skills_by_category = extractSkillsByCategory(sections, cleaned);
    const skills = flattenSkills(skills_by_category);
    const contact = detectContact(cleaned);

    const stats = {
      chars: cleaned.length,
      lines: cleaned ? cleaned.split(/\r\n|\r|\n/).length : 0,
    };

    return jsonResponse(
      200,
      {
        ok: true,
        contact,
        skills,
        skills_by_category,
        sections,
        stats,
        truncated,
        match: { keyword_score: null },
      },
      corsHeaders,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { ok: false, error: "server_error", message }, corsHeaders);
  }
});
