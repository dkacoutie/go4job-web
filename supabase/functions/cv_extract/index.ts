import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type SkillsByCategory = {
  hard: string[];
  soft: string[];
  tools: string[];
  languages: string[];
  other: string[];
};

type SkillCategory = "domain" | "method" | "tool" | "soft" | "language" | "other";

type SkillItem = {
  label: string;
  category: SkillCategory;
  confidence: number; // 0..1
};

type CvExtractRequest = {
  cv_text?: unknown;
  file_path?: unknown;
  bucket?: unknown;
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

const SKILL_DICTIONARY: Array<{
  label: string;
  category: SkillCategory;
  synonyms: string[];
}> = [
  { label: "santÃ© publique", category: "domain", synonyms: ["sante publique", "public health"] },
  { label: "pharmacie", category: "domain", synonyms: ["pharmacie", "pharmaceutical", "pharmaceutique"] },
  { label: "gestion hospitaliÃ¨re", category: "domain", synonyms: ["gestion hospitaliere", "hospital management", "healthcare management"] },
  { label: "finance publique", category: "domain", synonyms: ["finance publique", "finances publiques"] },
  { label: "administration publique", category: "domain", synonyms: ["administration publique", "public administration"] },
  { label: "gouvernance", category: "domain", synonyms: ["gouvernance", "governance"] },
  { label: "audit", category: "method", synonyms: ["audit", "auditing"] },
  { label: "reporting", category: "method", synonyms: ["reporting", "reporting mensuel"] },
  { label: "suivi-Ã©valuation", category: "method", synonyms: ["suivi evaluation", "suivi-Ã©valuation", "monitoring evaluation", "m&e"] },
  { label: "pilotage de la performance", category: "method", synonyms: ["pilotage de la performance", "performance management"] },
  { label: "gestion de projet", category: "method", synonyms: ["gestion de projet", "project management", "management de projet"] },
  { label: "planification", category: "method", synonyms: ["planification", "planning"] },
  { label: "gestion budgÃ©taire", category: "method", synonyms: ["gestion budgetaire", "budget management", "budgeting"] },
  { label: "tableaux de bord", category: "method", synonyms: ["tableaux de bord", "dashboard", "dashboards"] },
  { label: "excel", category: "tool", synonyms: ["excel", "ms excel", "microsoft excel"] },
  { label: "power bi", category: "tool", synonyms: ["power bi", "powerbi"] },
  { label: "sql", category: "tool", synonyms: ["sql"] },
  { label: "sap", category: "tool", synonyms: ["sap"] },
  { label: "word", category: "tool", synonyms: ["word", "ms word", "microsoft word"] },
  { label: "powerpoint", category: "tool", synonyms: ["powerpoint", "ppt", "ms powerpoint"] },
  { label: "jira", category: "tool", synonyms: ["jira"] },
  { label: "trello", category: "tool", synonyms: ["trello"] },
  { label: "asana", category: "tool", synonyms: ["asana"] },
  { label: "notion", category: "tool", synonyms: ["notion"] },
  { label: "communication", category: "soft", synonyms: ["communication", "communication institutionnelle"] },
  { label: "leadership", category: "soft", synonyms: ["leadership"] },
  { label: "coordination", category: "soft", synonyms: ["coordination", "coordination d'equipes", "coordination dâ€™Ã©quipes"] },
  { label: "organisation", category: "soft", synonyms: ["organisation", "organization"] },
  { label: "autonomie", category: "soft", synonyms: ["autonomie", "autonomous"] },
  { label: "rigueur", category: "soft", synonyms: ["rigueur"] },
  { label: "nÃ©gociation", category: "soft", synonyms: ["negociation", "nÃ©gociation", "negotiation"] },
  { label: "esprit d'analyse", category: "soft", synonyms: ["esprit d'analyse", "analytical mindset"] },
  { label: "franÃ§ais", category: "language", synonyms: ["francais", "franÃ§ais", "french"] },
  { label: "anglais", category: "language", synonyms: ["anglais", "english"] },
  { label: "allemand", category: "language", synonyms: ["allemand", "german"] },
  { label: "espagnol", category: "language", synonyms: ["espagnol", "spanish"] },
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

function fixMojibakeText(input: string) {
  if (!/[ÃÂ]/.test(input)) return input;
  try {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
    const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!/[ÃÂ]/.test(repaired)) return repaired;
  } catch {
    // ignore
  }
  return input;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string) {
  const p = phrase.trim();
  if (!p) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(p)}([^a-z0-9]|$)`, "i");
  return re.test(text);
}

function sectionWeight(key: string) {
  const k = normalizeKey(key);
  if (!k) return 0.15;
  if (k.includes("competence") || k.includes("skills") || k.includes("aptitude")) return 0.55;
  if (k.includes("outil") || k.includes("tool") || k.includes("logiciel")) return 0.5;
  if (k.includes("langue") || k.includes("language")) return 0.5;
  if (k.includes("experience") || k.includes("exp")) return 0.35;
  if (k.includes("profil") || k.includes("summary") || k.includes("objectif")) return 0.3;
  return 0.2;
}

function extractSmartSkills(sections: Record<string, string>, cvText: string): SkillItem[] {
  const candidates = new Map<string, SkillItem & { score: number }>();

  const allSections = Object.entries(sections || {});
  const fallbackSection = allSections.length ? [] : [["body", cvText]];
  const mergedSections = allSections.length ? allSections : fallbackSection;

  for (const [key, raw] of mergedSections) {
    const weight = sectionWeight(key);
    const text = normalizeKey(raw);

    for (const def of SKILL_DICTIONARY) {
      const labelNorm = normalizeKey(def.label);
      const synonyms = [def.label, ...def.synonyms].map(normalizeKey);
      let hits = 0;
      for (const s of synonyms) {
        if (s && hasPhrase(text, s)) hits++;
      }
      if (!hits) continue;

      const base = 0.35;
      const bump = Math.min(0.15, Math.max(0, hits - 1) * 0.05);
      const score = Math.min(1, base + weight + bump);

      const existing = candidates.get(labelNorm);
      if (!existing || score > existing.score) {
        candidates.set(labelNorm, {
          label: labelNorm,
          category: def.category,
          confidence: Math.round(score * 100) / 100,
          score,
        });
      }
    }
  }

  // Fallback: short noun-phrases from skills sections
  const skillsText =
    sections["compétences"] ||
    sections["competences"] ||
    sections["skills"] ||
    sections["aptitudes"] ||
    "";

  if (skillsText) {
    const items = splitToItems(skillsText)
      .map((s) => normalizeKey(s))
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s && s.split(" ").length <= 4);

    for (const it of items) {
      if (candidates.has(it)) continue;
      candidates.set(it, {
        label: it,
        category: "other",
        confidence: 0.35,
        score: 0.35,
      });
    }
  }

  const out = Array.from(candidates.values())
    .sort((a, b) => (b.confidence - a.confidence) || a.label.localeCompare(b.label))
    .map(({ score, ...rest }) => rest);

  return out;
}

function groupSkillsForLegacy(skills: SkillItem[]): SkillsByCategory {
  const out: SkillsByCategory = { hard: [], soft: [], tools: [], languages: [], other: [] };
  for (const s of skills) {
    if (s.category === "tool") out.tools.push(s.label);
    else if (s.category === "soft") out.soft.push(s.label);
    else if (s.category === "language") out.languages.push(s.label);
    else if (s.category === "domain" || s.category === "method") out.hard.push(s.label);
    else out.other.push(s.label);
  }
  return out;
}

function buildSummary(sections: Record<string, string>, rawText: string) {
  const pick =
    sections["profil"] ||
    sections["profile"] ||
    sections["summary"] ||
    sections["resume"] ||
    sections["résumé"] ||
    sections["objectif"] ||
    "";

  const base = pick || rawText.split(/\n{2,}/)[0] || rawText;
  const trimmed = base.replace(/\s+/g, " ").trim();
  return trimmed.length > 360 ? trimmed.slice(0, 360) + "..." : trimmed;
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
  const fixed = fixMojibakeText(collapsed);
  const sliced = fixed.length > MAX_CV_LENGTH ? fixed.slice(0, MAX_CV_LENGTH) : fixed;
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

function detectExperienceYears(text: string) {
  const t = normalizeKey(text);
  let min: number | null = null;
  let max: number | null = null;

  const rangeRe = /(\d{1,2})\s*(?:-|a|to)\s*(\d{1,2})\s*(ans|years|yrs|year)/g;
  const plusRe = /(\d{1,2})\s*\+?\s*(ans|years|yrs|year)/g;

  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(t)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      min = min == null ? lo : Math.min(min, lo);
      max = max == null ? hi : Math.max(max, hi);
    }
  }

  while ((m = plusRe.exec(t)) !== null) {
    const a = parseInt(m[1], 10);
    if (Number.isFinite(a)) {
      min = min == null ? a : Math.min(min, a);
      max = max == null ? a : Math.max(max, a);
    }
  }

  return { experience_years_min: min, experience_years_max: max };
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

function titleizeSection(key: string) {
  const cleaned = key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Section";
  return cleaned
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function buildFormattedText(sections: Record<string, string>, raw: string) {
  const keys = Object.keys(sections || {});
  if (!keys.length) return raw;

  const out: string[] = [];
  for (const k of keys) {
    const title = k === "body" ? "CV" : titleizeSection(k);
    const content = (sections[k] ?? "").trim();
    if (!content) continue;
    out.push(`## ${title}\n${content}`);
  }
  return out.join("\n\n").trim() || raw;
}

