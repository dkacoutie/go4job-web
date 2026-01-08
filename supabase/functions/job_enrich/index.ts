// supabase/functions/job_enrich/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/* =====================================================================================
  VERSION MARKER (to confirm cloud deploy)
===================================================================================== */
const CODE_VERSION = "job_enrich_2025-12-29_mojibake_v6";

/* =====================================================================================
  CORS + HTTP helpers
===================================================================================== */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonStringifyAsciiSafe(value: unknown): string {
  // Convert all non-ASCII chars to \uXXXX (or surrogate pairs),
  // so even clients decoding HTTP bytes wrongly still parse correct Unicode.
  const json = JSON.stringify(value);

  return json.replace(/[^\x00-\x7F]/g, (ch) => {
    const cp = ch.codePointAt(0);
    if (cp == null) return ch;

    if (cp <= 0xffff) {
      return "\\u" + cp.toString(16).padStart(4, "0");
    }

    // surrogate pair
    const u = cp - 0x10000;
    const hi = 0xd800 + (u >> 10);
    const lo = 0xdc00 + (u & 0x3ff);
    return (
      "\\u" +
      hi.toString(16).padStart(4, "0") +
      "\\u" +
      lo.toString(16).padStart(4, "0")
    );
  });
}

function jsonResponse(payload: unknown, status = 200) {
  // Ensure code_version is ALWAYS present and cannot be overridden by payload
  const enrichedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>), code_version: CODE_VERSION }
      : { payload, code_version: CODE_VERSION };

  // ASCII-only JSON string to prevent mojibake in some clients
  const body = jsonStringifyAsciiSafe(enrichedPayload);

  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "x-code-version": CODE_VERSION,
    },
  });
}

async function safeReadJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function getContentType(req: Request): string {
  return (req.headers.get("content-type") ?? "").toLowerCase();
}

/* =====================================================================================
  Supabase client (service role preferred)
===================================================================================== */
function getSupabaseClient(authorizationHeader: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // optional

  // Prefer service role (bypass RLS)
  if (serviceRole && serviceRole.length > 20) {
    return createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });
  }

  // Fall back to anon + forwarded user JWT (if provided)
  const headers: Record<string, string> = {};
  if (authorizationHeader) headers["Authorization"] = authorizationHeader;

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers },
  });
}

function hasServiceRoleConfigured(): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return typeof key === "string" && key.length > 20;
}

