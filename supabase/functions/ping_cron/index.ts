// supabase/functions/ping_cron/index.ts

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
          status,
          headers: {
                  "content-type": "application/json; charset=utf-8",
                  "cache-control": "no-store",
                  ...extraHeaders,
          },
    });
}

function getEnv(name: string): string | null {
    try {
          return Deno.env.get(name) ?? null;
    } catch {
          return null;
    }
}

Deno.serve(async (req: Request) => {
    const expected = getEnv("CRON_SECRET");
    const got = req.headers.get("x-cron-secret") ?? "";

             if (!expected) {
                   return json({ ok: false, error: "CRON_SECRET_NOT_SET" }, 500);
             }

             if (got !== expected) {
                   return json({ ok: false, error: "unauthorized" }, 401);
             }

             return json({ ok: true, ts: new Date().toISOString() }, 200);
});
