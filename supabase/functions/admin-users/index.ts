// Khuruj Edge Function: admin-users
// ---------------------------------------------------------------------------
// The ONLY place staff accounts are created. Admin privileges are required and
// are re-read from the database, never from the request.
//
// Why this cannot be done from the browser: creating an auth user with a
// password requires the secret (service_role) key, which must never reach the
// client. The publishable key alone cannot call the Auth admin API.
//
// Actions (POST body `{ action, ... }`):
//   create_staff    { username, full_name, role, password }  -> new account
//   reset_password  { user_id, password }                    -> force change
//   set_username    { user_id, username }
//   set_active      { user_id, is_active }
//
// Deploy:  supabase functions deploy admin-users
// ---------------------------------------------------------------------------

import { withSupabase } from 'npm:@supabase/server@1'
import { resolveSupabaseEnv } from '../_shared/supabaseEnv.ts'

const ALLOWED_ORIGIN = Deno.env.get('KHURUJ_ALLOWED_ORIGIN')

// Usernames become `<username>@khuruj.local`. The suffix is a reserved TLD
// (RFC 2606), so these addresses can never receive mail or collide with a real
// mailbox.
const LOGIN_DOMAIN = 'khuruj.local'
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Roles an administrator may hand out. `student` is deliberately excluded:
 *  students are records, not logins. */
const ASSIGNABLE_ROLES = [
  'admin',
  'mentor',
  'class_teacher',
  'medical_approver',
  'duty_teacher',
  'gate_security',
] as const

type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

function json(body: unknown, status: number, origin: string | null): Response {
  const allowed = (ALLOWED_ORIGIN ?? '').trim()
  const allowOrigin = allowed && origin === allowed ? origin : allowed || '*'
  return Response.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  })
}

const fail = (code: string, status: number, origin: string | null) =>
  json({ error: code }, status, origin)

/** Supabase requires >= 6 characters. Enforced here so the client gets a clear
 *  code instead of a raw Auth error. */
function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'WEAK_PASSWORD'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'WEAK_PASSWORD'
  }
  return null
}

function normaliseUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim().toLowerCase()
  return USERNAME_RE.test(username) ? username : null
}

