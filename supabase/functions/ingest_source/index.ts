// supabase/functions/ingest_source/index.ts
import { fetchEmploiCiItems } from "./sources/emploi_ci.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}_missing`);
  return v;
}

function baseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  } as Record<string, string>;
}

async function sbGet<T>(url: string, serviceKey: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: baseHeaders(serviceKey),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_get_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

async function sbInsertOne<T>(url: string, serviceKey: string, row: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_insert_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

async function sbPatch<T>(url: string, serviceKey: string, patch: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_patch_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

Deno.serve(async (req) => {
  // Healthcheck
  if (req.method === "GET") return json({ ok: true, status: "ingest_source_alive" });

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Auth via x-cron-secret
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, error: "CRON_SECRET_not_set_in_env" }, 500);

  const provided = req.headers.get("x-cron-secret");
  if (provided !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  // Body JSON
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json_body" }, 400);
  }

  const source_code = body?.source_code;
  const limit = Number(body?.limit ?? 30);
  const dry_run = Boolean(body?.dry_run ?? false);

  if (!source_code || typeof source_code !== "string") {
    return json({ ok: false, error: "missing_source_code" }, 400);
  }

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    switch (source_code) {
      case "emploi_ci": {
        const data = await fetchEmploiCiItems(limit);

        if (dry_run) {
          return json({
            ok: true,
            source_code,
            limit,
            dry_run: true,
            status: "dry_run_parsed",
            list_url: data.list_url,
            parsed: data.parsed,
            sample: data.sample,
          });
        }

        // ✅ job_source_id (temporaire en dur pour valider l’ingestion)
        const job_source_id = "ed25b64d-ace6-4296-8985-46702d58785d";

        const now = new Date().toISOString();
        const jobsBase = `${supabaseUrl}/rest/v1/jobs`;

        let inserted = 0;
        let updated = 0;

        // Upsert manuel : check -> insert ou patch
        for (const it of data.items) {
          const external_id = it.external_id;

          // 1) existe déjà ?
          const checkUrl =
            `${jobsBase}?select=id&job_source_id=eq.${job_source_id}` +
            `&external_id=eq.${encodeURIComponent(external_id)}&limit=1`;

          const found = await sbGet<Array<{ id: string }>>(checkUrl, serviceKey);
          const exists = found?.length ? found[0].id : null;

          // champs communs
          const baseRow = {
            job_source_id,
            external_id,
            title: it.title,
            company_name: null,
            location: it.location, // "Cote d'Ivoire"
            country: it.country,   // "CI"

            remote_type: null,
            contract_type: null,
            seniority: null,

            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,

            description_html: null,
            description_text: null,

            apply_url: it.url,
            source_url: it.url,

            tags: [],

            posted_at: null,
            published_at: null,
            expires_at: null,

            updated_at: now,
            last_seen_at: now,
            sort_at: now,

            is_active: true,
            is_expired: false,

            job_json: {
              source_code: "emploi_ci",
              provider: "educarriere",
              fetched_from: data.list_url,
              original_url: it.url,
            },
          };

          if (!exists) {
            // INSERT
            const row = {
              ...baseRow,
              scraped_at: now,
              created_at: now,
            };

            await sbInsertOne(jobsBase, serviceKey, row);
            inserted++;
          } else {
            // PATCH (update)
            const patchUrl =
              `${jobsBase}?job_source_id=eq.${job_source_id}` +
              `&external_id=eq.${encodeURIComponent(external_id)}`;

            await sbPatch(patchUrl, serviceKey, baseRow);
            updated++;
          }
        }

        return json({
          ok: true,
          source_code,
          limit,
          dry_run: false,
          status: "upserted_manual",
          parsed: data.parsed,
          inserted,
          updated,
        });
      }

      default:
        return json({ ok: true, source_code, limit, dry_run, status: "unknown_source_code" });
    }
  } catch (e) {
    return json(
      { ok: false, error: "ingest_failed", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
