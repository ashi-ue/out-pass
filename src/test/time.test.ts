import { describe, expect, it } from 'vitest'
import {
  isExpired,
  isNotYetValid,
  isPassCurrentlyValid,
  relativeToNow,
  utcIsoToLocalInput,
} from '../lib/time'

describe('pass validity', () => {
  const now = new Date('2026-10-14T10:00:00.000Z')

  it('detects an expired pass but keeps it distinct from "not yet valid"', () => {
    const expired = '2026-10-14T09:00:00.000Z'
    const future = '2026-10-14T11:00:00.000Z'
    expect(isExpired(expired, now)).toBe(true)
    expect(isNotYetValid(expired, now)).toBe(false)
    expect(isExpired(future, now)).toBe(false)
    expect(isNotYetValid(future, now)).toBe(true)
  })

  it('treats the exact boundary as still valid', () => {
    // A pass is expired only strictly after valid_until.
    expect(isExpired(now.toISOString(), now)).toBe(false)
  })

  it('marks a pass valid only inside its window', () => {
    const from = '2026-10-14T09:30:00.000Z'
    const until = '2026-10-14T12:30:00.000Z'
    expect(isPassCurrentlyValid(from, until, now)).toBe(true)
    expect(isPassCurrentlyValid(from, '2026-10-14T09:45:00.000Z', now)).toBe(
      false,
    )
    expect(isPassCurrentlyValid('2026-10-14T10:30:00.000Z', until, now)).toBe(
      false,
    )
  })

  it('describes time relative to now in both directions', () => {
    expect(relativeToNow('2026-10-14T12:00:00.000Z', now)).toBe('in 2h 0m')
    expect(relativeToNow('2026-10-14T08:00:00.000Z', now)).toBe('2h 0m ago')
  })
})

describe('datetime-local conversion', () => {
  it('round-trips a UTC instant through the campus-local input format', () => {
    const iso = '2026-10-14T10:30:00.000Z'
    const local = utcIsoToLocalInput(iso)
    // Asia/Kolkata is UTC+5:30, so 10:30Z is 16:00 local.
    expect(local).toBe('2026-10-14T16:00')
  })

  it('returns an empty string for missing values', () => {
    expect(utcIsoToLocalInput(null)).toBe('')
    expect(utcIsoToLocalInput(undefined)).toBe('')
  })
})
