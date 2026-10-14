import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthState } from '../auth/context'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { LoginPage } from '../pages/LoginPage'
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
    refresh: async () => {},
    signIn: async () => {},
    signOut: async () => {},
    ...overrides,
  }
}

function renderAt(path: string, auth: AuthState) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>Admin dashboard</div>} />
          <Route path="/student" element={<div>Student portal</div>} />
          <Route
            path="/gate"
            element={
              <ProtectedRoute roles={['gate_security'] as AppRole[]}>
                <div>Gate portal</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('login redirect timing', () => {
  it('waits for roles before redirecting, so an admin is not sent to /student', () => {
    // Session is known but roles are still loading: the form must stay put
    // rather than redirect against an empty role list.
    renderAt('/login', state({ identityReady: false, session, roles: [] }))
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByText('Student portal')).not.toBeInTheDocument()
  })

  it('sends an admin to /admin once roles have loaded', () => {
    renderAt('/login', state({ session, roles: ['admin'] }))
    expect(screen.getByText('Admin dashboard')).toBeInTheDocument()
  })

  it('sends a student to /student once roles have loaded', () => {
    renderAt('/login', state({ session, roles: ['student'] }))
    expect(screen.getByText('Student portal')).toBeInTheDocument()
  })
})

describe('ProtectedRoute', () => {
  it('shows a spinner instead of redirecting while roles load', () => {
    renderAt('/gate', state({ identityReady: false, session, roles: [] }))
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument()
    expect(screen.queryByText('Gate portal')).not.toBeInTheDocument()
  })

  it('redirects an unauthorised role away from a guarded route', () => {
    renderAt('/gate', state({ session, roles: ['student'] }))
    expect(screen.queryByText('Gate portal')).not.toBeInTheDocument()
    expect(screen.getByText('Student portal')).toBeInTheDocument()
  })

  it('redirects to login when there is no session', () => {
    renderAt('/gate', state({ session: null, roles: [] }))
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })
})
