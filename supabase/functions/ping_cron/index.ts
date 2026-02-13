// supabase/functions/ping_cron/index.ts

Deno.serve(async () => {
  try {
    const body = JSON.stringify({ ok: true, ts: new Date().toISOString() });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
});
