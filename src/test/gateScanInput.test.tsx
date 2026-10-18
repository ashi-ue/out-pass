import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatePortal } from '../pages/gate/GatePortal'
import type { GateLookupResult } from '../lib/types'

// Only the network boundary is stubbed; the page and the api layer run for real.
const rpc = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: true,
  supabaseConfigError: null,
}))

function onCampusLookup(admission = '2023CS1042'): GateLookupResult {
  return {
    student: {
      id: 's1',
      admission_number: admission,
      full_name: 'Muhammed Ashik',
      department: 'CSE',
      class_name: '3rd Year',
    },
    campus_status: 'on_campus',
    outside_since: null,
    pass: {
      id: 'p1',
      request_type: 'going_home',
      purpose: 'Family visit',
      approval_status: 'approved',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2030-01-01T00:00:00Z',
    },
    pass_is_valid: true,
  } as unknown as GateLookupResult
}

/** Answers each RPC with the shape that function really returns. */
function stubRpc(lookup: GateLookupResult = onCampusLookup()) {
  rpc.mockImplementation((fn: string) => {
    if (fn === 'gate_lookup') return Promise.resolve({ data: lookup, error: null })
    if (fn === 'record_gate_out' || fn === 'record_gate_in') {
      return Promise.resolve({
        data: {
          admission_number: lookup.student.admission_number,
          occurred_at: '2026-01-01T10:00:00Z',
          event_type: fn === 'record_gate_out' ? 'gate_out' : 'gate_in',
        },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  })
}

function renderPortal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GatePortal />
    </QueryClientProvider>,
  )
}

describe('GatePortal scan input', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('has no camera elements and no camera controls', () => {
    stubRpc()
    const { container } = renderPortal()

    // The hardware scanner decodes the barcode itself, so the page must not
    // request a camera or render a video preview.
    expect(container.querySelector('video')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /camera/i }),
    ).not.toBeInTheDocument()
  })

  it('looks a student up from the scan field on Enter', async () => {
    stubRpc()
    renderPortal()

    const input = screen.getByLabelText('Scan or enter admission number')
    fireEvent.change(input, { target: { value: '2023CS1042' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('gate_lookup', {
        p_admission_number: '2023CS1042',
      }),
    )
    expect(await screen.findByText('Muhammed Ashik')).toBeInTheDocument()
  })

  it('clears the field after a scan so the next scan starts fresh', async () => {
    stubRpc()
    renderPortal()

    const input = screen.getByLabelText(
      'Scan or enter admission number',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2023CS1042' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    // A keyboard-wedge scanner types into whatever is focused; a leftover value
    // would prepend to the next scan's digits.
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('does not look up an empty scan', async () => {
    renderPortal()
    const input = screen.getByLabelText('Scan or enter admission number')
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    // Give any stray async call a chance to land before asserting.
    await new Promise((r) => setTimeout(r, 20))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('records Gate-Out explicitly, never automatically on lookup', async () => {
    stubRpc()
    renderPortal()

    const input = screen.getByLabelText('Scan or enter admission number')
    fireEvent.change(input, { target: { value: '2023CS1042' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await screen.findByText('Muhammed Ashik')

    // Looking a student up must not record a movement: only gate_lookup ran.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalledWith('record_gate_out', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Gate-Out' }))
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('record_gate_out', {
        p_request_id: 'p1',
        p_note: '',
      }),
    )
  })
})
