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
  const { identityReady, session, roles } = useAuth()
  const location = useLocation()

  if (!identityReady) return <CenteredSpinner label="Checking your session…" />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (allowed && allowed.length > 0) {
    const permitted = roles.some((r) => allowed.includes(r))
    if (!permitted) return <Navigate to={landingPath(roles)} replace />
  }

  return <>{children}</>
}
