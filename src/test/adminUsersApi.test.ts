import { describe, expect, it, vi, beforeEach } from 'vitest'

// The Edge Function is the network boundary; it is stubbed so the real
// `callAdminUsers` error-parsing logic in the api layer can be exercised.
const invoke = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
  isSupabaseConfigured: true,
  supabaseConfigError: null,
}))

const { adminCreateStaff, adminSetActive, adminSetRoles } = await import(
  '../lib/api'
)

function httpError(status: number, body: unknown) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
  // Mirrors supabase-js's FunctionsHttpError shape.
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: response,
  })
}

describe('admin-users Edge Function client', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('returns the created account on success', async () => {
    invoke.mockResolvedValue({
      data: {
        user_id: 'u1',
        username: 'ayesha',
        roles: ['mentor', 'class_teacher', 'duty_teacher'],
      },
      error: null,
    })

    await expect(
      adminCreateStaff({
        username: 'ayesha',
        fullName: 'Ayesha Rahman',
        roles: ['mentor', 'class_teacher', 'duty_teacher'],
        password: 'secret123',
      }),
    ).resolves.toMatchObject({ user_id: 'u1', username: 'ayesha' })

    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'create_staff',
        username: 'ayesha',
        full_name: 'Ayesha Rahman',
        roles: ['mentor', 'class_teacher', 'duty_teacher'],
        password: 'secret123',
      },
    })
  })

  it('surfaces the server error CODE, not the generic HTTP message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'USERNAME_TAKEN' }),
    })

    // The code matters: `friendlyError` maps it to a human message, while the
    // generic "non-2xx" string maps to nothing useful.
    await expect(
      adminCreateStaff({
        username: 'taken',
        fullName: 'X',
        roles: ['mentor'],
        password: 'secret123',
      }),
    ).rejects.toThrow('USERNAME_TAKEN')
  })

  it('sends set_roles with the full role list', async () => {
    invoke.mockResolvedValue({
      data: { user_id: 'u1', roles: ['mentor', 'class_teacher'] },
      error: null,
    })

    await expect(
      adminSetRoles('u1', ['mentor', 'class_teacher']),
    ).resolves.toMatchObject({ roles: ['mentor', 'class_teacher'] })

    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'set_roles',
        user_id: 'u1',
        roles: ['mentor', 'class_teacher'],
      },
    })
  })

  it('surfaces a rejection from a non-admin caller', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: 'FORBIDDEN' }),
    })

    await expect(adminSetActive('u1', false)).rejects.toThrow('FORBIDDEN')
  })

  it('falls back to the original error when the body is not JSON', async () => {
    const error = Object.assign(new Error('network down'), {
      context: new Response('<html>gateway</html>', { status: 502 }),
    })
    invoke.mockResolvedValue({ data: null, error })

    await expect(adminSetActive('u1', true)).rejects.toThrow('network down')
  })

  it('rethrows when there is no response body at all', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('fetch failed') })
    await expect(adminSetActive('u1', true)).rejects.toThrow('fetch failed')
  })
})
