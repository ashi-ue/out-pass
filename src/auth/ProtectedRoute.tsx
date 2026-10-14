import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context'
import { landingPath } from './roles'
import { CenteredSpinner } from '../components/ui'
import type { AppRole } from '../lib/types'

/**
 * Route guard.
 *
 * This only controls navigation; the database independently enforces every
 * permission, so a user who forges a URL still cannot read or change data they
 * are not entitled to.
 */
export function ProtectedRoute({
  roles: allowed,
  children,
}: {
  roles?: AppRole[]
  children: ReactNode
}) {
  const { identityReady, session, roles, mustChangePassword, isDeactivated } =
    useAuth()
  const location = useLocation()

  if (!identityReady) return <CenteredSpinner label="Checking your session…" />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // An administrator has deactivated the account. Signing out is the only way
  // forward; the database refuses the account's actions in any case.
  if (isDeactivated) return <Navigate to="/account-disabled" replace />

  // A temporary password must be replaced before anything else is reachable.
  // This runs before the role check so it cannot be skipped by a deep link.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  if (allowed && allowed.length > 0) {
    const permitted = roles.some((r) => allowed.includes(r))
    if (!permitted) return <Navigate to={landingPath(roles)} replace />
  }

  return <>{children}</>
}
