import { useAuth } from '../auth/context'
import { Logo } from '../components/Logo'
import { Alert } from '../components/ui'

/**
 * Shown when an administrator has deactivated the account. The session is
 * intentionally left intact so the user can read the reason; every server-side
 * action is refused for an inactive account regardless.
 */
export function AccountDisabledPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={40} />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-bold text-navy-900">Account deactivated</h1>
          <div className="mt-4">
            <Alert tone="warning">
              {profile?.full_name ? `${profile.full_name}, your` : 'Your'}{' '}
              account has been deactivated by an administrator. You cannot use
              Khuruj while it is inactive.
            </Alert>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="btn-primary mt-5 w-full"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
