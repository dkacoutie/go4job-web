import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JobRow = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country: string | null;
  remote_type: string | null;
  contract_type: string | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  job_family: string | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  job_skills: string[] | null;
  tags: string[] | string | null;
  description_text: string | null;
  description_html: string | null;
  official_desc: string | null;
};

const MIN_DESC_LEN = 400;
const DEFAULT_MODEL = "heuristic-v1";

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html: string) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return normalizeText(doc.body.textContent ?? "");
  } catch {
    return normalizeText(
      (html ?? "")
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/?[^>]+(>|$)/g, " ")
    );
  }
}

function currentDescText(job: JobRow) {
  const official = (job.official_desc ?? "").trim();
  if (official) return official;
  const text = (job.description_text ?? "").trim();
  if (text) return text;
  const html = (job.description_html ?? "").trim();
  if (!html) return "";
  return stripHtmlToText(html);
}

function isSufficient(text: string) {
  return text.trim().length >= MIN_DESC_LEN;
}

function uniq(list: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const k = v.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function toArrayTags(tags: JobRow["tags"]) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function roleCategory(title: string, family: string) {
  const t = `${title} ${family}`.toLowerCase();
  if (/(data|analytics|bi|ml|ai|machine|scientist)/.test(t)) return "data";
  if (/(product|growth|marketing)/.test(t)) return "product";
  if (/(design|ux|ui)/.test(t)) return "design";
  if (/(sales|account|business development)/.test(t)) return "sales";
  if (/(hr|recruit|talent)/.test(t)) return "hr";
  if (/(finance|compta|accounting)/.test(t)) return "finance";
  if (/(dev|software|engineer|frontend|backend|fullstack|cloud|devops)/.test(t)) return "engineering";
  return "general";
}

function formatSalary(job: JobRow) {
  if (job.salary_min == null && job.salary_max == null) return "";
  const min = job.salary_min != null ? Math.round(job.salary_min) : null;
  const max = job.salary_max != null ? Math.round(job.salary_max) : null;
  const currency = job.salary_currency ?? "";
  const period = job.salary_period ? ` / ${job.salary_period}` : "";
  if (min != null && max != null) return `${min}-${max} ${currency}${period}`.trim();
  if (min != null) return `${min} ${currency}${period}`.trim();
  if (max != null) return `${max} ${currency}${period}`.trim();
  return "";
}

function buildAiDescription(job: JobRow) {
  const title = job.title?.trim() || "";
  if (!title) return { ok: false, error: "missing_title" };

  const company = job.company_name?.trim() || "";
  const location = job.location?.trim() || job.country?.trim() || "";
  const remote = job.remote_type?.trim() || "";
  const seniority = job.seniority?.trim() || "";
  const contract = job.contract_type?.trim() || "";
  const family = job.job_family?.trim() || "";

  const skills = uniq(
    [
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
      ...toArrayTags(job.tags),
    ].map((s) => s.trim()).filter(Boolean)
  ).slice(0, 15);

  const salary = formatSalary(job);
  const category = roleCategory(title, family);

  const signals: string[] = [];
  if (title) signals.push("title");
  if (company) signals.push("company");
  if (location || remote) signals.push("location");
  if (contract) signals.push("contract");
  if (seniority) signals.push("seniority");
  if (family) signals.push("family");
  if (skills.length > 0) signals.push("skills");
  if (salary) signals.push("salary");

  if (signals.length < 3) {
    return { ok: false, error: "not_enough_signals" };
  }

  const summaryParts = [
    `Nous recrutons un(e) ${title}`,
    company ? `chez ${company}` : "",
    remote ? `(mode ${remote})` : location ? `(${location})` : "",
  ].filter(Boolean);

  const summary = summaryParts.join(" ");

  const missions = [
    `Concevoir et faire avancer les initiatives clefs pour le role ${title}.`,
    family ? `Structurer les activites ${family} et les prioriser avec l'equipe.` : `Collaborer avec les equipes produit et operations.`,
    category === "data"
      ? "Transformer les donnees en decisions actionnables."
      : category === "engineering"
      ? "Livrer des evolutions techniques fiables et maintenables."
      : "Assurer un suivi rigoureux des objectifs et des resultats.",
    skills.length ? `Utiliser au quotidien des competences comme ${skills.slice(0, 4).join(", ")}.` : "Assurer une execution de qualite et une documentation claire.",
  ].slice(0, 6);

  const profile = [
    seniority ? `Niveau attendu: ${seniority}.` : "Experience pertinente sur des missions similaires.",
    skills.length ? `Maitrise d'au moins ${Math.min(5, skills.length)} competences clefs.` : "Capacite a apprendre vite et a structurer les priorites.",
    contract ? `Type de contrat: ${contract}.` : "Autonomie et rigueur attendues.",
  ].slice(0, 5);

  const skillsList = skills.length ? skills : ["organisation", "communication", "analyse"];

  const conditions = [
    remote ? `Mode: ${remote}.` : "",
    location ? `Localisation: ${location}.` : "",
    contract ? `Contrat: ${contract}.` : "",
    salary ? `Salaire: ${salary}.` : "",
  ].filter(Boolean);

  const lines: string[] = [];
  lines.push("Resume:");
  lines.push(`- ${summary}.`);
  lines.push("");
  lines.push("Missions:");
  for (const m of missions) lines.push(`- ${m}`);
  lines.push("");
  lines.push("Profil recherche:");
  for (const p of profile) lines.push(`- ${p}`);
  lines.push("");
  lines.push("Competences cles:");
  lines.push(`- ${skillsList.join(", ")}`);
  if (conditions.length) {
    lines.push("");
    lines.push("Conditions:");
    for (const c of conditions) lines.push(`- ${c}`);
  }

  const text = lines.join("\n").trim();
  const quality = Math.min(100, 55 + signals.length * 8 + Math.min(20, skills.length * 2));

  return {
    ok: true,
    text,
    quality,
    signals,
    model: DEFAULT_MODEL,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST,OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" }, corsHeaders);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!SUPABASE_URL) return json(500, { ok: false, error: "Missing SUPABASE_URL env" }, corsHeaders);
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY env" }, corsHeaders);
  }
  if (!SUPABASE_ANON_KEY) return json(500, { ok: false, error: "Missing SUPABASE_ANON_KEY env" }, corsHeaders);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json(401, { ok: false, error: "Missing auth header" }, corsHeaders);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json(401, { ok: false, error: "Unauthorized" }, corsHeaders);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" }, corsHeaders);
  }

  const jobId = String(body?.job_id ?? "").trim();
  const force = Boolean(body?.force ?? false);
  if (!jobId) return json(400, { ok: false, error: "job_id_required" }, corsHeaders);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      `id,title,company_name,location,country,remote_type,contract_type,seniority,
       salary_min,salary_max,salary_currency,salary_period,job_family,required_skills,optional_skills,job_skills,tags,
       description_text,description_html,official_desc`
    )
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr) return json(500, { ok: false, error: jobErr.message }, corsHeaders);
  if (!job) return json(404, { ok: false, error: "job_not_found" }, corsHeaders);

  const current = currentDescText(job as JobRow);
  if (!force && isSufficient(current)) {
    return json(200, { ok: true, status: "already_sufficient" }, corsHeaders);
  }

  const gen = buildAiDescription(job as JobRow);
  const nowIso = new Date().toISOString();

  if (!gen.ok) {
    await supabase
      .from("jobs")
      .update({
        ai_description_status: "failed",
        ai_description_error: String(gen.error),
        ai_description_updated_at: nowIso,
      })
      .eq("id", jobId);
    return json(200, { ok: false, error: gen.error }, corsHeaders);
  }

  const patch: Record<string, unknown> = {
    ai_description: gen.text,
    ai_description_status: "ok",
    ai_description_model: gen.model,
    ai_description_quality: gen.quality,
    ai_description_updated_at: nowIso,
    ai_description_error: null,
    desc_source: "ai",
    desc_quality: gen.quality,
    desc_updated_at: nowIso,
  };

  const { error: upErr } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (upErr) return json(500, { ok: false, error: upErr.message }, corsHeaders);

  return json(
    200,
    {
      ok: true,
      status: "generated",
      quality: gen.quality,
    },
    corsHeaders
  );
});
