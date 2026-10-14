// Khuruj Edge Function: report-summary
// ---------------------------------------------------------------------------
// A privileged, server-side reporting endpoint. It demonstrates the supported
// pattern for using the SECRET key safely:
//
//   1. The caller's JWT is verified with a publishable-key client.
//   2. The caller's role is re-read from the database (never from the request).
//   3. Only then does a secret-key client read the aggregate figures.
//
// The secret key is read from the runtime environment and never leaves the
// server. It is never logged and never returned to the client.
//
// Deploy:  supabase functions deploy report-summary
// Secrets: supabase secrets set SUPABASE_SECRET_KEY=sb_secret_... \
//                                KHURUJ_ALLOWED_ORIGIN=https://your.site
// ---------------------------------------------------------------------------

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, origin)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'AUTH_REQUIRED' }, 401, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // Publishable / anon key is auto-provided to Edge Functions.
  const publishableKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  // Secret key must be set explicitly as a function secret.
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY')

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json({ error: 'SERVER_NOT_CONFIGURED' }, 500, origin)
  }

  // 1. Identify the caller from their JWT.
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    return json({ error: 'AUTH_REQUIRED' }, 401, origin)
  }

  // 2. Authorize from the database, not from the request body.
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  })
  const { data: roles, error: roleError } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)

  if (roleError) {
    return json({ error: 'ROLE_LOOKUP_FAILED' }, 500, origin)
  }
  const isAdmin = (roles ?? []).some((r) => r.role === 'admin')
  if (!isAdmin) {
    return json({ error: 'FORBIDDEN' }, 403, origin)
  }

  // 3. Aggregate figures. These reads bypass RLS — which is exactly why the
  //    admin check above must happen first.
  const nowIso = new Date().toISOString()
  const [outsideRes, pendingRes, approvedRes, overdueRes] = await Promise.all([
    admin
      .from('student_campus_status')
      .select('admission_number', { count: 'exact', head: true })
      .eq('status', 'outside'),
    admin
      .from('pass_requests')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending'),
    admin
      .from('pass_requests')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'approved')
      .gt('valid_until', nowIso),
    admin
      .from('pass_requests')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'approved')
      .lt('valid_until', nowIso),
  ])

  return json(
    {
      generated_at: nowIso,
      students_outside: outsideRes.count ?? 0,
      pending_approvals: pendingRes.count ?? 0,
      active_passes: approvedRes.count ?? 0,
      overdue_passes: overdueRes.count ?? 0,
    },
    200,
    origin,
  )
})
