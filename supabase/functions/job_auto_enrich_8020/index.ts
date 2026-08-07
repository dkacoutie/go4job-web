import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JobRow = {
    id: string;
    source_url: string | null;
    apply_url: string | null;
    apply_email?: string | null;
    external_id: string | null;
    description_text: string | null;
    description_html: string | null;
    job_json?: Record<string, unknown> | null;
    quality_status?: string | null;
    published_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

const MIN_DESC_LEN = 200;
const MAX_DESC_LEN = 20000;

const DROP_QUERY_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "trk",
    "trkEmail",
    "ref",
    "referrer",
    "source",
    "campaign",
    "scid",
    "spm",
  ];

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

function extractMain(html: string) {
    try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html ?? "", "text/html");

      const removeSelectors = "script,style,noscript,iframe,object,embed,svg,header,footer,nav,aside,form";
          doc.querySelectorAll(removeSelectors).forEach((n) => n.remove());

      const selectors = [
              "[itemprop='description']",
              ".job-description",
              ".job_desc",
              ".offer-description",
              ".offre-description",
              ".description",
              "#description",
              ".content",
              "article",
              "main",
            ];

      const candidates = new Set<Element>();
          for (const sel of selectors) {
                  doc.querySelectorAll(sel).forEach((el) => candidates.add(el));
          }
          if (candidates.size === 0 && doc.body) candidates.add(doc.body);

      let best: Element | null = null;
          let bestLen = 0;
          for (const el of candidates) {
                  const txt = normalizeText(el.textContent ?? "");
                  if (txt.length > bestLen) {
                            best = el;
                            bestLen = txt.length;
                  }
          }

      if (!best) return { html: "", text: "" };

      const htmlOut = (best.innerHTML ?? "").trim();
          const textOut = normalizeText(best.textContent ?? "");

      return { html: htmlOut, text: textOut };
    } catch {
          const text = stripHtmlToText(html ?? "");
          return { html: "", text };
    }
}

function safeTruncate(input: string, max: number) {
    if (input.length <= max) return input;
    return input.slice(0, max).trim();
}

function canonicalizeUrl(raw: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
          const url = new URL(trimmed);
          url.hash = "";

      const params = new URLSearchParams(url.search);
          for (const key of Array.from(params.keys())) {
                  if (key.toLowerCase().startsWith("utm_") || DROP_QUERY_KEYS.includes(key.toLowerCase())) {
                            params.delete(key);
                  }
          }

      const query = params.toString();
          const path = url.pathname.replace(/\/+$/, "") || "/";

      const canonical = `${url.origin}${path}${query ? `?${query}` : ""}`;
          return canonical;
    } catch {
          return null;
    }
}

function isEmail(value: string) {
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function extractApplyFromHtml(html: string, baseUrl: string | null) {
    const out: { apply_url?: string; apply_email?: string } = {};
    try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html ?? "", "text/html");
          const anchors = Array.from(doc.querySelectorAll("a[href]"));
          for (const a of anchors) {
                  const href = (a.getAttribute("href") ?? "").trim();
                  const text = (a.textContent ?? "").toLowerCase();
                  if (!href) continue;

            if (href.toLowerCase().startsWith("mailto:")) {
                      const email = href.replace(/^mailto:/i, "").split("?")[0].trim();
                      if (isEmail(email)) {
                                  out.apply_email = out.apply_email ?? email;
                      }
                      continue;
            }

            const looksApply =
                      text.includes("postuler") ||
                      text.includes("apply") ||
                      text.includes("candidature") ||
                      text.includes("candidate") ||
                      href.toLowerCase().includes("apply") ||
                      href.toLowerCase().includes("candidature");

            if (looksApply && !out.apply_url) {
                      try {
                                  const abs = baseUrl ? new URL(href, baseUrl).toString() : href;
                                  if (/^https?:\/\//i.test(abs)) out.apply_url = abs;
                      } catch {
                                  // ignore malformed
                      }
            }
          }

      if (!out.apply_email) {
              const text = doc.body?.textContent ?? "";
              const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
              if (match && isEmail(match[0])) out.apply_email = match[0];
      }
    } catch {
          // ignore
    }
    return out;
}

