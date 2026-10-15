/**
 * Shared domain types for Khuruj.
 *
 * In a fully connected deployment these are generated from the live schema:
 *   npm run gen:types   (supabase gen types typescript --project-id <ref>)
 * They are maintained by hand here so the app type-checks and builds without
 * live database credentials.
 */

export const APP_ROLES = [
  'admin',
  'mentor',
  'class_teacher',
  'medical_approver',
  'duty_teacher',
  'gate_security',
  'student',
] as const

export type AppRole = (typeof APP_ROLES)[number]

export const REQUEST_TYPES = [
  'going_home',
  'afternoon_out',
  'medical',
  'thursday_friday',
] as const

export type RequestType = (typeof REQUEST_TYPES)[number]

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type CampusStatus = 'on_campus' | 'outside'
export type GateEventType = 'gate_out' | 'gate_in'

export interface Profile {
  id: string
  username: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
}

/** Staff logins. Students are records, not users, so they are absent here. */
export const STAFF_ROLES = [
  'admin',
  'mentor',
  'class_teacher',
  'medical_approver',
  'duty_teacher',
  'gate_security',
] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

/**
 * The three roles a teacher holds. A teacher is one person with one login, but
 * approving passes is split across three duties — afternoon outings (mentor),
 * going home (class teacher) and Thursday/Friday (duty teacher) — so an account
 * normally holds all three at once.
 */
export const TEACHER_ROLES = [
  'mentor',
  'class_teacher',
  'duty_teacher',
] as const

export type TeacherRole = (typeof TEACHER_ROLES)[number]

export interface Student {
  id: string
  admission_number: string
  full_name: string | null
  department: string | null
  program: string | null
  academic_year: number | null
  /** Human label, e.g. "3rd Year, CSE". Mirrored to academic_year. */
  class_name: string | null
  email: string | null
  phone: string | null
  user_id: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export interface PassRequest {
  id: string
  admission_number: string
  student_user_id: string | null
  request_type: RequestType
  purpose: string
  destination: string | null
  reason: string | null
  requested_departure: string
  requested_return: string
  valid_from: string
  valid_until: string
  approval_status: ApprovalStatus
  approver_id: string | null
  approver_role: AppRole | null
  decided_at: string | null
  remarks: string | null
  last_gate_out_at: string | null
  last_gate_in_at: string | null
  created_at: string
  updated_at: string
}

export interface CampusStatusRow {
  admission_number: string
  status: CampusStatus
  active_pass_id: string | null
  since: string
  updated_at: string
}

export interface GateEvent {
  id: string
  admission_number: string
  pass_request_id: string | null
  event_type: GateEventType
  gate_user_id: string
  occurred_at: string
  note: string | null
  is_open_exit: boolean
  created_at: string
}

export interface AuditEntry {
  id: number
  actor_id: string | null
  actor_role: AppRole | null
  action: string
  entity_type: string
  entity_id: string | null
  admission_number: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface ApprovalRule {
  request_type: RequestType
  approver_role: AppRole
  is_active: boolean
  updated_at: string
  updated_by: string | null
}

export interface GateLookupResult {
  student: Pick<
    Student,
    'id' | 'admission_number' | 'full_name' | 'department' | 'program'
  >
  campus_status: CampusStatus
  outside_since: string | null
  active_pass_id: string | null
  pass: PassRequest | null
  pass_is_valid: boolean
  pass_expired: boolean
}

export interface GateEventResult {
  event_id: string
  event_type: GateEventType
  admission_number: string
  pass_request_id: string | null
  occurred_at: string
}

/** A pass joined with the student's display name, for admin/approver tables. */
export interface PassWithStudent extends PassRequest {
  student?: Pick<Student, 'full_name' | 'department' | 'program'> | null
}

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  going_home: 'Going home',
  afternoon_out: 'Afternoon outing',
  medical: 'Medical trip',
  thursday_friday: 'Thursday / Friday permission',
}

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrator',
  mentor: 'Mentor',
  class_teacher: 'Class teacher',
  medical_approver: 'Medical approver',
  duty_teacher: 'Duty teacher',
  gate_security: 'Gate security',
  student: 'Student',
}
