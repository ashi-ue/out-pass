// Khuruj Edge Function: report-summary
// ---------------------------------------------------------------------------
// A privileged, server-side reporting endpoint. It uses `@supabase/server`
// (`withSupabase`), which validates the caller's JWT, builds an RLS-scoped
// client and an admin client, and handles CORS — the handler only runs once
// auth succeeds.
//
//   1. `auth: 'user'` rejects the request before the handler runs unless a
//      valid JWT is present.
//   2. The caller's role is re-read from the database via the RLS-scoped
//      client — never from the request body or from JWT claims.
//   3. Only then does the admin client read the aggregate figures.
//
// The secret key is read from the runtime environment and never leaves the
// server. It is never logged and never returned to the client.
//
// Deploy:  supabase functions deploy report-summary
// Secrets: supabase secrets set SUPABASE_SECRET_KEY=sb_secret_... \
//                                KHURUJ_ALLOWED_ORIGIN=https://your.site
// ---------------------------------------------------------------------------

import { withSupabase } from 'npm:@supabase/server@1'

const ALLOWED_ORIGIN = Deno.env.get('KHURUJ_ALLOWED_ORIGIN')

export default {
  fetch: withSupabase(
    {
      auth: 'user',
      cors: ALLOWED_ORIGIN
        ? {
            headers: {
              'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
              'Access-Control-Allow-Headers':
                'authorization, x-client-info, apikey, content-type',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              Vary: 'Origin',
            },
          }
        : 'default',
    },
    async (req, ctx) => {
      if (req.method !== 'POST') {
        return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 })
      }

      // Authorize from the database, not from the request. The RLS-scoped
      // client returns only rows this user is allowed to see, and the
      // `user_roles_select_self_or_admin` policy permits reading one's own
      // roles — so a non-admin simply sees no `admin` row.
      const { data: roles, error: roleError } = await ctx.supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', ctx.userClaims?.id)

      if (roleError) {
        return Response.json({ error: 'ROLE_LOOKUP_FAILED' }, { status: 500 })
      }
      if (!(roles ?? []).some((r) => r.role === 'admin')) {
        return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
      }

      // Aggregate figures. These reads bypass RLS — which is exactly why the
      // admin check above must happen first.
      const admin = ctx.supabaseAdmin
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

      return Response.json({
        generated_at: nowIso,
        students_outside: outsideRes.count ?? 0,
        pending_approvals: pendingRes.count ?? 0,
        active_passes: approvedRes.count ?? 0,
        overdue_passes: overdueRes.count ?? 0,
      })
    },
  ),
}
