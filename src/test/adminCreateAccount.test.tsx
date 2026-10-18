import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminUsers } from '../pages/admin/AdminUsers'

// The Edge Function is the only network boundary; everything else (the page,
// the query cache, the api layer) runs for real so the test proves the roles
// that actually reach the wire.
const invoke = vi.fn()
const from = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (...args: unknown[]) => from(...args),
  },
  isSupabaseConfigured: true,
  supabaseConfigError: null,
}))

/** Chainable PostgREST stub: every builder returns itself and awaiting it
 *  yields `result`. */
function query(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.single = () => Promise.resolve(result)
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminUsers />
    </QueryClientProvider>,
  )
}

/** The `roles` array sent to the admin-users function, whichever call made it. */
function sentRoles(): string[] | null {
  const call = invoke.mock.calls.find(
    ([name, opts]) =>
      name === 'admin-users' &&
      (opts as { body?: { action?: string } }).body?.action === 'create_staff',
  )
  if (!call) return null
  const body = (call[1] as { body: { roles: string[] } }).body
  return body.roles
}

async function fillAndSubmit(fullName: string, username: string) {
  fireEvent.change(screen.getByLabelText('Full name'), {
    target: { value: fullName },
  })
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: username },
  })
  fireEvent.change(screen.getByLabelText('Initial password'), {
    target: { value: 'secret123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => expect(invoke).toHaveBeenCalled())
}

describe('AdminUsers account creation', () => {
  beforeEach(() => {
    invoke.mockReset()
    from.mockReset()
    from.mockReturnValue(query({ data: [], error: null }))
    invoke.mockResolvedValue({
      data: { user_id: 'u1', username: 'someone', roles: [] },
      error: null,
    })
  })

  it('offers both an Add teacher and an Add security action', async () => {
    renderPage()
    expect(
      await screen.findByRole('button', { name: 'Add teacher' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add security' }),
    ).toBeInTheDocument()
  })

  it('Add security creates a gate-security-only account', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add security' }))

    // The dialog names the account being created, not a generic "teacher".
    expect(
      await screen.findByText('Add a gate security officer'),
    ).toBeInTheDocument()

    await fillAndSubmit('Gate Officer', 'gate.officer')

    expect(sentRoles()).toEqual(['gate_security'])
  })

  it('Add teacher still creates the three teaching roles', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add teacher' }))

    await fillAndSubmit('Ayesha Rahman', 'ayesha.rahman')

    expect(sentRoles()).toEqual(
      expect.arrayContaining(['mentor', 'class_teacher', 'duty_teacher']),
    )
    expect(sentRoles()).toHaveLength(3)
  })

  it('does not carry teacher roles into the security dialog', async () => {
    renderPage()
    // Open teacher first, close it, then open security: the security form must
    // not inherit the teacher preset.
    fireEvent.click(await screen.findByRole('button', { name: 'Add teacher' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add security' }))

    await fillAndSubmit('Gate Officer', 'gate.officer')

    expect(sentRoles()).toEqual(['gate_security'])
  })
})
