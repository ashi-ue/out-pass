import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState } from '../auth/context'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { ChangePasswordPage } from '../pages/ChangePasswordPage'
import type { AppRole } from '../lib/types'

const session = { user: { id: 'user-1' } } as unknown as Session

function state(overrides: Partial<AuthState>): AuthState {
  return {
    ready: true,
    identityReady: true,
    session: null,
    profile: null,
    roles: [],
    student: null,
    needsStudentLink: false,
    mustChangePassword: false,
    isDeactivated: false,
    refresh: async () => {},
    signIn: async () => {},
    changePassword: async () => {},
    signOut: async () => {},
    ...overrides,
  }
}

function renderChangePassword(auth: AuthState) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route path="/admin" element={<div>Admin dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function submitNewPassword() {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'BrandNew#1' },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'BrandNew#1' },
  })
  fireEvent.click(screen.getByRole('button', { name: /save password/i }))
}

describe('ChangePasswordPage', () => {
  it('stays put until the password is actually saved', () => {
    // A user with a temporary password lands here and must not be redirected
    // before they have chosen a new one.
    renderChangePassword(
      state({
        session,
        roles: ['admin'] as AppRole[],
        mustChangePassword: true,
        profile: { full_name: 'Meera Krishnan' } as never,
      }),
    )
    expect(
      screen.getByRole('heading', { name: /choose a new password/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
  })

  it('redirects to the landing page after a successful change', async () => {
    const changePassword = vi.fn(async () => {})
    renderChangePassword(
      state({
        session,
        roles: ['admin'] as AppRole[],
        mustChangePassword: true,
        changePassword,
      }),
    )

    await submitNewPassword()

    await waitFor(() =>
      expect(screen.getByText('Admin dashboard')).toBeInTheDocument(),
    )
    expect(changePassword).toHaveBeenCalledWith('BrandNew#1')
  })

  it('shows the error and does not redirect when the change fails', async () => {
    const changePassword = vi.fn(async () => {
      throw new Error('WEAK_PASSWORD')
    })
    renderChangePassword(
      state({
        session,
        roles: ['admin'] as AppRole[],
        mustChangePassword: true,
        changePassword,
      }),
    )

    await submitNewPassword()

    await waitFor(() =>
      expect(
        screen.getByText(/at least 8 characters, including a letter and a digit/i),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument()
  })
})
