import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  ok: false,
  error: "HERO Move database bootstrap is permanently disabled. Use versioned Supabase migrations.",
}), {
  status: 410,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
}));
