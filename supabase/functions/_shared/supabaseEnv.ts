// Supabase environment resolution for Khuruj Edge Functions.
//
// `@supabase/server` looks for the newer key names (`SUPABASE_PUBLISHABLE_KEY`,
// `SUPABASE_SECRET_KEY`). The local Supabase CLI stack instead injects the
// legacy names (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), and the
// hosted runtime provides the inline `SUPABASE_JWKS` JSON. Resolving both here
// keeps one function body working in every environment.
//
// Only the secret is sensitive. It is read from the environment, passed straight
// to the library, and never logged or returned.

import type { SupabaseEnv } from 'npm:@supabase/server@1'

export function resolveSupabaseEnv(): Partial<SupabaseEnv> {
  const env: Record<string, unknown> = {}

  const url = Deno.env.get('SUPABASE_URL')
  if (url) env.url = url

  const publishable =
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')
  if (publishable) env.publishableKeys = { default: publishable }

  const secret =
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (secret) env.secretKeys = { default: secret }

  // Inline JWKS wins: it avoids a network round-trip per cold start.
  const inlineJwks = Deno.env.get('SUPABASE_JWKS')
  const jwksUrl = Deno.env.get('SUPABASE_JWKS_URL')
  if (inlineJwks) {
    try {
      env.jwks = JSON.parse(inlineJwks)
    } catch {
      // A malformed value resolves to "no JWKS" rather than a hard failure, so
      // fall back to the URL form below.
      if (jwksUrl) env.jwks = new URL(jwksUrl)
    }
  } else if (jwksUrl) {
    env.jwks = new URL(jwksUrl)
  }

  return env as Partial<SupabaseEnv>
}
