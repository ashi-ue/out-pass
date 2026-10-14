import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '../auth/context'
import { isAdmin, isApprover, isGateSecurity } from '../auth/roles'
import { Logo } from './Logo'
import { ROLE_LABELS } from '../lib/types'

interface NavItem {
  to: string
  label: string
  icon: string
}

function navItemsFor(roles: ReturnType<typeof useAuth>['roles']): NavItem[] {
  const items: NavItem[] = []
  if (isAdmin(roles)) items.push({ to: '/admin', label: 'Admin dashboard', icon: '▤' })
  if (isApprover(roles)) items.push({ to: '/approver', label: 'Approvals', icon: '✓' })
  if (isGateSecurity(roles)) items.push({ to: '/gate', label: 'Gate security', icon: '⛭' })
  if (roles.includes('student') || !isApprover(roles)) {
    items.push({ to: '/student', label: 'My passes', icon: '▦' })
  }
  return items
}

export function Layout({ children }: { children?: ReactNode }) {
  const { profile, roles, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const items = navItemsFor(roles)
  const primaryRole = roles[0]

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-teal-600 text-white'
                : 'text-navy-100 hover:bg-navy-700',
            )
          }
        >
          <span aria-hidden className="w-4 text-center">
            {item.icon}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-mist-50 lg:flex">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-800 p-4 lg:flex">
        <div className="mb-8 px-2 pt-2">
          <Logo variant="light" size={44} />
        </div>
        {nav}
        <div className="mt-auto border-t border-navy-700 pt-4">
          <p className="truncate px-2 text-sm font-medium text-white">
            {profile?.full_name || profile?.email || 'Signed in'}
          </p>
          <p className="px-2 pb-3 text-xs text-teal-200">
            {primaryRole ? ROLE_LABELS[primaryRole] : 'No role assigned'}
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-navy-100 hover:bg-navy-700"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between bg-navy-800 px-4 py-3 lg:hidden">
          <Logo variant="light" size={32} />
          <button
            type="button"
            className="rounded-md px-3 py-2 text-sm font-medium text-white"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? 'Close' : 'Menu'}
          </button>
        </header>
        {mobileOpen ? (
          <div className="bg-navy-800 px-4 pb-4 lg:hidden">
            {nav}
            <button
              type="button"
              onClick={handleSignOut}
              className="mt-3 w-full rounded-lg bg-navy-700 px-3 py-2 text-left text-sm font-medium text-white"
            >
              Sign out
            </button>
          </div>
        ) : null}

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  )
}
