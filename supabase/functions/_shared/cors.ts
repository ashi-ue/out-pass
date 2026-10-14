// Shared CORS helpers for Khuruj Edge Functions.
// Locked to the configured site origin rather than "*".

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('KHURUJ_ALLOWED_ORIGIN') ?? '').trim()
  const allowOrigin = allowed && origin === allowed ? origin : allowed || '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}
