import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.88.0";

type SourceTarget = {
  code: string;
  limit: number;
};

type SourceRow = {
  id: string;
  code: string;
};

type JobExportRow = {
  id: string;
  source_code: string;
  title: string | null;
  company_name: string | null;
  job_family: string | null;
  tags: string[] | string | null;
  description_text: string | null;
  official_desc: string | null;
  job_json: Record<string, unknown> | null;
  contract_type: string | null;
  location: string | null;
  country: string | null;
  published_at: string | null;
};

const SOURCE_TARGETS: SourceTarget[] = [
  { code: "adzuna_api", limit: 500 },
  { code: "france_travail_api", limit: 500 },
  { code: "rss_nofluffjobs", limit: 400 },
  { code: "rss_remoteyeah_all", limit: 300 },
  { code: "emploi_territorial_rss", limit: 300 },
];

const DEFAULT_OUTPUT_PATH =
  ".codex-artifacts/job-family-export/jobs-export-2000.json";

function parseArgs() {
  const parsed = new Map<string, string>();
  for (const arg of Deno.args) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=", 2);
    parsed.set(key, value);
  }

  return {
    output: parsed.get("output") ?? DEFAULT_OUTPUT_PATH,
  };
}

async function readDotEnvValue(key: string): Promise<string | null> {
  try {
    const content = await Deno.readTextFile(".env");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [left, ...rest] = trimmed.split("=");
      if (left.trim() !== key) continue;
      return rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // optional local env file
  }
  return null;
}

async function getEnvValue(
  keys: string[],
  label: string,
): Promise<string> {
  for (const key of keys) {
    const fromEnv = Deno.env.get(key)?.trim();
    if (fromEnv) return fromEnv;
    const fromFile = await readDotEnvValue(key);
    if (fromFile) return fromFile;
  }
  throw new Error(`Missing ${label}: tried ${keys.join(", ")}`);
}

async function fetchSources(
  supabase: SupabaseClient<any>,
): Promise<Map<string, SourceRow>> {
  const codes = SOURCE_TARGETS.map((source) => source.code);
  const { data, error } = await supabase
    .from("job_sources")
    .select("id, code")
    .in("code", codes);

  if (error) throw error;

  const sources = new Map<string, SourceRow>();
  for (const row of (data ?? []) as SourceRow[]) {
    sources.set(row.code, row);
  }

  return sources;
}

async function fetchJobsForSource(
  supabase: SupabaseClient<any>,
  source: SourceRow,
  limit: number,
): Promise<JobExportRow[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      [
        "id",
        "title",
        "company_name",
        "job_family",
        "tags",
        "description_text",
        "official_desc",
        "job_json",
        "contract_type",
        "location",
        "country",
        "published_at",
      ].join(", "),
    )
    .eq("job_source_id", source.id)
    .eq("is_active", true)
    .eq("is_expired", false)
    .or("quality_status.eq.ok,quality_status.is.null")
    .or(
      "job_family.is.null,job_family.eq.,job_family.eq.other_uncategorized,job_family.eq.uncategorized",
    )
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as unknown as Omit<JobExportRow, "source_code">[]).map((
    job,
  ) => ({
    ...job,
    source_code: source.code,
  }));
}

async function writeJson(path: string, rows: JobExportRow[]) {
  const parent = path.replace(/[\\/][^\\/]+$/, "");
  if (parent && parent !== path) {
    await Deno.mkdir(parent, { recursive: true });
  }
  await Deno.writeTextFile(path, `${JSON.stringify(rows, null, 2)}\n`);
}

async function main() {
  const args = parseArgs();
  const supabaseUrl = await getEnvValue(
    ["SUPABASE_URL", "VITE_SUPABASE_URL"],
    "Supabase URL",
  );
  const supabaseKey = await getEnvValue(
    [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "VITE_SUPABASE_ANON_KEY",
    ],
    "Supabase read key",
  );
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const sources = await fetchSources(supabase);
  const rows: JobExportRow[] = [];
  const counts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const target of SOURCE_TARGETS) {
    const source = sources.get(target.code);
    if (!source) {
      counts[target.code] = 0;
      warnings.push(`missing_source:${target.code}`);
      continue;
    }

    const sourceRows = await fetchJobsForSource(
      supabase,
      source,
      target.limit,
    );
    rows.push(...sourceRows);
    counts[target.code] = sourceRows.length;
    if (sourceRows.length < target.limit) {
      warnings.push(
        `under_target:${target.code}:${sourceRows.length}/${target.limit}`,
      );
    }
  }

  await writeJson(args.output, rows);

  console.log(JSON.stringify(
    {
      ok: true,
      output: args.output,
      total_exported: rows.length,
      target_total: SOURCE_TARGETS.reduce(
        (sum, source) => sum + source.limit,
        0,
      ),
      counts,
      warnings,
    },
    null,
    2,
  ));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