/* =====================================================================================
  Text normalization / HTML / mojibake fix
===================================================================================== */
function stripHtml(input: string): string {
  const withBreaks = input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*section\s*>/gi, "\n")
    .replace(/<\/\s*h[1-6]\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "\n- ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\/\s*ul\s*>/gi, "\n")
    .replace(/<\/\s*ol\s*>/gi, "\n")
    .replace(/<\/\s*tr\s*>/gi, "\n")
    .replace(/<\/\s*td\s*>/gi, " | ")
    .replace(/<\/\s*th\s*>/gi, " | ");

  return withBreaks
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // variantes fréquentes
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    // dash entities (souvent dans les job boards)
    .replace(/&ndash;|&#8211;/gi, "—")
    .replace(/&mdash;|&#8212;/gi, "—");
}

/**
 * Fix mojibake reliably (keeps NEWLINES intact)
 * Repairs cases like: U+00E2 U+0080 U+0094 (UTF-8 bytes decoded as Latin-1) => "—"
 */
function fixMojibake(input: string): string {
  let s = String(input ?? "");

  // A) Normalize weird spaces (DON'T touch \n)
  s = s.replace(/[\u00A0\u202F\u2007]/g, " ");

  // B) HARD REPAIR: UTF-8 bytes mis-decoded as Latin-1 (C1 controls present)
  // Only attempt if string looks byte-ish (no chars above 0xFF), to avoid corrupting emojis etc.
  const hasC1 = /[\u0080-\u009F]/.test(s);
  const hasMarkers = /(?:Ã|Â|â[\u0080-\u009F])/.test(s);
  const allInByteRange = !/[^\u0000-\u00FF]/.test(s);

  if ((hasC1 || hasMarkers) && allInByteRange) {
    try {
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;

      const repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

      // keep if it removes C1 garbage
      if (!/[\u0080-\u009F]/.test(repaired)) s = repaired;
    } catch {
      // ignore
    }
  }

  // C) Targeted replaces (covers partial cases)
  s = s
    // em dash / en dash (various mojibake forms)
    .replace(/â\u0080\u0094/g, "—")
    .replace(/â\u0080\u0093/g, "–")
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€"/g, "—")

    // quotes / apostrophes / bullet
    .replace(/â\u0080\u0099/g, "’")
    .replace(/â€™/g, "’")
    .replace(/â\u0080\u009C/g, '"')
    .replace(/â\u0080\u009D/g, '"')
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â\u0080\u00A2/g, "•")

    // "Â" often appears before NBSP when misdecoded
    .replace(/Â/g, " ");

  // D) If a lonely "â" is used as separator (after C1 stripped), fix it
  s = s.replace(
    /([A-Za-z0-9À-ÿ])(?:[ \t\u00A0\u202F\u2007]+)â(?:[ \t\u00A0\u202F\u2007]+)([A-Za-z0-9À-ÿ])/g,
    "$1 — $2",
  );

  // E) Remove remaining C1 control chars (keep \n)
  s = s.replace(/[\u0080-\u009F]/g, "");

  // F) Normalize horizontal whitespace only (DO NOT collapse newlines)
  s = s.replace(/[ \t\r\f\v]+/g, " ");

  return s;
}

function normalizeOnce(input: string): string {
  const stripped = stripHtml(String(input ?? ""));
  const decoded = decodeEntities(stripped);
  const fixed = fixMojibake(decoded);

  return fixed
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/[ \t\r\f\v]+/g, " ") // keep \n intact
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* =====================================================================================
  URL fetch fallback (only if DB text short)
===================================================================================== */
async function fetchUrlText(url: string): Promise<{
  text: string;
  ok: boolean;
  reason?: string;
}> {
  if (!url || typeof url !== "string") {
    return { text: "", ok: false, reason: "no_url" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { text: "", ok: false, reason: "invalid_url" };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (JobRadarBot/1.0; +https://go4job.org) job_enrich",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = normalizeOnce(raw);

    if (!res.ok) return { text, ok: false, reason: `http_${res.status}` };
    if (text.length < 200) return { text, ok: true, reason: "short_content" };

    return { text, ok: true, reason: contentType || "ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", ok: false, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

/* =====================================================================================
  pickText(job) (HARDENED)
===================================================================================== */
type AnyRecord = Record<string, any>;

const MAX_DEPTH = 7;
const MAX_TEXT_LEN = 20000;
const MAX_COLLECTED_ITEMS = 500;
const MIN_STR_LEN = 25;

const PRIMARY_KEYS = [
  "title",
  "job_title",
  "position",
  "role",
  "company_name",
  "company",
  "organization",
  "location",
  "country",
  "remote_type",
  "employment_type",
  "contract_type",
  "seniority",
  "experience_level",
  "category",
  "department",
];

const TEXT_KEYS = [
  "description_text",
  "description_html",
  "description",
  "job_description",
  "summary",
  "content",
  "body",
  "details",
  "text",
  "job_text",
  "ad_text",
  "posting_text",
  "markdown",
  "html",
  "responsibilities",
  "requirements",
  "qualifications",
  "skills",
  "must_have",
  "nice_to_have",
  "benefits",
  "what_you_will_do",
  "what_youll_do",
  "who_you_are",
  "profile",
  "mission",
  "about",
  "about_role",
  "about_company",
  "how_to_apply",
  "application_instructions",
];

const JSON_KEYS_HINTS = [
  "raw",
  "payload",
  "data",
  "json",
  "metadata",
  "source_payload",
  "external_payload",
  "api_response",
  "extra",
];

const IGNORE_KEY_RE =
  /(^(id|uuid|external_id|job_id|source_id|job_source_id)$)|url|link|logo|image|avatar|icon|slug|hash|token|etag|created|updated|timestamp|lat|lng|longitude|latitude/i;

const GOOD_KEY_RE =
  /desc|summary|content|body|text|markdown|html|responsibil|require|qualif|benefit|skill|about|profile|mission|role|position|what/i;

function isProbablyUsefulNormalizedString(normalized: string): boolean {
  if (!normalized) return false;
  if (normalized.length < MIN_STR_LEN) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(normalized)) return false;
  return true;
}

function uniqPreserveOrder(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= MAX_COLLECTED_ITEMS) break;
  }
  return out;
}

function buildHeader(job: AnyRecord): string {
  const title =
    job.title ??
    job.job_title ??
    job.position ??
    job.role ??
    job.jobTitle ??
    null;

  const company =
    job.company_name ?? job.company ?? job.organization ?? job.org ?? null;

  const location = job.location ?? null;
  const country = job.country ?? null;
  const remote = job.remote_type ?? job.remote ?? null;
  const type =
    job.employment_type ??
    job.contract_type ??
    job.type ??
    job.contractType ??
    null;

  const bits: string[] = [];
  if (title) bits.push(String(title).trim());
  if (company) bits.push(String(company).trim());

  const meta: string[] = [];
  if (location) meta.push(String(location).trim());
  if (country) meta.push(String(country).trim());
  if (remote) meta.push(String(remote).trim());
  if (type) meta.push(String(type).trim());

  const headerLine = bits.filter(Boolean).join(" — ");
  const metaLine = meta.filter(Boolean).join(" | ");

  // Keep \n between header line and meta line
  const header = [headerLine, metaLine].filter(Boolean).join("\n");

  // Apply normalizeOnce on the whole header (fixes mojibake like " â " -> " — ")
  return header ? `JOB HEADER:\n${normalizeOnce(header)}\n` : "";
}

function walkObject(obj: any): string[] {
  const good: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();

  const add = (text: string, keyHint: string) => {
    if (good.length + other.length >= MAX_COLLECTED_ITEMS) return;
    const n = normalizeOnce(text);
    if (!isProbablyUsefulNormalizedString(n)) return;

    const key = keyHint || "";
    const bucket = GOOD_KEY_RE.test(key) ? good : other;
    const dedupKey = (GOOD_KEY_RE.test(key) ? "G:" : "O:") + n.toLowerCase();
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    bucket.push(n);
  };

  const walk = (node: any, keyPath: string, depth: number) => {
    if (node == null || depth > MAX_DEPTH) return;
    if (good.length + other.length >= MAX_COLLECTED_ITEMS) return;

    const leafKey = keyPath.split(".").pop() ?? "";

    if (typeof node === "string") {
      if (looksLikeJson(node)) {
        const parsed = safeJsonParse(node);
        if (parsed) {
          walk(parsed, keyPath ? `${keyPath}.__parsed` : "__parsed", depth + 1);
          return;
        }
      }
      if (!IGNORE_KEY_RE.test(leafKey)) add(node, leafKey);
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${keyPath}[${i}]`, depth + 1);
        if (good.length + other.length >= MAX_COLLECTED_ITEMS) return;
      }
      return;
    }

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (IGNORE_KEY_RE.test(k)) continue;
        walk(v, keyPath ? `${keyPath}.${k}` : k, depth + 1);
        if (good.length + other.length >= MAX_COLLECTED_ITEMS) return;
      }
    }
  };

  walk(obj, "", 0);
  return [...good, ...other];
}

function pushValue(parts: string[], value: any) {
  if (value == null) return;
  if (parts.length >= MAX_COLLECTED_ITEMS) return;

  if (typeof value === "string") {
    if (looksLikeJson(value)) {
      const parsed = safeJsonParse(value);
      if (parsed) {
        for (const s of walkObject(parsed)) {
          parts.push(s);
          if (parts.length >= MAX_COLLECTED_ITEMS) break;
        }
        return;
      }
    }
    const n = normalizeOnce(value);
    if (isProbablyUsefulNormalizedString(n)) parts.push(n);
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      pushValue(parts, v);
      if (parts.length >= MAX_COLLECTED_ITEMS) break;
    }
    return;
  }

  if (typeof value === "object") {
    for (const s of walkObject(value)) {
      parts.push(s);
      if (parts.length >= MAX_COLLECTED_ITEMS) break;
    }
  }
}

function pickText(job: AnyRecord): { text: string; used_fields: string[] } {
  const parts: string[] = [];
  const used_fields: string[] = [];

  const header = buildHeader(job);
  if (header) parts.push(header);

  for (const k of [...PRIMARY_KEYS, ...TEXT_KEYS]) {
    if (k in job) {
      used_fields.push(k);
      pushValue(parts, job[k]);
    }
    if (parts.length >= MAX_COLLECTED_ITEMS) break;
  }

  for (const k of Object.keys(job)) {
    if (parts.length >= MAX_COLLECTED_ITEMS) break;
    if (JSON_KEYS_HINTS.some((h) => k.toLowerCase().includes(h))) {
      used_fields.push(k);
      pushValue(parts, job[k]);
    }
  }

  if (parts.length < 25) {
    for (const s of walkObject(job)) {
      parts.push(s);
      if (parts.length >= MAX_COLLECTED_ITEMS) break;
    }
  }

  const cleaned = uniqPreserveOrder(parts)
    .map((s) => normalizeOnce(s))
    .filter(
      (s) => s.startsWith("JOB HEADER:") || isProbablyUsefulNormalizedString(s),
    );

  let joined = cleaned.join("\n\n");
  if (!joined.trim()) joined = header.trim() ? header.trim() : "";

  const finalText =
    joined.length > MAX_TEXT_LEN ? joined.slice(0, MAX_TEXT_LEN) : joined;
  return { text: finalText, used_fields: uniqPreserveOrder(used_fields) };
}

/* =====================================================================================
  ATS-LIKE++ EXTRACTOR: skills + family + must/preferred tagger
===================================================================================== */
type JobFamily =
  | "legal"
  | "data"
  | "engineering"
  | "devops"
  | "product"
  | "pm"
  | "finance"
  | "hr"
  | "marketing"
  | "sales"
  | "customer"
  | "health"
  | "general";

type SkillDef = {
  canon: string;
  family: JobFamily;
  tags?: string[];
  phrases?: string[];
  regexes?: RegExp[];
};

type SkillHit = {
  canon: string;
  family: JobFamily;
  tags: string[];
  count: number;
  evidence: string[];
  score: number;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makePhraseRegex(phrase: string): RegExp {
  const p = phrase.trim();
  const hasWordCharsOnly = /^[a-z0-9 ]+$/i.test(p);
  if (hasWordCharsOnly) {
    const parts = p.split(/\s+/).map(escapeRegExp);
    return new RegExp(`\\b${parts.join("\\s+")}\\b`, "i");
  }
  const escaped = escapeRegExp(p);
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

function snippetAround(text: string, index: number, len = 140) {
  const start = Math.max(0, index - Math.floor(len / 2));
  const end = Math.min(text.length, start + len);
  return normalizeOnce(text.slice(start, end));
}

const NEGATION_RE =
  /\b(not required|not necessary|no need|pas obligatoire|non requis|non nécessaire|not needed)\b/i;

const MUST_RE =
  /\b(must|required|requirement|mandatory|you must|must have|minimum|min\.?|obligatoire|requis|exig[eé]|indispensable)\b/i;

const PREF_RE =
  /\b(preferred|nice to have|a plus|bonus|would be a plus|advantage|atout|serait un plus|souhait[eé]|id[eé]alement)\b/i;

const REQUIREMENTS_HEADINGS = [
  "requirements",
  "qualifications",
  "must have",
  "minimum qualifications",
  "profil recherché",
  "compétences requises",
  "what you bring",
  "who you are",
];

const RESPONSIBILITIES_HEADINGS = [
  "responsibilities",
  "what you'll be doing",
  "what you will do",
  "your responsibilities",
  "missions",
  "mission",
  "responsabilités",
];

const PREFERRED_HEADINGS = [
  "nice to have",
  "preferred",
  "bonus",
  "atout",
  "serait un plus",
  "preferred qualifications",
];

const ALL_HEADINGS = [
  ...REQUIREMENTS_HEADINGS,
  ...RESPONSIBILITIES_HEADINGS,
  ...PREFERRED_HEADINGS,
];

function pickSection(
  fullText: string,
  startHeadings: string[],
  stopHeadings: string[] = ALL_HEADINGS,
) {
  const lower = fullText.toLowerCase();

  let start = -1;
  for (const h of startHeadings) {
    const i = lower.indexOf(h.toLowerCase());
    if (i >= 0 && (start < 0 || i < start)) start = i;
  }
  if (start < 0) return "";

  let end = -1;
  for (const h of stopHeadings) {
    const i = lower.indexOf(h.toLowerCase(), start + 1);
    if (i >= 0 && (end < 0 || i < end)) end = i;
  }

  const hardEnd = start + 6000;
  const finalEnd =
    end > start ? Math.min(end, hardEnd) : Math.min(fullText.length, hardEnd);

  return fullText.slice(start, finalEnd);
}

/* --------------------------
  Skill ontology (ATS-like++)
-------------------------- */
const SKILLS: SkillDef[] = [
  // DATA / BI
  {
    canon: "excel",
    family: "data",
    tags: ["tool"],
    phrases: ["excel", "microsoft excel"],
  },
  {
    canon: "google sheets",
    family: "data",
    tags: ["tool"],
    phrases: ["google sheets", "google spreadsheet", "gsheets"],
  },
  { canon: "power bi", family: "data", tags: ["tool"], phrases: ["power bi", "powerbi"] },
  { canon: "tableau", family: "data", tags: ["tool"], phrases: ["tableau"] },
  { canon: "sql", family: "data", tags: ["skill"], phrases: ["sql"] },
  { canon: "postgresql", family: "data", tags: ["skill"], phrases: ["postgresql", "postgres"] },
  { canon: "mysql", family: "data", tags: ["skill"], phrases: ["mysql"] },

  // ENGINEERING
  { canon: "python", family: "engineering", tags: ["skill"], phrases: ["python"] },
  { canon: "javascript", family: "engineering", tags: ["skill"], phrases: ["javascript", "js"] },
  { canon: "typescript", family: "engineering", tags: ["skill"], phrases: ["typescript", "ts"] },
  { canon: "react", family: "engineering", tags: ["tool"], phrases: ["react", "reactjs", "react.js"] },
  { canon: "node.js", family: "engineering", tags: ["tool"], phrases: ["node", "nodejs", "node.js"] },
  { canon: "api", family: "engineering", tags: ["skill"], phrases: ["api", "rest api", "restful api"] },

  // DEVOPS
  { canon: "git", family: "devops", tags: ["tool"], phrases: ["git"] },
  { canon: "docker", family: "devops", tags: ["tool"], phrases: ["docker"] },
  { canon: "kubernetes", family: "devops", tags: ["tool"], phrases: ["kubernetes", "k8s"] },
  { canon: "ci/cd", family: "devops", tags: ["skill"], phrases: ["ci/cd", "cicd", "ci cd"] },
  { canon: "linux", family: "devops", tags: ["skill"], phrases: ["linux"] },
  { canon: "aws", family: "devops", tags: ["cloud"], phrases: ["aws", "amazon web services"] },
  { canon: "azure", family: "devops", tags: ["cloud"], phrases: ["azure", "microsoft azure"] },
  { canon: "gcp", family: "devops", tags: ["cloud"], phrases: ["gcp", "google cloud", "google cloud platform"] },

  // PM
  { canon: "agile", family: "pm", tags: ["method"], phrases: ["agile"] },
  { canon: "scrum", family: "pm", tags: ["method"], phrases: ["scrum"] },
  { canon: "kanban", family: "pm", tags: ["method"], phrases: ["kanban"] },
  { canon: "project management", family: "pm", tags: ["skill"], phrases: ["project management", "gestion de projet"] },
  { canon: "stakeholder management", family: "pm", tags: ["skill"], phrases: ["stakeholder management", "gestion des parties prenantes"] },
  { canon: "risk management", family: "pm", tags: ["skill"], phrases: ["risk management", "gestion des risques"] },

  // LEGAL
  { canon: "legal", family: "legal", tags: ["domain"], phrases: ["legal", "juridique"] },
  { canon: "compliance", family: "legal", tags: ["domain"], phrases: ["compliance", "conformité", "compliant"] },
  { canon: "corporate governance", family: "legal", tags: ["domain"], phrases: ["corporate governance", "gouvernance"] },
  { canon: "entity governance", family: "legal", tags: ["domain"], phrases: ["entity governance", "entity management"] },
  { canon: "corporate secretarial", family: "legal", tags: ["domain"], phrases: ["corporate secretarial", "company secretarial"] },
  { canon: "corporate housekeeping", family: "legal", tags: ["skill"], phrases: ["corporate housekeeping"] },
  { canon: "compliance calendar", family: "legal", tags: ["skill"], phrases: ["compliance calendar", "compliance calendars"] },
  { canon: "annual report", family: "legal", tags: ["doc"], phrases: ["annual report", "annual reports"] },
  { canon: "franchise tax", family: "legal", tags: ["domain"], phrases: ["franchise tax"] },
  { canon: "corporate records", family: "legal", tags: ["skill"], phrases: ["corporate records", "statutory records"] },
  { canon: "statutory filings", family: "legal", tags: ["skill"], phrases: ["statutory filings", "filings"] },
  { canon: "board minutes", family: "legal", tags: ["skill"], phrases: ["board minutes", "minutes", "procès-verbal", "pv"] },
  { canon: "contracts", family: "legal", tags: ["skill"], phrases: ["contract", "contracts", "contrat", "contrats"] },
  { canon: "contract drafting", family: "legal", tags: ["skill"], phrases: ["contract drafting", "rédaction de contrats"] },
  { canon: "contract management", family: "legal", tags: ["skill"], phrases: ["contract management", "gestion des contrats"] },
  { canon: "nda", family: "legal", tags: ["doc"], phrases: ["nda", "non disclosure agreement", "accord de confidentialité"] },
  { canon: "dpa", family: "legal", tags: ["doc"], phrases: ["dpa", "data processing agreement"] },
  { canon: "due diligence", family: "legal", tags: ["skill"], phrases: ["due diligence"] },
  { canon: "legal research", family: "legal", tags: ["skill"], phrases: ["legal research", "recherche juridique"] },
  { canon: "privacy", family: "legal", tags: ["domain"], phrases: ["privacy", "confidentiality", "confidentialité"] },
  { canon: "gdpr", family: "legal", tags: ["standard"], phrases: ["gdpr", "rgpd"] },
  { canon: "employment law", family: "legal", tags: ["domain"], phrases: ["employment law", "labor law", "droit du travail"] },
  { canon: "anti-corruption", family: "legal", tags: ["domain"], phrases: ["anti-corruption", "anti corruption", "anti-bribery"] },
  { canon: "fcpa", family: "legal", tags: ["standard"], phrases: ["fcpa"] },
  { canon: "ip law", family: "legal", tags: ["domain"], phrases: ["intellectual property", "ip law", "trademark", "copyright", "patent"] },
  { canon: "regulatory", family: "legal", tags: ["domain"], phrases: ["regulatory", "réglementaire"] },

  // SOFT / LANG
  { canon: "communication", family: "general", tags: ["soft"], phrases: ["communication"] },
  { canon: "leadership", family: "general", tags: ["soft"], phrases: ["leadership"] },
  { canon: "english", family: "general", tags: ["lang"], phrases: ["english", "anglais"] },
  { canon: "french", family: "general", tags: ["lang"], phrases: ["french", "français", "francais"] },
];

const CERT_REGEX: { canon: string; family: JobFamily; tags: string[]; re: RegExp }[] = [
  { canon: "pmp", family: "pm", tags: ["cert"], re: makePhraseRegex("PMP") },
  { canon: "prince2", family: "pm", tags: ["cert"], re: makePhraseRegex("PRINCE2") },
  { canon: "itil", family: "pm", tags: ["cert"], re: makePhraseRegex("ITIL") },
  { canon: "cfa", family: "finance", tags: ["cert"], re: makePhraseRegex("CFA") },
  { canon: "acca", family: "finance", tags: ["cert"], re: makePhraseRegex("ACCA") },
  { canon: "iso 27001", family: "devops", tags: ["standard"], re: makePhraseRegex("ISO 27001") },
  { canon: "iso 9001", family: "general", tags: ["standard"], re: makePhraseRegex("ISO 9001") },
];

const DEGREE_REGEXES: { level: string; re: RegExp }[] = [
  { level: "phd", re: /\b(phd|doctorate|doctorat)\b/i },
  { level: "master", re: /\b(master|msc|mba|maîtrise|dipl[oô]me\s+de\s+master)\b/i },
  { level: "bachelor", re: /\b(bachelor|bsc|licence)\b/i },
  { level: "associate", re: /\b(associate degree|dut|bts)\b/i },
];

const EXP_REGEXES: RegExp[] = [
  /\b(\d{1,2})\s*\+?\s*(years|year|yrs|ans|an)\s+(of\s+)?experience\b/i,
  /\b(minimum|min\.?)\s*(\d{1,2})\s*(years|yrs|ans)\b/i,
  /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(years|yrs|ans)\b/i,
];

type Detector = { canon: string; family: JobFamily; tags: string[]; re: RegExp };
let DETECTORS_CACHE: Detector[] | null = null;

function getDetectors(): Detector[] {
  if (DETECTORS_CACHE) return DETECTORS_CACHE;
  const out: Detector[] = [];

  for (const s of SKILLS) {
    const tags = s.tags ?? [];
    for (const p of s.phrases ?? []) {
      out.push({ canon: s.canon, family: s.family, tags, re: makePhraseRegex(p) });
    }
    for (const r of s.regexes ?? []) out.push({ canon: s.canon, family: s.family, tags, re: r });
  }
  for (const c of CERT_REGEX) out.push({ canon: c.canon, family: c.family, tags: c.tags, re: c.re });

  DETECTORS_CACHE = out;
  return out;
}

const FAMILY_BOOST: Record<JobFamily, number> = {
  legal: 1.25,
  data: 1.2,
  engineering: 1.2,
  devops: 1.2,
  product: 1.15,
  pm: 1.15,
  finance: 1.15,
  hr: 1.15,
  marketing: 1.1,
  sales: 1.1,
  customer: 1.05,
  health: 1.15,
  general: 1.0,
};

function classifyJobFamily(title: string, text: string, hits: SkillHit[]): JobFamily {
  const t = (title || "").toLowerCase();
  const x = (text || "").toLowerCase();

  const titleSignals: { fam: JobFamily; re: RegExp; w: number }[] = [
    { fam: "legal", re: /\b(legal|juridique|law|counsel|compliance|contract)\b/i, w: 4 },
    { fam: "data", re: /\b(data|bi|analytics|analyst|scientist)\b/i, w: 4 },
    { fam: "engineering", re: /\b(engineer|developer|software|frontend|backend|full[- ]?stack)\b/i, w: 4 },
    { fam: "devops", re: /\b(devops|sre|cloud|platform)\b/i, w: 4 },
    { fam: "pm", re: /\b(project manager|\bpm\b|chef de projet)\b/i, w: 4 },
    { fam: "product", re: /\b(product owner|product manager)\b/i, w: 4 },
    { fam: "finance", re: /\b(finance|accountant|comptable|audit|controller)\b/i, w: 4 },
    { fam: "hr", re: /\b(\bhr\b|human resources|recruit|recrut)\b/i, w: 4 },
    { fam: "marketing", re: /\b(marketing|seo|content|brand)\b/i, w: 4 },
    { fam: "sales", re: /\b(sales|commercial|business development|\bbd\b)\b/i, w: 4 },
    { fam: "customer", re: /\b(customer support|support|success)\b/i, w: 4 },
    { fam: "health", re: /\b(public health|pharmacy|clin(ic|ical)|epidemiolog)\b/i, w: 4 },
  ];

  const scores: Record<JobFamily, number> = {
    legal: 0, data: 0, engineering: 0, devops: 0, product: 0, pm: 0,
    finance: 0, hr: 0, marketing: 0, sales: 0, customer: 0, health: 0, general: 0,
  };

  for (const s of titleSignals) if (s.re.test(t)) scores[s.fam] += s.w;

  const contentSignals: { fam: JobFamily; re: RegExp; w: number }[] = [
    { fam: "legal", re: /\b(contract|nda|gdpr|compliance|governance|filings|privacy|secretarial|entity)\b/i, w: 2 },
    { fam: "data", re: /\b(sql|power bi|tableau|dashboard|etl|analytics)\b/i, w: 2 },
    { fam: "engineering", re: /\b(javascript|typescript|react|api|backend|frontend)\b/i, w: 2 },
    { fam: "devops", re: /\b(docker|kubernetes|ci\/cd|linux|aws|azure|gcp)\b/i, w: 2 },
    { fam: "pm", re: /\b(project management|risk management|stakeholder|reporting)\b/i, w: 2 },
    { fam: "product", re: /\b(roadmap|backlog|user stories|product)\b/i, w: 2 },
  ];
  for (const s of contentSignals) if (s.re.test(x)) scores[s.fam] += s.w;

  for (const h of hits) scores[h.family] += Math.min(h.count, 3) * 0.8;

  let best: JobFamily = "general";
  let bestScore = 0;
  for (const [fam, v] of Object.entries(scores) as [JobFamily, number][]) {
    if (v > bestScore) { bestScore = v; best = fam; }
  }
  return bestScore >= 3 ? best : "general";
}

function extractSkillsATS(textRaw: string, jobFamilyGuess: JobFamily, wantEvidence: boolean) {
  const text = textRaw;
  const lower = textRaw.toLowerCase();
  const map = new Map<string, SkillHit>();

  const addHit = (canon: string, family: JobFamily, tags: string[], idx: number) => {
    const existing = map.get(canon);
    const snip = wantEvidence ? snippetAround(text, idx, 140) : "";
    if (!existing) {
      map.set(canon, { canon, family, tags, count: 1, evidence: snip ? [snip] : [], score: 0 });
    } else {
      existing.count = Math.min(existing.count + 1, 5);
      if (snip && existing.evidence.length < 3 && !existing.evidence.includes(snip)) {
        existing.evidence.push(snip);
      }
    }
  };

  for (const d of getDetectors()) {
    if (!d.re.test(lower)) continue;

    const flags = (d.re.flags || "").replace(/g/g, "") + "g";
    const reG = new RegExp(d.re.source, flags);

    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = reG.exec(lower)) !== null) {
      const idx = typeof m.index === "number" ? m.index : 0;
      addHit(d.canon, d.family, d.tags, idx);
      count++;
      if (count >= 5) break;
      if (reG.lastIndex === m.index) reG.lastIndex++;
    }
  }

  const hits = Array.from(map.values());

  for (const h of hits) {
    const tagBonus =
      (h.tags.includes("cert") ? 0.8 : 0) +
      (h.tags.includes("standard") ? 0.6 : 0) +
      (h.tags.includes("tool") ? 0.35 : 0) +
      (h.tags.includes("soft") ? 0.15 : 0) +
      (h.tags.includes("lang") ? 0.2 : 0) +
      (h.tags.includes("doc") ? 0.25 : 0) +
      (h.tags.includes("domain") ? 0.2 : 0);

    const famBoost = (h.family === jobFamilyGuess ? FAMILY_BOOST[jobFamilyGuess] : 1.0);
    h.score = (Math.min(h.count, 5) + tagBonus) * famBoost;
  }

  hits.sort((a, b) => (b.score - a.score) || a.canon.localeCompare(b.canon));
  const skills = hits.map((h) => h.canon);
  return { skills, hits };
}

/* =====================================================================================
  MUST vs PREFERRED tagger (context + headings + bullets)
===================================================================================== */
type TagMode = "must" | "preferred" | "none";

const HEADING_MUST_RE =
  /\b(requirements|qualifications|minimum qualifications|must have|profil recherché|compétences requises|what you bring|who you are)\b/i;

const HEADING_PREF_RE =
  /\b(nice to have|preferred|bonus|atout|serait un plus|preferred qualifications)\b/i;

const HEADING_RESP_RE =
  /\b(responsibilities|your responsibilities|what you'll be doing|missions|responsabilités)\b/i;

function smartLineSplit(fullText: string): string[] {
  const t = fullText
    .replace(/\r/g, "")
    .replace(/\u2022/g, "\n- ")
    .replace(/•/g, "\n- ")
    .replace(/:\s+/g, ":\n")
    .replace(/\s[-–—]\s+/g, "\n- ")
    .replace(/;\s+/g, ";\n");

  return t.split("\n");
}

function tagMustPreferredContextual(fullText: string, family: JobFamily, wantEvidence: boolean) {
  const rawLines = smartLineSplit(fullText);

  const mustSet = new Set<string>();
  const prefSet = new Set<string>();

  let mode: TagMode = "none";

  const pushSkills = (line: string, target: TagMode) => {
    const extracted = extractSkillsATS(line, family, wantEvidence);
    for (const s of extracted.skills) {
      if (target === "must") mustSet.add(s.toLowerCase());
      if (target === "preferred") prefSet.add(s.toLowerCase());
    }
  };

  for (const raw of rawLines) {
    const line = normalizeOnce(raw);
    if (!line) { mode = "none"; continue; }
    if (line.length > 650) continue;

    const isNeg = NEGATION_RE.test(line);

    if (!isNeg && HEADING_MUST_RE.test(line)) {
      mode = "must";
      const rest = line.split(/:\s*/).slice(1).join(": ").trim();
      if (rest.length >= 8) pushSkills(rest, "must");
      continue;
    }

    if (!isNeg && HEADING_PREF_RE.test(line)) {
      mode = "preferred";
      const rest = line.split(/:\s*/).slice(1).join(": ").trim();
      if (rest.length >= 8) pushSkills(rest, "preferred");
      continue;
    }

    if (HEADING_RESP_RE.test(line)) {
      mode = "none";
      continue;
    }

    const isMust = MUST_RE.test(line) && !isNeg;
    const isPref = PREF_RE.test(line) && !isNeg;

    if (isMust) { pushSkills(line, "must"); continue; }
    if (isPref) { pushSkills(line, "preferred"); continue; }

    const isBullet = /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line);

    if (isBullet && mode !== "none" && !isNeg) {
      pushSkills(line, mode);
      continue;
    }

    if (mode !== "none" && !isNeg && line.length <= 260) {
      const extracted = extractSkillsATS(line, family, false);
      if (extracted.skills.length) pushSkills(line, mode);
    }
  }

  for (const s of mustSet) prefSet.delete(s);

  return {
    must: Array.from(mustSet),
    preferred: Array.from(prefSet),
  };
}

function extractExperienceYears(text: string) {
  const lower = text.toLowerCase();
  let min: number | null = null;
  let max: number | null = null;

  for (const re of EXP_REGEXES) {
    if (!re.test(lower)) continue;

    const range = lower.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(years|yrs|ans)\b/i);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        min = min == null ? Math.min(a, b) : Math.min(min, Math.min(a, b));
        max = max == null ? Math.max(a, b) : Math.max(max, Math.max(a, b));
      }
      continue;
    }

    const minOnly = lower.match(/\b(minimum|min\.?)\s*(\d{1,2})\s*(years|yrs|ans)\b/i);
    if (minOnly) {
      const a = parseInt(minOnly[2], 10);
      if (!Number.isNaN(a)) min = min == null ? a : Math.min(min, a);
      continue;
    }

    const any = lower.match(/\b(\d{1,2})\s*\+?\s*(years|year|yrs|ans|an)\s+(of\s+)?experience\b/i);
    if (any) {
      const a = parseInt(any[1], 10);
      if (!Number.isNaN(a)) min = min == null ? a : Math.min(min, a);
    }
  }

  return { experience_years_min: min, experience_years_max: max };
}

function extractDegree(text: string) {
  for (const d of DEGREE_REGEXES) if (d.re.test(text)) return d.level;
  return null;
}

/* =====================================================================================
  MAIN HANDLER
===================================================================================== */
type RequiredMode = "must" | "requirements" | "fallback_split" | "fallback_all";

function computeAgeDays(enrichedAt: any): number | null {
  if (!enrichedAt) return null;
  const t = new Date(enrichedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    // 0) Guard content-type (évite les surprises)
    const ct = getContentType(request);
    if (!ct.includes("application/json")) {
      return jsonResponse(
        { ok: false, error: "UNSUPPORTED_CONTENT_TYPE", details: ct || null },
        415,
      );
    }

    const body = await safeReadJson(request);
    if (!body || typeof body !== "object") {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const job_id = (body as any).job_id as unknown;
    const debug = (body as any)?.debug === true || (body as any)?.debug === "true";
    const force = (body as any)?.force === true || (body as any)?.force === "true";

    const stale_after_days =
      typeof (body as any)?.stale_after_days === "number"
        ? (body as any).stale_after_days
        : (typeof (body as any)?.stale_after_days === "string"
          ? Number((body as any).stale_after_days)
          : 14);

    // persist: par défaut true (sauf debug), mais tu peux forcer persist en debug
    const persist =
      typeof (body as any)?.persist === "boolean"
        ? (body as any).persist
        : (debug ? false : true);

    // 1) Validation job_id UUID
    if (!isUuid(job_id)) {
      return jsonResponse(
        { ok: false, error: "INVALID_JOB_ID", details: "job_id must be a UUID" },
        400,
      );
    }

    const authorizationHeader = request.headers.get("Authorization");
    const supabase = getSupabaseClient(authorizationHeader);

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return jsonResponse(
        { ok: false, error: "Job not found", details: jobErr?.message ?? null, job_id },
        404,
      );
    }

    // ✅ Skip si pas force et enrich récent
    if (!force && job.enriched_at) {
      const ageDays = computeAgeDays(job.enriched_at);
      if (ageDays != null && Number.isFinite(stale_after_days) && ageDays < stale_after_days) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: "FRESH_ENOUGH",
          job_id,
          enriched_at: job.enriched_at,
          enrich_version: job.enrich_version ?? null,
          enrichment_id: job.enrichment_id ?? null,
          snapshot: {
            job_family: job.job_family ?? null,
            job_skills: job.job_skills ?? null,
            required_skills: job.required_skills ?? null,
            optional_skills: job.optional_skills ?? null,
            degree_required: job.degree_required ?? null,
            experience_years_min: job.experience_years_min ?? null,
            experience_years_max: job.experience_years_max ?? null,
          },
        });
      }
    }

    const built = pickText(job);
    let job_text = built.text;

    const urlCandidates = [
      job.apply_url, job.source_url, job.url, job.link, job.applyUrl, job.sourceUrl,
    ].filter((x: any) => typeof x === "string" && x);

    let url_used = "";
    let url_text = "";
    let url_reason: string | undefined;

    if (job_text.length < 400 && urlCandidates.length) {
      url_used = urlCandidates[0];
      const fetched = await fetchUrlText(url_used);
      url_text = fetched.text;
      url_reason = fetched.reason;

      if (url_text && url_text.length > job_text.length) {
        job_text = `${job_text}\n\n[FROM_URL]\n${url_text}`.slice(0, MAX_TEXT_LEN);
      }
    }

    const title = normalizeOnce(job.title ?? job.job_title ?? job.position ?? job.role ?? "") || "";
    const t0 = Date.now();

    // pass 1: family guess
    const pre = extractSkillsATS(job_text, "general", debug);
    const family = classifyJobFamily(title, job_text, pre.hits);

    // pass 2: all skills
    const allExtract = extractSkillsATS(job_text, family, debug);

    // sections
    const requirementsText = pickSection(job_text, REQUIREMENTS_HEADINGS, ALL_HEADINGS);
    const responsibilitiesText = pickSection(job_text, RESPONSIBILITIES_HEADINGS, ALL_HEADINGS);
    const preferredText = pickSection(job_text, PREFERRED_HEADINGS, ALL_HEADINGS);

    const requirementsNegated = requirementsText ? NEGATION_RE.test(requirementsText) : false;

    // tagger contextual
    const tagged = tagMustPreferredContextual(job_text, family, debug);

    const mustSet = new Set<string>();
    const prefSet = new Set<string>();

    for (const s of tagged.must) mustSet.add(s.toLowerCase());
    for (const s of tagged.preferred) prefSet.add(s.toLowerCase());

    // requirements section -> MUST-ish
    const reqSkills = requirementsText ? extractSkillsATS(requirementsText, family, debug).skills : [];
    if (requirementsText && !requirementsNegated) {
      for (const s of reqSkills) mustSet.add(s.toLowerCase());
    }

    // preferred section
    const prefSkills = preferredText ? extractSkillsATS(preferredText, family, debug).skills : [];
    for (const s of prefSkills) prefSet.add(s.toLowerCase());

    // overlaps
    for (const s of mustSet) prefSet.delete(s);

    // baseSkills: on préfère responsibilities si dispo, sinon allExtract
    const respSkills = responsibilitiesText ? extractSkillsATS(responsibilitiesText, family, debug).skills : [];
    const baseSkills = respSkills.length ? respSkills : allExtract.skills;

    // ✅ required jamais vide en fallback
    let required_mode: RequiredMode = "fallback_all";
    let required_skills: string[] = [];
    let optional_skills: string[] = [];

    if (mustSet.size > 0) {
      required_mode = "must";
      const must = Array.from(mustSet);
      const mustLower = new Set(must.map((s) => s.toLowerCase()));
      const ordered = baseSkills.filter((s) => mustLower.has(s.toLowerCase()));
      const orderedLower = new Set(ordered.map((x) => x.toLowerCase()));
      const rest = must.filter((s) => !orderedLower.has(s.toLowerCase()));
      required_skills = [...ordered, ...rest];

      const reqLower = new Set(required_skills.map((s) => s.toLowerCase()));
      optional_skills = Array.from(prefSet).filter((s) => !reqLower.has(s.toLowerCase()));
    } else if (reqSkills.length > 0 && !requirementsNegated) {
      required_mode = "requirements";
      const reqLower = new Set(reqSkills.map((s) => s.toLowerCase()));
      required_skills = baseSkills.filter((s) => reqLower.has(s.toLowerCase()));
      if (!required_skills.length) required_skills = Array.from(reqLower);

      const reqL = new Set(required_skills.map((s) => s.toLowerCase()));
      optional_skills = Array.from(prefSet).filter((s) => !reqL.has(s.toLowerCase()));
    } else {
      const prefLower = new Set(Array.from(prefSet).map((s) => s.toLowerCase()));
      const filtered = baseSkills.filter((s) => !prefLower.has(s.toLowerCase()));

      if (prefSet.size > 0) required_mode = "fallback_split";
      else required_mode = "fallback_all";

      required_skills = filtered.length ? filtered : baseSkills;

      const reqL = new Set(required_skills.map((s) => s.toLowerCase()));
      optional_skills = Array.from(prefSet).filter((s) => !reqL.has(s.toLowerCase()));
    }

    const degree = extractDegree(job_text);
    const exp = extractExperienceYears(job_text);

    const t1 = Date.now();

    // ✅ Objet enrichissement (ce que ta RPC attend)
    const enrichmentPayload = {
      job_family: family,
      job_skills: allExtract.skills,
      required_skills,
      optional_skills,
      degree_required: degree,
      experience_years_min: exp.experience_years_min,
      experience_years_max: exp.experience_years_max,
    };

    // ✅ Persist en DB (job_enrichments + snapshot jobs) via RPC atomique
    let persisted: any = null;
    if (persist) {
      if (!hasServiceRoleConfigured()) {
        return jsonResponse(
          {
            ok: false,
            error: "SERVICE_ROLE_REQUIRED",
            details:
              "SUPABASE_SERVICE_ROLE_KEY manquant. Ajoute-le dans Project Settings → Functions → Secrets, puis redeploy.",
          },
          500,
        );
      }

      const meta = {
        source: "job_enrich_ats",
        prompt_version: "job_enrich_ats_v1",
        code_version: CODE_VERSION,
        timing_ms: t1 - t0,
        required_mode,
        used_fields: built.used_fields,
        url_used: url_used || null,
        url_reason: url_reason || null,
        job_text_len: job_text.length,
        debug: !!debug,
      };

      const { data: rpcData, error: rpcErr } = await supabase.rpc("insert_job_enrichment", {
        p_job_id: job_id,
        p_enrichment: enrichmentPayload,
        p_meta: meta,
      });

      if (rpcErr) {
        return jsonResponse(
          { ok: false, error: "DB_WRITE_FAILED", details: rpcErr.message, job_id },
          500,
        );
      }

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      persisted = {
        enrichment_id: row?.enrichment_id ?? null,
        version: row?.version ?? null,
      };
    }

    if (debug) {
      const keys = Object.keys(job ?? {});
      const job_keys_hint = keys.filter((k) =>
        /desc|summary|content|body|text|html|markdown|payload|raw|data|json|meta|apply|source|url|link/i.test(k)
      );

      const top = allExtract.hits.slice(0, 40).map((h) => ({
        ...h,
        evidence: (h.evidence ?? []).slice(0, 3),
      }));

      return jsonResponse({
        ok: true,
        debug: true,

        job_id,
        persisted,

        job_title_extracted: title || null,
        job_family: family,

        job_text_len: job_text.length,
        job_text_preview: job_text.slice(0, 1200),

        job_keys_hint,
        used_fields: built.used_fields,

        url_used: url_used || null,
        url_text_len: url_text.length,
        url_text_preview: url_text.slice(0, 600),
        url_reason: url_reason || null,

        detectors_count: getDetectors().length,

        requirements_found: !!requirementsText,
        responsibilities_found: !!responsibilitiesText,
        preferred_found: !!preferredText,
        requirements_negated: requirementsNegated,

        required_mode,

        must_from_lines_count: tagged.must.length,
        preferred_from_lines_count: tagged.preferred.length,
        must_from_lines_sample: tagged.must.slice(0, 25),
        preferred_from_lines_sample: tagged.preferred.slice(0, 25),

        skills_all_count: allExtract.skills.length,
        skills_required_count: required_skills.length,
        skills_optional_count: optional_skills.length,

        required_skills_sample: required_skills.slice(0, 25),
        optional_skills_sample: optional_skills.slice(0, 25),

        degree_required: degree,
        experience_years_min: exp.experience_years_min,
        experience_years_max: exp.experience_years_max,

        skills_all_top: top,

        timing_ms: t1 - t0,
        enrichment_payload: enrichmentPayload,
      });
    }

    return jsonResponse({
      ok: true,

      job_id,
      persisted,

      job_title_extracted: title || null,
      job_family: family,

      job_text_len: job_text.length,

      job_skills_count: allExtract.skills.length,
      required_skills_count: required_skills.length,
      optional_skills_count: optional_skills.length,

      job_skills: allExtract.skills,
      required_skills,
      optional_skills,

      degree_required: degree,
      experience_years_min: exp.experience_years_min,
      experience_years_max: exp.experience_years_max,

      url_used: url_used || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, error: "Unhandled error", details: msg }, 500);
  }
});
