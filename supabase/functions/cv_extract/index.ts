import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type SkillsByCategory = {
  hard: string[];
  soft: string[];
  tools: string[];
  languages: string[];
  other: string[];
};

// ---------- Skills extraction (intelligent + pertinent) ----------

// titres / sections à bannir s’ils apparaissent comme “skill”
const SECTION_NOISE = [
  "informations personnelles",
  "profil professionnel",
  "profil",
  "experience professionnelle",
  "expérience professionnelle",
  "éducation et formation",
  "education et formation",
  "informations complémentaires",
  "informations complementaires",
  "références",
  "references",
  "poste visé",
  "poste vise",
  "objectif",
];

// mots qui signalent une organisation/lieu (donc pas une compétence)
const ORG_WORDS = [
  "ministère",
  "ministere",
  "banque",
  "africaine",
  "développement",
  "developpement",
  "foundation",
  "san pedro",
  "abidjan",
  "plateau",
  "cote d'ivoire",
  "cote d ivoire",
  "côte d’ivoire",
  "côte d'ivoire",
  "bad",
  "afdb",
];

// mots qui indiquent “ça ressemble à une compétence”
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
  "hôpital",
  "hopital",
  "santé",
  "sante",
  "programme",
  "projet",
  "contrat",
  "tableau de bord",
  "tableaux de bord",
  "optimisation",
  "audit",
  "communication",
  "rédaction",
  "redaction",
  "excel",
  "word",
  "powerpoint",
  "power bi",
  "sql",
  "sap",
  "français",
  "anglais",
  "allemand",
];

// règles de canonisation (réalisations -> compétence “propre”)
const CANONICAL_RULES: Array<{ re: RegExp; skill: string; cat?: keyof SkillsByCategory }> = [
  { re: /gestion.*budget|budget.*gestion/i, skill: "gestion budgétaire", cat: "hard" },
  { re: /planification.*budget|budget.*planification/i, skill: "planification budgétaire", cat: "hard" },
  { re: /r[eé]daction.*contrat|contrat.*r[eé]daction/i, skill: "gestion de contrats", cat: "hard" },
  { re: /supervision.*programme|programme.*supervision/i, skill: "supervision de programmes", cat: "hard" },
  { re: /coordination.*(equipe|équipes)/i, skill: "coordination d’équipes", cat: "soft" },
  { re: /communication institutionnelle/i, skill: "communication institutionnelle", cat: "soft" },
  { re: /r[eé]daction de rapports|rapports.*r[eé]daction/i, skill: "rédaction de rapports", cat: "soft" },
  { re: /gestion pharmaceutique|pharmaceutique/i, skill: "gestion pharmaceutique", cat: "hard" },
  { re: /gestion hospitali[eè]re|management hospitali[eè]r/i, skill: "gestion hospitalière", cat: "hard" },
  { re: /sant[eé] publique/i, skill: "santé publique", cat: "hard" },
  { re: /tableaux? de bord|dashboard/i, skill: "création de tableaux de bord", cat: "hard" },

  { re: /\bpower bi\b/i, skill: "power bi", cat: "tools" },
  { re: /\bexcel\b/i, skill: "excel", cat: "tools" },
  { re: /\bword\b/i, skill: "word", cat: "tools" },
  { re: /\bpowerpoint\b/i, skill: "powerpoint", cat: "tools" },

  { re: /\bfran[cç]ais\b/i, skill: "français", cat: "languages" },
  { re: /\banglais\b/i, skill: "anglais", cat: "languages" },
  { re: /\ballemand\b/i, skill: "allemand", cat: "languages" },
];

function stripBullets(s: string) {
  return s.replace(/^[•\-–—]\s*/, "").trim();
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
  // beaucoup de chiffres + monnaies/volumes -> réalisation (à canoniser ou ignorer)
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

  // emails/urls/tel/dates
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s)) return true;
  if (/(https?:\/\/|www\.|linkedin\.com)/i.test(s)) return true;
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(s)) return true;
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(k)) return true;

  // section title / org / lieu
  if (looksLikeSectionTitle(s)) return true;
  if (looksLikeOrgOrPlace(s)) return true;

  // phrases “profil”
  if (k.startsWith("cadre confirme") || k.startsWith("avec une vision") || k.startsWith("specialise")) return true;

  // trop long = narrative
  if (k.length > 90) return true;

  return false;
}

