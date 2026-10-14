// End-to-end checks for the `admin-users` Edge Function against a running
// Supabase stack. Exercises the real function, the real Auth admin API and the
// real RLS/trigger rules — nothing is mocked.
//
// Usage (local stack, keys from `supabase status`):
//   LOCAL_URL=http://127.0.0.1:54321 \
//   LOCAL_PUBLISHABLE=sb_publishable_... \
//   LOCAL_SECRET=sb_secret_... \
//   node supabase/tests/edge_admin_users.mjs
//
// Requires @supabase/supabase-js, so run it from the project root.
// It creates and then deletes its own fixtures.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.LOCAL_URL ?? 'http://127.0.0.1:54321'
const PUBLISHABLE = process.env.LOCAL_PUBLISHABLE
const SECRET = process.env.LOCAL_SECRET

if (!PUBLISHABLE || !SECRET) {
  console.error(
    'Set LOCAL_PUBLISHABLE and LOCAL_SECRET (see `supabase status`).',
  )
  process.exit(1)
}

const admin = createClient(URL, SECRET, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`)
  if (!ok) failures++
}

async function callFn(token, body) {
  const res = await fetch(`${URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: PUBLISHABLE,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  let payload = null
  try {
    payload = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, payload }
}

// --- fixture: an admin account ---------------------------------------------
const stamp = Date.now().toString(36)
const adminUsername = `admin${stamp}`
const adminEmail = `${adminUsername}@khuruj.local`

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: adminEmail,
  password: 'AdminPass123',
  email_confirm: true,
  user_metadata: { full_name: 'Fixture Admin', username: adminUsername },
})
if (createErr) {
  console.error('could not create admin fixture:', createErr.message)
  process.exit(1)
}
const adminId = created.user.id

await admin.from('user_roles').insert({ user_id: adminId, role: 'admin' })

// --- admin signs in for a real JWT -----------------------------------------
const adminClient = createClient(URL, PUBLISHABLE, {
  auth: { persistSession: false },
})
const { data: signIn, error: signInErr } =
  await adminClient.auth.signInWithPassword({
    email: adminEmail,
    password: 'AdminPass123',
  })
if (signInErr) {
  console.error('admin sign-in failed:', signInErr.message)
  process.exit(1)
}
const adminToken = signIn.session.access_token
check('admin can sign in with username-derived email', Boolean(adminToken))

// --- create a teacher -------------------------------------------------------
const teacherUsername = `teacher${stamp}`
const createRes = await callFn(adminToken, {
  action: 'create_staff',
  username: teacherUsername,
  full_name: 'Test Teacher',
  role: 'class_teacher',
  password: 'TeacherPass123',
})
check(
  'admin creates a teacher account',
  createRes.status === 200 && createRes.payload?.user_id,
  JSON.stringify(createRes.payload),
)
const teacherId = createRes.payload?.user_id

// --- the new teacher can sign in -------------------------------------------
const teacherClient = createClient(URL, PUBLISHABLE, {
  auth: { persistSession: false },
})
const { data: tSignIn, error: tSignInErr } =
  await teacherClient.auth.signInWithPassword({
    email: `${teacherUsername}@khuruj.local`,
    password: 'TeacherPass123',
  })
check('teacher can sign in with the issued password', !tSignInErr, tSignInErr?.message)

// --- forced password change is flagged --------------------------------------
const { data: profile } = await admin
  .from('profiles')
  .select('username, must_change_password')
  .eq('id', teacherId)
  .single()
check(
  'new account is flagged must_change_password',
  profile?.must_change_password === true && profile?.username === teacherUsername,
  JSON.stringify(profile),
)

const { data: roles } = await admin
  .from('user_roles')
  .select('role')
  .eq('user_id', teacherId)
check(
  'teacher holds exactly the class_teacher role',
  roles?.length === 1 && roles[0].role === 'class_teacher',
  JSON.stringify(roles),
)

// --- duplicate username rejected -------------------------------------------
const dupRes = await callFn(adminToken, {
  action: 'create_staff',
  username: teacherUsername,
  full_name: 'Clone',
  role: 'mentor',
  password: 'TeacherPass123',
})
check(
  'duplicate username rejected with USERNAME_TAKEN',
  dupRes.status === 409 && dupRes.payload?.error === 'USERNAME_TAKEN',
  JSON.stringify(dupRes.payload),
)

// --- weak password rejected -------------------------------------------------
const weakRes = await callFn(adminToken, {
  action: 'create_staff',
  username: `weak${stamp}`,
  full_name: 'Weak',
  role: 'mentor',
  password: 'short',
})
check(
  'weak password rejected with WEAK_PASSWORD',
  weakRes.status === 400 && weakRes.payload?.error === 'WEAK_PASSWORD',
  JSON.stringify(weakRes.payload),
)

// --- invalid role rejected (cannot mint an arbitrary role) ------------------
const roleRes = await callFn(adminToken, {
  action: 'create_staff',
  username: `role${stamp}`,
  full_name: 'Role Test',
  role: 'superuser',
  password: 'TeacherPass123',
})
check(
  'unknown role rejected with INVALID_ROLE',
  roleRes.status === 400 && roleRes.payload?.error === 'INVALID_ROLE',
  JSON.stringify(roleRes.payload),
)