export default {
  fetch: withSupabase(
    {
      auth: 'user',
      env: resolveSupabaseEnv(),
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
      const origin = req.headers.get('origin')

      if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
      if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, origin)

      // Authorize from the database. The RLS-scoped client only returns rows
      // this caller may see, and `user_roles_select_self_or_admin` permits
      // reading one's own roles — so a non-admin sees no `admin` row.
      const { data: roles, error: roleError } = await ctx.supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', ctx.userClaims?.id)

      if (roleError) return fail('ROLE_LOOKUP_FAILED', 500, origin)
      if (!(roles ?? []).some((r) => r.role === 'admin')) {
        return fail('FORBIDDEN', 403, origin)
      }

      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return fail('INVALID_INPUT', 400, origin)
      }

      const admin = ctx.supabaseAdmin
      const action = body.action

      // -- create_staff ------------------------------------------------------
      if (action === 'create_staff') {
        const username = normaliseUsername(body.username)
        const fullName =
          typeof body.full_name === 'string' ? body.full_name.trim() : ''
        const role = body.role as AssignableRole
        const passwordIssue = passwordProblem(body.password)

        if (!username) return fail('INVALID_USERNAME', 400, origin)
        if (!fullName) return fail('INVALID_INPUT', 400, origin)
        if (!ASSIGNABLE_ROLES.includes(role)) {
          return fail('INVALID_ROLE', 400, origin)
        }
        if (passwordIssue) return fail(passwordIssue, 400, origin)

        // Pre-check for a friendly code. The unique index is still the real
        // guard against a concurrent create.
        const { data: existing } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', username)
          .maybeSingle()
        if (existing) return fail('USERNAME_TAKEN', 409, origin)

        const email = `${username}@${LOGIN_DOMAIN}`
        const { data: created, error: createError } = await admin.auth.admin
          .createUser({
            email,
            password: body.password as string,
            email_confirm: true,
            user_metadata: { full_name: fullName, username },
          })

        if (createError || !created?.user) {
          return fail('CREATE_FAILED', 409, origin)
        }

        const userId = created.user.id

        // The profile row is created by the auth trigger; fill in the fields it
        // cannot know and mark the password as temporary.
        const { error: profileError } = await admin
          .from('profiles')
          .update({
            username,
            full_name: fullName,
            must_change_password: true,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (profileError) {
          // Roll the auth user back so a half-created account cannot linger.
          await admin.auth.admin.deleteUser(userId)
          return fail('PROFILE_UPDATE_FAILED', 500, origin)
        }

        const { error: roleGrantError } = await admin
          .from('user_roles')
          .insert({
            user_id: userId,
            role,
            granted_by: ctx.userClaims?.id ?? null,
          })

        if (roleGrantError) {
          await admin.auth.admin.deleteUser(userId)
          return fail('ROLE_GRANT_FAILED', 500, origin)
        }

        return json({ user_id: userId, username, role }, 200, origin)
      }

      // The remaining actions operate on an existing account.
      const userId = typeof body.user_id === 'string' ? body.user_id : null
      if (!userId) return fail('INVALID_INPUT', 400, origin)

      const { data: target } = await admin
        .from('profiles')
        .select('id, username')
        .eq('id', userId)
        .maybeSingle()
      if (!target) return fail('USER_NOT_FOUND', 404, origin)

      // -- reset_password ----------------------------------------------------
      if (action === 'reset_password') {
        const passwordIssue = passwordProblem(body.password)
        if (passwordIssue) return fail(passwordIssue, 400, origin)

        const { error } = await admin.auth.admin.updateUserById(userId, {
          password: body.password as string,
        })
        if (error) return fail('PASSWORD_RESET_FAILED', 500, origin)

        await admin
          .from('profiles')
          .update({
            must_change_password: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        return json({ user_id: userId }, 200, origin)
      }

      // -- set_username ------------------------------------------------------
      if (action === 'set_username') {
        const username = normaliseUsername(body.username)
        if (!username) return fail('INVALID_USERNAME', 400, origin)

        const { data: clash } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', username)
          .neq('id', userId)
          .maybeSingle()
        if (clash) return fail('USERNAME_TAKEN', 409, origin)

        const { error: authError } = await admin.auth.admin.updateUserById(
          userId,
          { email: `${username}@${LOGIN_DOMAIN}`, email_confirm: true },
        )
        if (authError) return fail('USERNAME_UPDATE_FAILED', 409, origin)

        const { error: profileError } = await admin
          .from('profiles')
          .update({ username, updated_at: new Date().toISOString() })
          .eq('id', userId)
        if (profileError) return fail('USERNAME_UPDATE_FAILED', 500, origin)

        return json({ user_id: userId, username }, 200, origin)
      }

      // -- set_active --------------------------------------------------------
      if (action === 'set_active') {
        const isActive = body.is_active
        if (typeof isActive !== 'boolean') {
          return fail('INVALID_INPUT', 400, origin)
        }

        // Refuse to deactivate the last active administrator.
        if (!isActive) {
          const { data: targetRoles } = await admin
            .from('user_roles')
            .select('role')
            .eq('user_id', userId)
          const isAdmin = (targetRoles ?? []).some((r) => r.role === 'admin')

          if (isAdmin) {
            const { data: admins } = await admin
              .from('user_roles')
              .select('user_id, profiles!inner(is_active)')
              .eq('role', 'admin')
            const activeAdmins = (admins ?? []).filter(
              (r) =>
                (r as { profiles?: { is_active?: boolean } }).profiles
                  ?.is_active,
            )
            if (activeAdmins.length <= 1) {
              return fail('LAST_ADMIN', 409, origin)
            }
          }
        }

        const { error } = await admin
          .from('profiles')
          .update({
            is_active: isActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)
        if (error) return fail('UPDATE_FAILED', 500, origin)

        return json({ user_id: userId, is_active: isActive }, 200, origin)
      }

      return fail('UNKNOWN_ACTION', 400, origin)
    },
  ),
}
