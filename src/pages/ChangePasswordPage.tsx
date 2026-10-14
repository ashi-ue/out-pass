import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { landingPath } from '../auth/roles'
import { friendlyError } from '../lib/errors'
import { Alert } from '../components/ui'
import { Logo } from '../components/Logo'

/**
 * Forced password change.
 *
 * Shown after an administrator creates an account or resets its password, so
 * the temporary credential never survives first use. A user cannot navigate
 * away: `ProtectedRoute` keeps them here until `must_change_password` clears.
 *
 * Usernames are deliberately NOT editable here — only an administrator may
 * change one.
 */
export function ChangePasswordPage() {
  const { profile, roles, changePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Include at least one letter and one digit.')
      return
    }

    setBusy(true)
    try {
      await changePassword(password)
      // Navigate imperatively: the auth change event briefly remounts this
      // route (ProtectedRoute swaps in a spinner while roles reload), so a
      // render-based redirect would be discarded.
      navigate(landingPath(roles), { replace: true })
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-bold text-navy-900">
            Choose a new password
          </h1>
          <p className="mt-1 mb-5 text-sm text-mist-500">
            {profile?.full_name
              ? `${profile.full_name}, your account still uses the password an administrator set.`
              : 'Your account still uses the password an administrator set.'}{' '}
            Choose your own before continuing.
          </p>

          {error ? (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="mt-1 text-xs text-mist-500">
                At least 8 characters, with a letter and a digit.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-4 w-full text-center text-xs text-mist-500 hover:text-navy-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
