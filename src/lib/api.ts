import { supabase } from './supabase'
import type {
  ApprovalRule,
  AppRole,
  AuditEntry,
  CampusStatusRow,
  GateEvent,
  GateEventResult,
  GateLookupResult,
  PassRequest,
  PassWithStudent,
  Profile,
  RequestType,
  Student,
} from './types'

/** Unwrap a PostgREST result, throwing on error so callers can catch. */
function unwrap<T>(data: T | null, error: unknown): T {
  if (error) throw error
  return data as T
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listStudents(search?: string): Promise<Student[]> {
  let query = supabase
    .from('students')
    .select('*')
    .order('admission_number', { ascending: true })
    .limit(500)

  const term = search?.trim()
  if (term) {
    query = query.or(
      `admission_number.ilike.%${term}%,full_name.ilike.%${term}%`,
    )
  }

  const { data, error } = await query
  return unwrap<Student[]>(data, error)
}

export async function getStudentByAdmission(
  admissionNumber: string,
): Promise<Student | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('admission_number', admissionNumber.trim())
    .maybeSingle()
  return unwrap<Student | null>(data, error)
}

async function studentNameMap(
  admissionNumbers: string[],
): Promise<Map<string, Student>> {
  const unique = [...new Set(admissionNumbers.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .in('admission_number', unique)
  const rows = unwrap<Student[]>(data, error)
  return new Map(rows.map((s) => [s.admission_number, s]))
}

export interface PassFilters {
  status?: PassRequest['approval_status']
  requestType?: RequestType
  admissionNumber?: string
}

export async function listPassRequests(
  filters: PassFilters = {},
): Promise<PassWithStudent[]> {
  let query = supabase
    .from('pass_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)

  if (filters.status) query = query.eq('approval_status', filters.status)
  if (filters.requestType) query = query.eq('request_type', filters.requestType)
  if (filters.admissionNumber)
    query = query.eq('admission_number', filters.admissionNumber.trim())

  const { data, error } = await query
  const rows = unwrap<PassRequest[]>(data, error)
  const names = await studentNameMap(rows.map((r) => r.admission_number))
  return rows.map((r) => ({
    ...r,
    student: names.get(r.admission_number)
      ? {
          full_name: names.get(r.admission_number)!.full_name,
          department: names.get(r.admission_number)!.department,
          program: names.get(r.admission_number)!.program,
        }
      : null,
  }))
}

export async function getPassRequest(id: string): Promise<PassWithStudent | null> {
  const { data, error } = await supabase
    .from('pass_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  const row = unwrap<PassRequest | null>(data, error)
  if (!row) return null
  const names = await studentNameMap([row.admission_number])
  const student = names.get(row.admission_number)
  return {
    ...row,
    student: student
      ? {
          full_name: student.full_name,
          department: student.department,
          program: student.program,
        }
      : null,
  }
}

export async function listGateEvents(admissionNumber: string): Promise<GateEvent[]> {
  const { data, error } = await supabase
    .from('gate_events')
    .select('*')
    .eq('admission_number', admissionNumber.trim())
    .order('occurred_at', { ascending: false })
    .limit(100)
  return unwrap<GateEvent[]>(data, error)
}

export interface OutsideStudent extends CampusStatusRow {
  student?: Pick<Student, 'full_name' | 'department' | 'program'> | null
  pass?: PassRequest | null
}

export async function listStudentsOutside(): Promise<OutsideStudent[]> {
  const { data, error } = await supabase
    .from('student_campus_status')
    .select('*')
    .eq('status', 'outside')
    .order('since', { ascending: false })
  const rows = unwrap<CampusStatusRow[]>(data, error)
  if (rows.length === 0) return []

  const names = await studentNameMap(rows.map((r) => r.admission_number))
  const passIds = rows
    .map((r) => r.active_pass_id)
    .filter((id): id is string => Boolean(id))

  const passMap = new Map<string, PassRequest>()
  if (passIds.length > 0) {
    const { data: passData, error: passError } = await supabase
      .from('pass_requests')
      .select('*')
      .in('id', passIds)
    for (const p of unwrap<PassRequest[]>(passData, passError)) {
      passMap.set(p.id, p)
    }
  }

  return rows.map((r) => {
    const s = names.get(r.admission_number)
    return {
      ...r,
      student: s
        ? {
            full_name: s.full_name,
            department: s.department,
            program: s.program,
          }
        : null,
      pass: r.active_pass_id ? (passMap.get(r.active_pass_id) ?? null) : null,
    }
  })
}

export async function listAuditLog(limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  return unwrap<AuditEntry[]>(data, error)
}

export async function listApprovalRules(): Promise<ApprovalRule[]> {
  const { data, error } = await supabase
    .from('approval_rules')
    .select('*')
    .order('request_type')
  return unwrap<ApprovalRule[]>(data, error)
}

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  return unwrap<Profile[]>(data, error)
}

export interface UserRoleRow {
  id: string
  user_id: string
  role: AppRole
  granted_at: string
}

export async function listUserRoles(): Promise<UserRoleRow[]> {
  const { data, error } = await supabase.from('user_roles').select('*')
  return unwrap<UserRoleRow[]>(data, error)
}

// ---------------------------------------------------------------------------
// RPC wrappers — every privileged transition is validated server-side
// ---------------------------------------------------------------------------

export interface SubmitPassInput {
  requestType: RequestType
  purpose: string
  requestedDeparture: string
  requestedReturn: string
  destination?: string | null
  reason?: string | null
  validFrom?: string | null
  validUntil?: string | null
}

export async function submitPassRequest(
  input: SubmitPassInput,
): Promise<PassRequest> {
  const { data, error } = await supabase.rpc('submit_pass_request', {
    p_request_type: input.requestType,
    p_purpose: input.purpose,
    p_requested_departure: input.requestedDeparture,
    p_requested_return: input.requestedReturn,
    p_destination: input.destination ?? null,
    p_reason: input.reason ?? null,
    p_valid_from: input.validFrom ?? null,
    p_valid_until: input.validUntil ?? null,
  })
  return unwrap<PassRequest>(data, error)
}

export async function approvePassRequest(
  requestId: string,
  remarks?: string,
): Promise<PassRequest> {
  const { data, error } = await supabase.rpc('approve_pass_request', {
    p_request_id: requestId,
    p_remarks: remarks ?? null,
  })
  return unwrap<PassRequest>(data, error)
}

export async function rejectPassRequest(
  requestId: string,
  remarks: string,
): Promise<PassRequest> {
  const { data, error } = await supabase.rpc('reject_pass_request', {
    p_request_id: requestId,
    p_remarks: remarks,
  })
  return unwrap<PassRequest>(data, error)
}

export async function cancelPassRequest(requestId: string): Promise<PassRequest> {
  const { data, error } = await supabase.rpc('cancel_pass_request', {
    p_request_id: requestId,
  })
  return unwrap<PassRequest>(data, error)
}

export async function gateLookup(
  admissionNumber: string,
): Promise<GateLookupResult> {
  const { data, error } = await supabase.rpc('gate_lookup', {
    p_admission_number: admissionNumber,
  })
  return unwrap<GateLookupResult>(data, error)
}

export async function recordGateOut(
  requestId: string,
  note?: string,
): Promise<GateEventResult> {
  const { data, error } = await supabase.rpc('record_gate_out', {
    p_request_id: requestId,
    p_note: note ?? null,
  })
  return unwrap<GateEventResult>(data, error)
}

export async function recordGateIn(
  admissionNumber: string,
  note?: string,
): Promise<GateEventResult> {
  const { data, error } = await supabase.rpc('record_gate_in', {
    p_admission_number: admissionNumber,
    p_note: note ?? null,
  })
  return unwrap<GateEventResult>(data, error)
}

export async function adminSetUserRole(
  userId: string,
  role: AppRole,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_role', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw error
}

export async function adminRevokeUserRole(
  userId: string,
  role: AppRole,
): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_user_role', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw error
}

export interface UpsertStudentInput {
  admissionNumber: string
  fullName: string
  department?: string | null
  program?: string | null
  academicYear?: number | null
  email?: string | null
  phone?: string | null
}

export async function adminUpsertStudent(
  input: UpsertStudentInput,
): Promise<Student> {
  const { data, error } = await supabase.rpc('admin_upsert_student', {
    p_admission_number: input.admissionNumber,
    p_full_name: input.fullName,
    p_department: input.department ?? null,
    p_program: input.program ?? null,
    p_academic_year: input.academicYear ?? null,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
  })
  return unwrap<Student>(data, error)
}

export async function adminLinkStudentAccount(
  admissionNumber: string,
  userId: string,
): Promise<Student> {
  const { data, error } = await supabase.rpc('admin_link_student_account', {
    p_admission_number: admissionNumber,
    p_user_id: userId,
  })
  return unwrap<Student>(data, error)
}

export async function adminSetApprovalRule(
  requestType: RequestType,
  approverRole: AppRole,
  isActive = true,
): Promise<ApprovalRule> {
  const { data, error } = await supabase.rpc('admin_set_approval_rule', {
    p_request_type: requestType,
    p_approver_role: approverRole,
    p_is_active: isActive,
  })
  return unwrap<ApprovalRule>(data, error)
}

// ---------------------------------------------------------------------------
// Admin: staff accounts
// ---------------------------------------------------------------------------
// Creating an account with a password needs the secret key, so these go through
// the `admin-users` Edge Function, which re-checks the caller's role server-side
// before touching Auth.

export interface StaffAccountRow {
  id: string
  username: string | null
  full_name: string | null
  is_active: boolean
  must_change_password: boolean
  roles: AppRole[]
}

interface EdgeError {
  error?: string
}

/**
 * Calls `admin-users` and throws the server's error CODE as an Error, so the
 * existing `friendlyError` mapping applies. `functions.invoke` only surfaces a
 * generic message on a non-2xx response, so the body is read explicitly.
 */
async function callAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body,
  })

  if (error) {
    // FunctionsHttpError carries the raw Response in `context`. A gateway or
    // proxy may answer with HTML, so only a well-formed `{ error: CODE }` body
    // is used; anything else falls through to the original error.
    const response = (error as { context?: Response }).context
    if (response && typeof response.clone === 'function') {
      const payload = (await response
        .clone()
        .json()
        .catch(() => null)) as EdgeError | null
      if (typeof payload?.error === 'string') throw new Error(payload.error)
    }
    throw error
  }

  return data as T
}

export function adminCreateStaff(input: {
  username: string
  fullName: string
  role: AppRole
  password: string
}): Promise<{ user_id: string; username: string; role: AppRole }> {
  return callAdminUsers({
    action: 'create_staff',
    username: input.username,
    full_name: input.fullName,
    role: input.role,
    password: input.password,
  })
}

export function adminResetPassword(
  userId: string,
  password: string,
): Promise<{ user_id: string }> {
  return callAdminUsers({ action: 'reset_password', user_id: userId, password })
}

export function adminSetUsername(
  userId: string,
  username: string,
): Promise<{ user_id: string; username: string }> {
  return callAdminUsers({ action: 'set_username', user_id: userId, username })
}

export function adminSetActive(
  userId: string,
  isActive: boolean,
): Promise<{ user_id: string; is_active: boolean }> {
  return callAdminUsers({
    action: 'set_active',
    user_id: userId,
    is_active: isActive,
  })
}