function splitToItems(text: string) {
  return text
    .replace(/[,;•·|]/g, "\n")
    .split("\n")
    .map((s) => stripBullets(s))
    .map((s) => s.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
}

function canonicalizeSkill(raw: string): { value: string | null; forcedCat?: keyof SkillsByCategory } {
  const t = stripBullets(raw);
  let k = normalizeKey(t);

  // nettoyage des débuts
  k = k
    .replace(/^specialise(e)? en\s+/i, "")
    .replace(/^sp[eé]cialis[eé](e)? en\s+/i, "")
    .replace(/^avec une vision.*$/i, "")
    .replace(/^cadre confirme.*$/i, "")
    .trim();

  if (!k) return { value: null };

  // canonisation via règles
  for (const r of CANONICAL_RULES) {
    if (r.re.test(raw) || r.re.test(k)) {
      return { value: r.skill, forcedCat: r.cat };
    }
  }

  // réalisations non reconnues -> on ignore (conservateur)
  if (looksLikePureAchievement(raw) && !hasSkillSignal(raw)) {
    return { value: null };
  }

  // si pas de signal clair de compétence -> on ignore
  if (!hasSkillSignal(k)) return { value: null };

  // limite longueur
  if (k.length > 60) k = k.slice(0, 60).trim();

  return { value: k };
}

function categorizeSkill(value: string): keyof SkillsByCategory {
  const k = normalizeKey(value);

  if (k.includes("excel") || k.includes("power bi") || k.includes("word") || k.includes("powerpoint") || k.includes("sql") || k.includes("sap")) {
    return "tools";
  }
  if (k === "français" || k === "anglais" || k === "allemand") return "languages";
  if (k.includes("communication") || k.includes("leadership") || k.includes("coordination") || k.includes("redaction") || k.includes("rédaction")) {
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
  // ✅ Sources principales
  const skillsText =
    sections["compétences"] ||
    sections["competences"] ||
    sections["skills"] ||
    sections["aptitudes"] ||
    "";

  const toolsText =
    sections["numériques"] ||
    sections["numeriques"] ||
    sections["outils"] ||
    sections["tools"] ||
    "";

  const langText = sections["langues"] || sections["languages"] || "";

  // fallback : seulement si aucune section pertinente
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

  // limites
  out.hard = out.hard.slice(0, 25);
  out.tools = out.tools.slice(0, 15);
  out.soft = out.soft.slice(0, 15);
  out.languages = out.languages.slice(0, 8);
  out.other = out.other.slice(0, 10);

  return out;
}

/* =========================
   Contact + sections + HTTP handler
========================= */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_CV_LENGTH = 20000;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeCvText(input: string) {
  const raw = String(input ?? "").replace(/\r/g, "\n").replace(/\u00a0/g, " ");
  const collapsed = raw.replace(/\t/g, " ").replace(/\n{3,}/g, "\n\n");
  const sliced = collapsed.length > MAX_CV_LENGTH ? collapsed.slice(0, MAX_CV_LENGTH) : collapsed;
  return sliced.trim();
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
    const headingLike = key.length >= 3 && key.length <= 40 && (upperRatio >= 0.6 || /[:：]$/.test(trimmed));

    if (headingLike) {
      flush();
      buffer = [];
      currentKey = key.replace(/[:：]$/, "") || trimmed;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  let body: { cv_text?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json_body" });
  }

  const rawCv = typeof body?.cv_text === "string" ? body.cv_text : "";
  if (!rawCv || rawCv.trim().length < 30) {
    return jsonResponse(400, { ok: false, error: "cv_text_missing_or_too_short" });
  }

  const cleaned = normalizeCvText(rawCv);
  const truncated = cleaned.length < rawCv.length;

  const sections = splitSections(cleaned);
  const skills_by_category = extractSkillsByCategory(sections, cleaned);
  const skills = flattenSkills(skills_by_category);
  const contact = detectContact(cleaned);

  const stats = {
    chars: cleaned.length,
    lines: cleaned ? cleaned.split(/\r\n|\r|\n/).length : 0,
  };

  return jsonResponse(200, {
    ok: true,
    contact,
    skills,
    skills_by_category,
    sections,
    stats,
    truncated,
    match: { keyword_score: null },
  });
});
