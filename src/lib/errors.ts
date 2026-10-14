/**
 * Maps backend error codes (raised as `RAISE EXCEPTION '<CODE>'`) to messages
 * that are useful to staff without leaking internals. Unknown errors fall back
 * to the raw message, which Postgres keeps short and non-sensitive.
 */

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Your session has expired. Please sign in again.',
  ACCOUNT_NOT_LINKED:
    'Your account is not linked to a student record yet. Contact the administrator.',
  FORBIDDEN: 'You are not authorized to perform this action.',
  NOT_FOUND: 'The requested record was not found.',
  INVALID_INPUT: 'Some required information is missing or invalid.',
  PURPOSE_REQUIRED: 'A purpose is required.',
  REASON_REQUIRED: 'A reason is required for a medical trip.',
  INVALID_WINDOW:
    'The return time must be after the departure time, and the validity window must be valid.',
  INVALID_DAY:
    'A Thursday/Friday permission must start on a Thursday or a Friday.',
  ALREADY_DECIDED: 'This request has already been decided.',
  SELF_APPROVAL_FORBIDDEN: 'You cannot approve or reject your own request.',
  REMARKS_REQUIRED: 'Please add remarks explaining the rejection.',
  PASS_NOT_APPROVED:
    'This pass has not been approved, so the student cannot leave.',
  PASS_NOT_YET_VALID: 'This pass is not valid yet.',
  PASS_EXPIRED:
    'This pass has expired and cannot authorize a departure. Gate-In is still available.',
  ALREADY_OUTSIDE: 'This student is already outside. Record a Gate-In first.',
  NOT_OUTSIDE:
    'This student is not currently outside, so there is no exit to close.',
  STUDENT_NOT_FOUND: 'No student matches that admission number / barcode.',
  ADMISSION_REQUIRED: 'An admission number (barcode value) is required.',
  USER_NOT_FOUND: 'No user account matches that record.',
  LAST_ADMIN: 'You cannot remove the last administrator.',
  ADMIN_ALREADY_EXISTS: 'An administrator already exists.',
  INVALID_APPROVER_ROLE: 'That role cannot be an approver.',
  USERNAME_TAKEN: 'That username is already taken.',
  INVALID_USERNAME:
    'Usernames are 3–32 characters: lowercase letters, digits, dot, dash or underscore.',
  USERNAME_IMMUTABLE: 'Only an administrator can change a username.',
  INVALID_ROLE: 'That role cannot be assigned.',
  WEAK_PASSWORD:
    'Use at least 8 characters, including a letter and a digit.',
  CREATE_FAILED: 'That account could not be created. It may already exist.',
  PASSWORD_RESET_FAILED: 'The password could not be reset. Please try again.',
  USERNAME_UPDATE_FAILED: 'The username could not be updated.',
  PROFILE_UPDATE_FAILED: 'The account profile could not be saved.',
  ROLE_GRANT_FAILED: 'The account was created but its role could not be set.',
  ROLE_LOOKUP_FAILED: 'Your permissions could not be verified. Please try again.',
  ACCOUNT_DISABLED: 'This account has been deactivated. Contact an administrator.',
  UNKNOWN_ACTION: 'That action is not supported.',
  UNKNOWN: 'Something went wrong. Please try again.',
}

function extractCode(message: string): string {
  const match = /\b([A-Z][A-Z0-9_]{2,})\b/.exec(message)
  return match?.[1] ?? ''
}

export function friendlyError(error: unknown): string {
  if (!error) return ERROR_MESSAGES.UNKNOWN as string

  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : ''

  if (!message) return ERROR_MESSAGES.UNKNOWN as string

  const code = extractCode(message)
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code] as string

  // Surface auth-ish errors verbatim; they are already user-facing.
  if (/invalid login credentials/i.test(message)) {
    return 'Incorrect username or password.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'Please confirm your email address before signing in.'
  }

  return message
}
