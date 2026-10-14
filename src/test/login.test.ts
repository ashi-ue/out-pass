import { describe, expect, it } from 'vitest'
import {
  LOGIN_DOMAIN,
  isValidUsername,
  loginEmail,
  normaliseUsername,
} from '../lib/login'

describe('username login mapping', () => {
  it('maps a username to a reserved-domain address', () => {
    expect(loginEmail('ayesha.rahman')).toBe('ayesha.rahman@khuruj.local')
    expect(LOGIN_DOMAIN).toBe('khuruj.local')
  })

  it('normalises case and surrounding whitespace', () => {
    expect(normaliseUsername('  Ayesha.Rahman  ')).toBe('ayesha.rahman')
    expect(loginEmail('  AYESHA.RAHMAN ')).toBe('ayesha.rahman@khuruj.local')
  })

  it('accepts the documented username shape', () => {
    for (const ok of [
      'abc',
      'teacher.01',
      'gate_security',
      'a-b-c',
      'x'.repeat(32),
    ]) {
      expect(isValidUsername(ok), ok).toBe(true)
    }
  })

  it('rejects names that would break the login address', () => {
    for (const bad of [
      '',
      'ab', // shorter than 3
      'x'.repeat(33), // longer than 32
      'has space',
      'has@at',
      '_leading',
      '-leading',
      'ünïcode',
      'UPPER@CASE',
    ]) {
      expect(isValidUsername(bad), bad).toBe(false)
    }
  })

  it('normalises uppercase before validating, so case is not a rejection', () => {
    expect(isValidUsername('Ayesha')).toBe(true)
    expect(loginEmail('Ayesha')).toBe('ayesha@khuruj.local')
  })

  it('never produces an address that could receive mail', () => {
    // `.local` is reserved by RFC 2606, so nothing is deliverable.
    expect(loginEmail('anyone')).toMatch(/@khuruj\.local$/)
  })
})