function isPdfBytes(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function extractTextFromBinary(bytes: Uint8Array) {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const matches = decoded.match(/[A-Za-z0-9À-ÖØ-öø-ÿ][A-Za-z0-9À-ÖØ-öø-ÿ\s@.,;:+()'"-]{20,}/g);
  if (matches && matches.length) return matches.map((m) => m.trim()).join("\n");
  return decoded;
}

function getSupabaseClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");

  if (!url) return null;

  if (authHeader && anon) {
    return createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
  }

  if (service) {
    return createClient(url, service, { auth: { persistSession: false } });
  }

  return null;
}

async function loadTextFromStorage(req: Request, filePath: string, bucket = "cvs") {
  const sb = getSupabaseClient(req);
  if (!sb) return { ok: false as const, error: "supabase_client_unavailable" };

  const { data, error } = await sb.storage.from(bucket).download(filePath);
  if (error || !data) return { ok: false as const, error: error?.message ?? "download_failed" };

  const bytes = new Uint8Array(await data.arrayBuffer());
  const text = extractTextFromBinary(bytes);

  if (isPdfBytes(bytes) && (!text || text.length < 30)) {
    return { ok: false as const, error: "pdf_text_extraction_failed" };
  }

  return { ok: true as const, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  let body: CvExtractRequest | null = null;
  try {
    body = (await req.json()) as CvExtractRequest;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json_body" });
  }

  let rawCv = typeof body?.cv_text === "string" ? body.cv_text : "";
  const filePath = typeof body?.file_path === "string" ? body.file_path.trim() : "";
  const bucket = typeof body?.bucket === "string" ? body.bucket.trim() : "cvs";

  if (!rawCv || rawCv.trim().length < 30) {
    if (filePath) {
      const fromStorage = await loadTextFromStorage(req, filePath, bucket);
      if (!fromStorage.ok) {
        return jsonResponse(400, { ok: false, error: fromStorage.error || "storage_read_failed" });
      }
      rawCv = fromStorage.text;
    }
  }

  if (!rawCv || rawCv.trim().length < 30) {
    return jsonResponse(400, { ok: false, error: "cv_text_missing_or_too_short" });
  }

  const cleaned = normalizeCvText(rawCv);
  const truncated = cleaned.length < rawCv.length;

  const sections = splitSections(cleaned);
  const skills_by_category = extractSkillsByCategory(sections, cleaned);
  const skills = flattenSkills(skills_by_category);
  const contact = detectContact(cleaned);
  const experience = detectExperienceYears(cleaned);
  const formatted_text = buildFormattedText(sections, cleaned);

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
    formatted_text,
    raw_text: cleaned,
    experience_years_min: experience.experience_years_min,
    experience_years_max: experience.experience_years_max,
    truncated,
    match: { keyword_score: null },
  });
});
