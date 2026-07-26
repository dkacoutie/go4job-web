import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildAppliedJobIdSet,
  buildDismissedJobIdSet,
  buildMatchingProfile,
  classifyMatchingProfile,
  generateCandidates,
  loadUserMatchingContext,
  persistMatchingProfile,
  scoreJob,
  selectSurfaceBuckets,
} from "../_shared/jobradar_match_core.ts";

type MatchFeedBody = {
  user_id?: string | null;
  include_debug?: boolean | null;
};

type AuthResolution =
  | { ok: true; userId: string; mode: "user_jwt" | "cron_secret" }
  | { ok: false; status: number; error: string };

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://jobradar.go4jobapp.com",
]);

function getCorsHeaders(origin: string | null) {
  const value = origin && allowedOrigins.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readBody(req: Request): Promise<MatchFeedBody> {
  if (req.method.toUpperCase() !== "POST") return {};
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return {};

  try {
    const parsed = (await req.json()) as MatchFeedBody | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function resolveCaller(params: {
  req: Request;
  body: MatchFeedBody;
  supabaseUrl: string;
  anonKey: string;
  cronSecret: string;
}): Promise<AuthResolution> {
  const authHeader = clean(params.req.headers.get("Authorization"));
  const cronHeader = clean(params.req.headers.get("x-cron-secret"));
  const requestedUserId =
    clean(params.body.user_id) ||
    clean(new URL(params.req.url).searchParams.get("user_id"));

  const isCron =
    Boolean(params.cronSecret) &&
    Boolean(cronHeader) &&
    cronHeader === params.cronSecret;

  if (isCron) {
    if (!requestedUserId) {
      return { ok: false, status: 400, error: "Missing user_id for cron shadow call" };
    }

    return {
      ok: true,
      userId: requestedUserId,
      mode: "cron_secret",
    };
  }

  if (!authHeader) {
    return { ok: false, status: 401, error: "Missing Authorization header" };
  }

  const userClient = createClient(params.supabaseUrl, params.anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.id) {
    return { ok: false, status: 401, error: error?.message ?? "Unauthorized" };
  }

  return {
    ok: true,
    userId: data.user.id,
    mode: "user_jwt",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!["GET", "POST"].includes(req.method.toUpperCase())) {
    return jsonResponse(405, { ok: false, error: "Method not allowed" }, corsHeaders);
  }

  // Instrumentation temporaire (diagnostic uniquement) : declaree en dehors
  // du try pour rester lisible meme si une etape leve une exception.
  // A retirer une fois la cause des echecs par timeout confirmee et corrigee.
  const stageTimingsMs: Record<string, number> = {};
  const stageStart = () => performance.now();
  const stageEnd = (name: string, t0: number) => {
    stageTimingsMs[name] = Math.round(performance.now() - t0);
  };

  try {
    const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
    const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const serviceRoleKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const cronSecret = clean(Deno.env.get("CRON_SECRET"));

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(
        500,
        { ok: false, error: "Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY" },
        corsHeaders,
      );
    }

    const body = await readBody(req);
    const caller = await resolveCaller({
      req,
      body,
      supabaseUrl,
      anonKey,
      cronSecret,
    });

    if (!caller.ok) {
      return jsonResponse(caller.status, { ok: false, error: caller.error }, corsHeaders);
    }

    const includeDebug =
      body.include_debug === true ||
      clean(new URL(req.url).searchParams.get("include_debug")) === "1";

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let t = stageStart();
    const context = await loadUserMatchingContext(admin, caller.userId);
    stageEnd("loadUserMatchingContext", t);

    t = stageStart();
    const builtProfile = await buildMatchingProfile({
      userId: caller.userId,
      profile: context.profile,
      alerts: context.alerts,
      cv: context.cv,
      previousProfile: context.previous_matching_profile,
    });
    stageEnd("buildMatchingProfile", t);

    t = stageStart();
    const persistedProfile = await persistMatchingProfile(admin, builtProfile);
    stageEnd("persistMatchingProfile", t);

    const profileStrategy = classifyMatchingProfile(persistedProfile);

    t = stageStart();
    const candidateResult = await generateCandidates({
      supabase: admin,
      profile: persistedProfile,
    });
    stageEnd("generateCandidates", t);

    t = stageStart();
    const scoredJobs = candidateResult.candidates.map((candidate) =>
      scoreJob({
        profile: persistedProfile,
        candidate,
      })
    );
    stageEnd("scoreJob_all", t);

    console.log("[jobradar_match_feed] stage_timings_ms", JSON.stringify(stageTimingsMs));

    const appliedJobIds = buildAppliedJobIdSet(context.applications);
    const dismissedJobIds = buildDismissedJobIdSet(context.feedback);
    const buckets = selectSurfaceBuckets({
      profile: persistedProfile,
      scoredJobs,
      appliedJobIds,
      dismissedJobIds,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        mode: "shadow",
        auth_mode: caller.mode,
        user_id: caller.userId,
        profile: persistedProfile,
        profile_mode: profileStrategy.profile_mode,
        primary_surface_strategy: profileStrategy.primary_surface_strategy,
        fallback_reason: profileStrategy.fallback_reason,
        top_match: buckets.top_match,
        for_you: buckets.for_you,
        explore: buckets.explore,
        debug: includeDebug
          ? {
              profile_mode: profileStrategy.profile_mode,
              primary_surface_strategy: profileStrategy.primary_surface_strategy,
              candidate_pool_count: candidateResult.debug.pooled_count,
              candidate_path_counts: candidateResult.debug.path_counts,
              candidate_budgets: candidateResult.debug.budgets,
              fallback_applied: candidateResult.debug.fallback_applied,
              scored_count: scoredJobs.length,
              applied_excluded_count: appliedJobIds.size,
              dismissed_excluded_count: dismissedJobIds.size,
              top_match_count: buckets.top_match.length,
              for_you_count: buckets.for_you.length,
              explore_count: buckets.explore.length,
              stage_timings_ms: stageTimingsMs,
            }
          : undefined,
      },
      corsHeaders,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
    console.error("[jobradar_match_feed] failed", message, "stage_timings_ms", JSON.stringify(stageTimingsMs), error);
    return jsonResponse(
      500,
      {
        ok: false,
        error: message,
        stage_timings_ms: stageTimingsMs,
      },
      corsHeaders,
    );
  }
});
