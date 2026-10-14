import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState } from '../auth/context'
import { PassDetailPage } from '../pages/PassDetailPage'
import type { PassRequest } from '../lib/types'

// Mock the network boundary only. The page, the query cache and the api layer
// all run for real, so the test exercises the actual post-decision flow.
const rpc = vi.fn()
const passRow: { current: PassRequest | null } = { current: null }
// When true, reads of pass_requests never resolve. That models the window
// between a decision and the follow-up refetch landing, and proves the badge
// updates from the RPC result rather than from a lucky refetch.
let hangPassReads = false

/** A chainable PostgREST stub: every builder method returns itself and awaiting
 * it yields the configured result. */
function query(table: string, result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    builder[method] = () => builder
  }
  const settle = () =>
    hangPassReads && table === 'pass_requests'
      ? new Promise<never>(() => {})
      : Promise.resolve(result)
  builder.maybeSingle = settle
  builder.single = settle
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => settle().then(onFulfilled, onRejected)
  return builder
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) =>
      query(
        table,
        table === 'pass_requests'
          ? { data: passRow.current, error: null }
          : { data: [], error: null },
      ),
  },
  isSupabaseConfigured: true,
  supabaseConfigError: null,
}))

const ID = 'pass-1'

function pendingRow(): PassRequest {
  return {
    id: ID,
    admission_number: '2023CS1042',
    student_user_id: 'student-1',
    request_type: 'going_home',
    purpose: 'Weekend leave',
    destination: null,
    reason: null,
    requested_departure: '2026-10-24T09:00:00+00:00',
    requested_return: '2026-10-24T17:00:00+00:00',
    valid_from: '2026-10-24T09:00:00+00:00',
    valid_until: '2026-10-24T17:00:00+00:00',
    approval_status: 'pending',
    approver_id: null,
    approver_role: null,
    decided_at: null,
    remarks: null,
    last_gate_out_at: null,
    last_gate_in_at: null,
    created_at: '2026-10-14T09:00:00+00:00',
    updated_at: '2026-10-14T09:00:00+00:00',
  }
}

function approvedRow(): PassRequest {
  return {
    ...pendingRow(),
    approval_status: 'approved',
    approver_id: 'teacher-1',
    approver_role: 'class_teacher',
    decided_at: '2026-10-14T09:05:00+00:00',
  }
}

function authState(): AuthState {
  return {
    ready: true,
    identityReady: true,
    session: { user: { id: 'teacher-1' } } as unknown as Session,
    profile: null,
    roles: ['class_teacher'],
    student: null,
    needsStudentLink: false,
    refresh: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  })
  return render(
    <AuthContext.Provider value={authState()}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/passes/${ID}`]}>
          <Routes>
            <Route path="/passes/:id" element={<PassDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
}

describe('PassDetailPage decision flow', () => {
  beforeEach(() => {
    rpc.mockReset()
    passRow.current = pendingRow()
    hangPassReads = false
  })

  it('flips the badge to Approved from the RPC result', async () => {
    renderPage()
    expect(await screen.findByText('Pending')).toBeInTheDocument()

    // Freeze reads so the badge can only come from the mutation result, then
    // approve and assert the UI updates without a completed refetch.
    hangPassReads = true
    rpc.mockResolvedValueOnce({ data: approvedRow(), error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(screen.getByText('Approved')).toBeInTheDocument()
    })
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
    expect(screen.getByText('Class teacher')).toBeInTheDocument()
  })

  it('keeps the pending badge and shows the error when approval fails', async () => {
    renderPage()
    expect(await screen.findByText('Pending')).toBeInTheDocument()

    rpc.mockResolvedValueOnce({ data: null, error: new Error('FORBIDDEN') })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(
        screen.getByText(/not authorized to perform this action/i),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })
})
