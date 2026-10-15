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

  it('never returns an empty message', () => {
    expect(friendlyError(null)).toBeTruthy()
    expect(friendlyError(undefined)).toBeTruthy()
    expect(friendlyError('')).toBeTruthy()
  })
})