function extractApplyFromJson(payload: unknown) {
    const out: { apply_url?: string; apply_email?: string } = {};
    const seen = new Set<unknown>();

  const walk = (node: any, keyHint = "") => {
        if (node == null) return;
        if (seen.has(node)) return;
        if (typeof node === "object") seen.add(node);

        if (typeof node === "string") {
                const v = node.trim();
                if (!out.apply_email && isEmail(v)) out.apply_email = v;
                if (!out.apply_email && v.toLowerCase().startsWith("mailto:")) {
                          const email = v.replace(/^mailto:/i, "").split("?")[0].trim();
                          if (isEmail(email)) out.apply_email = email;
                }
                if (!out.apply_url && /^https?:\/\//i.test(v) && /apply|candidature|career|jobs/i.test(keyHint)) {
                          out.apply_url = v;
                }
                return;
        }

        if (Array.isArray(node)) {
                for (const it of node) {
                          walk(it, keyHint);
                          if (out.apply_url && out.apply_email) return;
                }
                return;
        }

        if (typeof node === "object") {
                for (const [k, v] of Object.entries(node)) {
                          walk(v, k.toLowerCase());
                          if (out.apply_url && out.apply_email) return;
                }
        }
  };

  walk(payload);
    return out;
}

 Deno.serve(async (req) => {
     const corsHeaders = {
           "access-control-allow-origin": "*",
           "access-control-allow-headers": "authorization, x-cron-secret, content-type",
           "access-control-allow-methods": "GET,POST,OPTIONS",
     };

              if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
     if (req.method === "GET") {
           return json(200, { ok: true, status: "job_auto_enrich_8020_alive" }, corsHeaders);
     }
     if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" }, corsHeaders);

              const expected = Deno.env.get("CRON_SECRET") ?? "";
     const provided = req.headers.get("x-cron-secret") ?? "";
     const auth = req.headers.get("authorization") ?? "";
     const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

              if (!expected) return json(500, { ok: false, error: "Missing CRON_SECRET env" }, corsHeaders);
     if (provided !== expected && bearer !== expected) return json(401, { ok: false, error: "Unauthorized" }, corsHeaders);

              let body: { limit?: number; dry_run?: boolean } = {};
     try {
           body = (await req.json()) as { limit?: number; dry_run?: boolean };
     } catch {
           // body optional
     }

              const url = new URL(req.url);
     const limitRaw = body.limit ?? Number(url.searchParams.get("limit") ?? 50);
     const limit = Math.max(1, Math.min(200, Number(limitRaw) || 50));
     const dryRun = Boolean(body.dry_run ?? (url.searchParams.get("dry_run") === "1"));

              const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
     const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
     if (!SUPABASE_URL) return json(500, { ok: false, error: "Missing SUPABASE_URL env" }, corsHeaders);
     if (!SERVICE_ROLE) return json(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY env" }, corsHeaders);

              const functionsBase = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1";
     const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

              const baseSelect =
                    "id, source_url, apply_url, external_id, description_text, description_html, job_json, quality_status, published_at, created_at, updated_at";
     const selectWithEmail = `${baseSelect}, apply_email`;

              const runSelect = async (withEmail: boolean) => {
                    const sel = withEmail ? selectWithEmail : baseSelect;
                    const fetchSize = Math.min(limit * 20, 1000);
                    return await supabase
                      .from("jobs")
                      .select(sel)
                      .eq("is_active", true)
                      .or("is_expired.eq.false,is_expired.is.null")
                      .order("published_at", { ascending: false, nullsFirst: false })
                      .order("created_at", { ascending: false, nullsFirst: false })
                      .limit(fetchSize);
              };

              let hasApplyEmailColumn = true;
     let { data: rows, error: selectErr } = await runSelect(true);
     if (selectErr && selectErr.message?.toLowerCase().includes("apply_email")) {
           hasApplyEmailColumn = false;
           const retry = await runSelect(false);
           rows = retry.data;
           selectErr = retry.error;
     }

              if (selectErr) return json(500, { ok: false, error: selectErr.message }, corsHeaders);

              const candidates = (rows ?? []) as JobRow[];
     const filtered = candidates
       .filter((j) => j.quality_status !== "quarantined")
       .filter((j) => !j.description_text || j.description_text.trim().length < MIN_DESC_LEN);

              const results: Array<Record<string, unknown>> = [];
     const seenExternal = new Set<string>();
     let processed = 0;
     let enriched = 0;
     let actionnableOk = 0;
     let quarantined = 0;
     let duplicatesSkipped = 0;

              for (const job of filtered) {
                    if (processed >= limit) break;

       const externalId = (job.external_id ?? "").trim();
                    if (externalId && seenExternal.has(externalId)) {
                            duplicatesSkipped += 1;
                            results.push({ id: job.id, status: "skipped_duplicate", reason: "external_id_batch" });
                            continue;
                    }
                    if (externalId) seenExternal.add(externalId);

       const canonical = canonicalizeUrl(job.apply_url || job.source_url);
                    let isDuplicate = false;

       if (externalId) {
               const { data: extDup } = await supabase
                 .from("jobs")
                 .select("id")
                 .eq("external_id", externalId)
                 .neq("id", job.id)
                 .limit(1);
               if ((extDup ?? []).length > 0) isDuplicate = true;
       }

       if (!isDuplicate && canonical) {
               const { data: dupSource } = await supabase
                 .from("jobs")
                 .select("id")
                 .ilike("source_url", `${canonical}%`)
                 .neq("id", job.id)
                 .limit(1);
               const { data: dupApply } = await supabase
                 .from("jobs")
                 .select("id")
                 .ilike("apply_url", `${canonical}%`)
                 .neq("id", job.id)
                 .limit(1);
               if ((dupSource ?? []).length > 0 || (dupApply ?? []).length > 0) isDuplicate = true;
       }

       if (isDuplicate) {
               duplicatesSkipped += 1;
               if (!dryRun) {
                         await supabase.from("jobs").update({ quality_status: "quarantined" }).eq("id", job.id);
               }
               results.push({ id: job.id, status: "skipped_duplicate" });
               continue;
       }

       processed += 1;
                    const patch: Record<string, unknown> = {};
                    let touched = false;

       const targetUrl = job.source_url || job.apply_url;
                    let derivedApplyEmail: string | undefined;
                    if (targetUrl) {
                            try {
                                      const controller = new AbortController();
                                      const timeout = setTimeout(() => controller.abort(), 12000);
                                      const res = await fetch(targetUrl, {
                                                  headers: {
                                                                "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
                                                                accept: "text/html,application/xhtml+xml",
                                                  },
                                                  redirect: "follow",
                                                  signal: controller.signal,
                                      });
                                      clearTimeout(timeout);

                              if (res.ok) {
                                          const html = await res.text();
                                          const extracted = extractMain(html);
                                          const nextText = safeTruncate(extracted.text || "", MAX_DESC_LEN);
                                          const nextHtml = safeTruncate(extracted.html || "", 50000);

                                        if (nextText && nextText.length > (job.description_text ?? "").length) {
                                                      patch.description_text = nextText;
                                                      touched = true;
                                        }
                                          if (nextHtml && !job.description_html) {
                                                        patch.description_html = nextHtml;
                                                        touched = true;
                                          }

                                        const applyFromHtml = extractApplyFromHtml(html, targetUrl);
                                          if (!job.apply_url && applyFromHtml.apply_url) {
                                                        patch.apply_url = applyFromHtml.apply_url;
                                                        touched = true;
                                          }
                                          if (applyFromHtml.apply_email) {
                                                        if (hasApplyEmailColumn && !job.apply_email) {
                                                                        patch.apply_email = applyFromHtml.apply_email;
                                                                        touched = true;
                                                        } else if (!hasApplyEmailColumn) {
                                                                        derivedApplyEmail = applyFromHtml.apply_email;
                                                        }
                                          }
                              }
                            } catch {
                                      // ignore fetch failures
                            }
                    }

       if (job.job_json && (!job.apply_url || (!hasApplyEmailColumn || !job.apply_email))) {
               const applyFromJson = extractApplyFromJson(job.job_json);
               if (!job.apply_url && applyFromJson.apply_url) {
                         patch.apply_url = applyFromJson.apply_url;
                         touched = true;
               }
               if (applyFromJson.apply_email) {
                         if (hasApplyEmailColumn && !job.apply_email) {
                                     patch.apply_email = applyFromJson.apply_email;
                                     touched = true;
                         } else if (!hasApplyEmailColumn) {
                                     derivedApplyEmail = derivedApplyEmail ?? applyFromJson.apply_email;
                         }
               }
       }

       const nextApplyUrl = (patch.apply_url as string | undefined) ?? job.apply_url;
                                 const nextApplyEmail = hasApplyEmailColumn
                      ? ((patch.apply_email as string | undefined) ?? job.apply_email)
                                         : derivedApplyEmail;
                    const actionable = Boolean(nextApplyUrl || nextApplyEmail);

       if (!actionable) {
               patch.quality_status = "quarantined";
       } else {
               patch.quality_status = "ok";
       }

       if (!dryRun && (touched || patch.quality_status)) {
               await supabase.from("jobs").update(patch).eq("id", job.id);
       }

       if (!dryRun) {
               const hasDesc = (patch.description_text as string | undefined) ?? job.description_text ?? "";
               if (hasDesc && hasDesc.length >= MIN_DESC_LEN) {
                         try {
                                     await fetch(`${functionsBase}/job_enrich`, {
                                                   method: "POST",
                                                   headers: {
                                                                   "Content-Type": "application/json",
                                                                   Authorization: `Bearer ${SERVICE_ROLE}`,
                                                   },
                                                   body: JSON.stringify({ job_id: job.id, persist: true }),
                                     });
                         } catch {
                                     // ignore
                         }
               }
       }

       if (actionable) actionnableOk += 1;
                    else quarantined += 1;
                    if (touched) enriched += 1;

       results.push({
               id: job.id,
               status: touched ? "enriched" : "unchanged",
               actionable,
               quality_status: patch.quality_status ?? job.quality_status ?? "ok",
       });
              }

              return json(
                    200,
                {
                        ok: true,
                        dry_run: dryRun,
                        processed,
                        enriched,
                        actionnable_ok: actionnableOk,
                        quarantined,
                        duplicates_skipped: duplicatesSkipped,
                        results,
                },
                    corsHeaders,
                  );
 });