// --- a NON-admin cannot create accounts ------------------------------------
const teacherToken = tSignIn?.session?.access_token
const forbiddenRes = await callFn(teacherToken, {
  action: 'create_staff',
  username: `nope${stamp}`,
  full_name: 'Not Allowed',
  role: 'admin',
  password: 'TeacherPass123',
})
check(
  'non-admin is refused with FORBIDDEN',
  forbiddenRes.status === 403 && forbiddenRes.payload?.error === 'FORBIDDEN',
  `${forbiddenRes.status} ${JSON.stringify(forbiddenRes.payload)}`,
)

// --- an unauthenticated caller is refused ----------------------------------
const anonRes = await fetch(`${URL}/functions/v1/admin-users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE },
  body: JSON.stringify({ action: 'create_staff' }),
})
check('unauthenticated request rejected', anonRes.status === 401, `${anonRes.status}`)

// --- teacher CANNOT change their own username ------------------------------
const { error: renameErr } = await teacherClient
  .from('profiles')
  .update({ username: 'hijacked' })
  .eq('id', teacherId)
check(
  'teacher cannot change their own username (RLS/trigger)',
  Boolean(renameErr),
  renameErr?.message,
)

// --- teacher CAN change their own password ---------------------------------
const { error: pwErr } = await teacherClient.auth.updateUser({
  password: 'MyOwnPass456',
})
check('teacher can change their own password', !pwErr, pwErr?.message)

// --- complete_password_change clears the flag ------------------------------
const { error: flagErr } = await teacherClient.rpc('complete_password_change')
check('complete_password_change succeeds for the owner', !flagErr, flagErr?.message)

const { data: after } = await admin
  .from('profiles')
  .select('must_change_password')
  .eq('id', teacherId)
  .single()
check('flag cleared after the owner changes password', after?.must_change_password === false)

// --- the teacher can actually approve (teachers DO hold permission) --------
// Students never sign in, so the student is a record and the request is
// inserted directly with the secret key. `class_teacher` is the default
// approver for `going_home`.
const admission = `E2E${stamp.toUpperCase()}`
const now = Date.now()

const { data: student, error: studentErr } = await admin
  .from('students')
  .insert({ admission_number: admission, full_name: 'E2E Student' })
  .select()
  .single()
check(
  'a student record was created for the check',
  !studentErr && Boolean(student?.id),
  studentErr?.message,
)

function requestRow(purpose) {
  return {
    admission_number: admission,
    request_type: 'going_home',
    purpose,
    requested_departure: new Date(now + 3600_000).toISOString(),
    requested_return: new Date(now + 7200_000).toISOString(),
    valid_from: new Date(now + 3600_000).toISOString(),
    valid_until: new Date(now + 7200_000).toISOString(),
  }
}

const { data: req, error: reqErr } = await admin
  .from('pass_requests')
  .insert(requestRow('End-to-end approval check'))
  .select()
  .single()
check(
  'a pending request was created for the check',
  !reqErr && Boolean(req?.id),
  reqErr?.message,
)

const { error: approveErr } = await teacherClient.rpc('approve_pass_request', {
  p_request_id: req.id,
  p_remarks: 'Approved by e2e',
})
check('a class teacher can approve a going_home request', !approveErr, approveErr?.message)

const { data: approved } = await admin
  .from('pass_requests')
  .select('approval_status, approver_id')
  .eq('id', req.id)
  .single()
check(
  'the request is recorded as approved by that teacher',
  approved?.approval_status === 'approved' && approved?.approver_id === teacherId,
  JSON.stringify(approved),
)

// --- deactivation revokes that permission ----------------------------------
const deactivateRes = await callFn(adminToken, {
  action: 'set_active',
  user_id: teacherId,
  is_active: false,
})
check(
  'admin can deactivate an account',
  deactivateRes.status === 200 && deactivateRes.payload?.is_active === false,
  JSON.stringify(deactivateRes.payload),
)

// A second request must now be unapprovable by the deactivated teacher:
// `app.current_roles()` joins on `profiles.is_active`, so it yields no roles.
const { data: req2 } = await admin
  .from('pass_requests')
  .insert(requestRow('Deactivated approver check'))
  .select()
  .single()

const { error: blockedErr } = await teacherClient.rpc('approve_pass_request', {
  p_request_id: req2.id,
})
check(
  'a deactivated teacher can no longer approve',
  Boolean(blockedErr),
  blockedErr?.message,
)

// --- the last administrator cannot be deactivated --------------------------
const lastAdminRes = await callFn(adminToken, {
  action: 'set_active',
  user_id: adminId,
  is_active: false,
})
check(
  'the only active administrator cannot be deactivated',
  lastAdminRes.status === 409 && lastAdminRes.payload?.error === 'LAST_ADMIN',
  `${lastAdminRes.status} ${JSON.stringify(lastAdminRes.payload)}`,
)

await callFn(adminToken, {
  action: 'set_active',
  user_id: teacherId,
  is_active: true,
})

// --- cleanup ----------------------------------------------------------------
await admin.from('pass_requests').delete().in('id', [req.id, req2.id])
await admin.from('students').delete().eq('id', student.id)
await admin.auth.admin.deleteUser(teacherId)
await admin.auth.admin.deleteUser(adminId)

console.log(`\n${failures === 0 ? 'ALL EDGE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
