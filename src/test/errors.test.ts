import { describe, expect, it } from 'vitest'
import { friendlyError } from '../lib/errors'

describe('friendlyError', () => {
  it('translates known backend codes into readable messages', () => {
    expect(friendlyError(new Error('PASS_EXPIRED'))).toMatch(/expired/i)
    expect(friendlyError(new Error('ALREADY_OUTSIDE'))).toMatch(
      /already outside/i,
    )
    expect(friendlyError(new Error('FORBIDDEN'))).toMatch(/not authorized/i)
  })

  it('recognises codes embedded in a Postgres error string', () => {
    const raw =
      'P0001: PASS_NOT_APPROVED: This pass has not been approved, so the student cannot leave.'
    expect(friendlyError(new Error(raw))).toMatch(/not been approved/i)
  })

  it('handles Supabase-style error objects', () => {
    expect(friendlyError({ message: 'SELF_APPROVAL_FORBIDDEN' })).toMatch(
      /cannot approve or reject your own/i,
    )
  })

  it('rewrites common auth failures', () => {
    expect(friendlyError(new Error('Invalid login credentials'))).toBe(
      'Incorrect username or password.',
    )
  })

  it('explains a stale schema instead of echoing PostgREST', () => {
    const raw =
      "Could not find the function public.admin_upsert_student(p_admission_number, p_class_name, p_department, p_full_name) in the schema cache"
    const msg = friendlyError(new Error(raw))
    expect(msg).toMatch(/migration/i)
    expect(msg).not.toMatch(/schema cache/i)
  })

  it('explains an undeployed Edge Function instead of echoing the platform', () => {
    const msg = friendlyError(
      new Error('Failed to send a request to the Edge Function'),
    )
    expect(msg).toMatch(/deploy/i)
    expect(msg).not.toMatch(/Failed to send a request/i)
  })

  it('never returns an empty message', () => {
    expect(friendlyError(null)).toBeTruthy()
    expect(friendlyError(undefined)).toBeTruthy()
    expect(friendlyError('')).toBeTruthy()
  })
})
