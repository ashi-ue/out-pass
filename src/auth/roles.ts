import type { AppRole, RequestType } from '../lib/types'

/**
 * Front-end mirror of the server's approval routing.
 *
 * These helpers only decide what to SHOW. The database re-checks the caller's
 * role inside every RPC, so hiding a button is a convenience, not a security
 * control — a forged request is rejected by the backend regardless.
 */

/**
 * Which role owns each request type. Only a fallback for when the live
 * `approval_rules` have not loaded; the database is the source of truth.
 */
export const DEFAULT_APPROVER_BY_TYPE: Record<RequestType, AppRole> = {
  going_home: 'class_teacher',
  afternoon_out: 'mentor',
  medical: 'medical_approver',
  thursday_friday: 'duty_teacher',
}

export function isAdmin(roles: AppRole[]): boolean {
  return roles.includes('admin')
}

export function isStaff(roles: AppRole[]): boolean {
  return roles.some((r) => r !== 'student')
}

export function isApprover(roles: AppRole[]): boolean {
  return roles.some((r) =>
    (
      [
        'admin',
        'mentor',
        'class_teacher',
        'medical_approver',
        'duty_teacher',
      ] as AppRole[]
    ).includes(r),
  )
}

export function isGateSecurity(roles: AppRole[]): boolean {
  return roles.includes('gate_security') || roles.includes('admin')
}

export function canDecide(
  roles: AppRole[],
  requestType: RequestType,
  rules: Partial<Record<RequestType, AppRole>> = {},
): boolean {
  if (isAdmin(roles)) return true
  // `rules` is the live rule set. When it is supplied but has no active entry
  // for this type, the server refuses (app.can_decide fails closed), so the UI
  // must not offer the action either. Only an entirely absent rule set falls
  // back to the compiled defaults.
  const hasRuleSet = Object.keys(rules).length > 0
  const required = hasRuleSet
    ? rules[requestType]
    : DEFAULT_APPROVER_BY_TYPE[requestType]
  if (!required) return false
  return roles.includes(required)
}

/** Request types this user can approve — used to build the approver inbox. */
export function approvableTypes(
  roles: AppRole[],
  rules: Partial<Record<RequestType, AppRole>> = {},
): RequestType[] {
  return (Object.keys(DEFAULT_APPROVER_BY_TYPE) as RequestType[]).filter((t) =>
    canDecide(roles, t, rules),
  )
}

/** Where to send a user after login, based on their highest-privilege role. */
export function landingPath(roles: AppRole[]): string {
  if (isAdmin(roles)) return '/admin'
  if (isGateSecurity(roles)) return '/gate'
  if (isApprover(roles)) return '/approver'
  return '/student'
}
