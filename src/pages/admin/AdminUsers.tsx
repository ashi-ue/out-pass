import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminRevokeUserRole,
  adminSetUserRole,
  listProfiles,
  listUserRoles,
} from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { APP_ROLES, ROLE_LABELS, type AppRole } from '../../lib/types'
import {
  Alert,
  EmptyState,
  PageHeader,
  Spinner,
} from '../../components/ui'

export function AdminUsers() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })
  const rolesQuery = useQuery({ queryKey: ['user-roles'], queryFn: listUserRoles })

  const rolesByUser = useMemo(() => {
    const map = new Map<string, AppRole[]>()
    for (const r of rolesQuery.data ?? []) {
      const list = map.get(r.user_id) ?? []
      list.push(r.role)
      map.set(r.user_id, list)
    }
    return map
  }, [rolesQuery.data])

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['user-roles'] })
    void queryClient.invalidateQueries({ queryKey: ['profiles'] })
  }

  const grantMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppRole }) =>
      adminSetUserRole(userId, role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(friendlyError(err)),
  })

  const revokeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppRole }) =>
      adminRevokeUserRole(userId, role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(friendlyError(err)),
  })

  const profiles = (profilesQuery.data ?? []).filter((p) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (
      (p.email ?? '').toLowerCase().includes(term) ||
      (p.full_name ?? '').toLowerCase().includes(term)
    )
  })

  return (
    <div>
      <PageHeader
        title="Users &amp; roles"
        subtitle="Roles are the server-side source of truth. Changes are audited."
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mb-4 max-w-md">
        <input
          className="input"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {profilesQuery.isLoading ? (
        <Spinner label="Loading users…" />
      ) : profiles.length === 0 ? (
        <EmptyState
          title="No users found"
          description="Create users in Supabase Auth; profiles are provisioned automatically."
        />
      ) : (
        <div className="space-y-4">
          {profiles.map((p) => {
            const userRoles = rolesByUser.get(p.id) ?? []
            return (
              <div key={p.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-navy-900">
                      {p.full_name || 'Unnamed user'}
                    </p>
                    <p className="text-sm text-mist-500">{p.email ?? '—'}</p>
                    <p className="font-mono text-xs text-mist-400">{p.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {userRoles.length === 0 ? (
                      <span className="badge bg-mist-200 text-mist-600">
                        No roles
                      </span>
                    ) : (
                      userRoles.map((r) => (
                        <span
                          key={r}
                          className="badge bg-navy-100 text-navy-700"
                        >
                          {ROLE_LABELS[r]}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-mist-200 pt-4">
                  {APP_ROLES.map((role) => {
                    const has = userRoles.includes(role)
                    return (
                      <button
                        key={role}
                        type="button"
                        disabled={grantMutation.isPending || revokeMutation.isPending}
                        onClick={() =>
                          has
                            ? revokeMutation.mutate({ userId: p.id, role })
                            : grantMutation.mutate({ userId: p.id, role })
                        }
                        className={
                          has
                            ? 'rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100'
                            : 'rounded-full border border-mist-300 bg-white px-3 py-1 text-xs font-medium text-mist-600 hover:bg-mist-100'
                        }
                        title={has ? 'Revoke role' : 'Grant role'}
                      >
                        {has ? `✓ ${ROLE_LABELS[role]}` : `+ ${ROLE_LABELS[role]}`}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-mist-500">
        Click a role chip to grant it, or click an active role to revoke it. You
        cannot remove the last administrator.
      </p>
    </div>
  )
}
