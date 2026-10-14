import { describe, expect, it } from 'vitest'
import {
  approvableTypes,
  canDecide,
  isAdmin,
  isApprover,
  isGateSecurity,
  isStaff,
  landingPath,
} from '../auth/roles'
import type { AppRole, RequestType } from '../lib/types'

describe('role helpers', () => {
  it('identifies admin and staff', () => {
    expect(isAdmin(['admin'])).toBe(true)
    expect(isAdmin(['student'])).toBe(false)
    expect(isStaff(['mentor'])).toBe(true)
    expect(isStaff(['student'])).toBe(false)
    expect(isGateSecurity(['gate_security'])).toBe(true)
    expect(isGateSecurity(['admin'])).toBe(true)
    expect(isGateSecurity(['student'])).toBe(false)
  })

  it('only lets the owning approver role decide a request type', () => {
    const cases: Array<[AppRole, RequestType, boolean]> = [
      ['class_teacher', 'going_home', true],
      ['class_teacher', 'afternoon_out', false],
      ['mentor', 'afternoon_out', true],
      ['mentor', 'medical', false],
      ['medical_approver', 'medical', true],
      ['duty_teacher', 'thursday_friday', true],
      ['duty_teacher', 'going_home', false],
      ['student', 'going_home', false],
      ['gate_security', 'going_home', false],
    ]
    for (const [role, type, expected] of cases) {
      expect(canDecide([role], type)).toBe(expected)
    }
  })

  it('lets an admin decide anything', () => {
    for (const type of [
      'going_home',
      'afternoon_out',
      'medical',
      'thursday_friday',
    ] as RequestType[]) {
      expect(canDecide(['admin'], type)).toBe(true)
    }
  })

  it('honours admin-configured routing overrides', () => {
    // A rule change should move the approval scope with it.
    expect(canDecide(['mentor'], 'going_home', { going_home: 'mentor' })).toBe(
      true,
    )
    expect(
      canDecide(['class_teacher'], 'going_home', { going_home: 'mentor' }),
    ).toBe(false)
  })

  it('fails closed when the live rule set has no entry for a type', () => {
    // The server (app.can_decide) refuses in this case, so the UI must not
    // offer the action either. A populated rule set with a missing type is
    // different from no rule set at all.
    const rules = { afternoon_out: 'mentor' as const }
    expect(canDecide(['class_teacher'], 'going_home', rules)).toBe(false)
    expect(canDecide(['mentor'], 'going_home', rules)).toBe(false)
    expect(canDecide(['mentor'], 'afternoon_out', rules)).toBe(true)
    // Admin bypass is unaffected.
    expect(canDecide(['admin'], 'going_home', rules)).toBe(true)
  })

  it('lists only the request types a user can approve', () => {
    expect(approvableTypes(['mentor'])).toEqual(['afternoon_out'])
    expect(approvableTypes(['admin']).sort()).toEqual(
      ['afternoon_out', 'going_home', 'medical', 'thursday_friday'].sort(),
    )
    expect(approvableTypes(['student'])).toEqual([])
  })

  it('routes each role to the right landing page', () => {
    expect(landingPath(['admin'])).toBe('/admin')
    expect(landingPath(['gate_security'])).toBe('/gate')
    expect(landingPath(['mentor'])).toBe('/approver')
    expect(landingPath(['class_teacher'])).toBe('/approver')
    expect(landingPath(['student'])).toBe('/student')
    expect(landingPath([])).toBe('/student')
  })

  it('treats a user with both approver and gate roles correctly', () => {
    expect(isApprover(['gate_security'])).toBe(false)
    expect(isApprover(['mentor'])).toBe(true)
    expect(landingPath(['gate_security', 'mentor'])).toBe('/gate')
  })
})
