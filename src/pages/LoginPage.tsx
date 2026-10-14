import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { landingPath } from '../auth/roles'
import { friendlyError } from '../lib/errors'
import { isSupabaseConfigured, supabaseConfigError } from '../lib/supabase'
import { Alert } from '../components/ui'
import { Logo } from '../components/Logo'

export function LoginPage() {
  const { identityReady, session, roles, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (identityReady && session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? landingPath(roles)} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(username, password)
      navigate('/')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-navy-800 p-10 lg:flex">
        <Logo variant="light" size={56} />
        <div>
          <h1 className="text-4xl font-bold text-white">
            Campus out-pass, without the paperwork.
          </h1>
          <p className="mt-4 max-w-md text-navy-100">
            Khuruj manages student out-pass requests, approvals and gate movement
            alongside the Shuhood attendance system. Approvals, exits and returns
            are tracked separately and audited end to end.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-teal-200">
            <li>• Barcode scanning with manual lookup fallback</li>
            <li>• Server-enforced role permissions</li>
            <li>• Explicit Gate-Out and Gate-In recording</li>
          </ul>
        </div>
        <p className="text-xs text-navy-200">
          Khuruj · خروج — university gate management
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={40} />
          </div>
          <h2 className="text-2xl font-bold text-navy-900">Sign in</h2>
          <p className="mt-1 mb-6 text-sm text-mist-500">
            Use the username your administrator gave you.
          </p>

          {!isSupabaseConfigured ? (
            <div className="mb-4">
              <Alert tone="warning" title="Supabase is not configured">
                {supabaseConfigError}
              </Alert>
            </div>
          ) : null}

          {error ? (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!isSupabaseConfigured}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!isSupabaseConfigured}
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || !isSupabaseConfigured}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-xs text-mist-500">
            Accounts are created by an administrator. There is no self sign-up;
            contact your administrator if you cannot sign in.
          </p>
        </div>
      </div>
    </div>
  )
}
