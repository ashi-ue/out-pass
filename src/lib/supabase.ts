import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client.
 *
 * Only the PUBLISHABLE key is ever used here — it is safe to ship to the
 * browser and relies on Row Level Security for protection. The secret
 * (service_role) key must never reach this module; privileged operations run
 * through the database RPCs, which re-check the caller's roles server-side.
 */

const rawUrl = import.meta.env.VITE_SUPABASE_URL
// Accept the new publishable key name, with a legacy anon-key fallback.
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  (import.meta.env as Record<string, string | undefined>)
    .VITE_SUPABASE_ANON_KEY

/**
 * Sandboxed previews serve the app over HTTPS while the local stack speaks
 * plain HTTP, so a direct call to the stack is blocked as mixed content and
 * every request fails with "Failed to fetch". When a proxy path is configured
 * we call the dev server's own origin instead and let Vite forward the request
 * to the stack server-side (see `server.proxy` in vite.config.ts). Production
 * builds leave the variable unset and talk to Supabase directly.
 */
const proxyPath = import.meta.env.VITE_SUPABASE_PROXY_PATH
const url = proxyPath
  ? new URL(proxyPath, window.location.origin).toString()
  : rawUrl

export const isSupabaseConfigured = Boolean(
  (rawUrl || proxyPath) && publishableKey,
)

export const supabaseConfigError = isSupabaseConfigured
  ? null
  : 'Supabase is not configured. Set VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example), then restart the dev server.'

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost',
  publishableKey ?? 'missing-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
