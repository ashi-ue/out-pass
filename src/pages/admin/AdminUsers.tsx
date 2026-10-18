import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCreateStaff,
  adminResetPassword,
  adminSetActive,
  adminSetRoles,
  adminSetUsername,
  listProfiles,
  listUserRoles,
} from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { isValidUsername, normaliseUsername } from '../../lib/login'
import {
  ROLE_LABELS,
  STAFF_ROLES,
  TEACHER_ROLES,
  type AppRole,
  type StaffRole,
} from '../../lib/types'
import {
  Alert,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
} from '../../components/ui'

/**
 * The two kinds of account an administrator can create here.
 *
 * A teacher holds the three teaching roles at once, because approving passes is
 * split across three duties. Gate security is a single duty with its own portal.
 * Administrators are created by extending an existing account (see Edit roles),
 * which keeps the number of people who can create accounts deliberately small.
 */
const ACCOUNT_PRESETS = [
  {
    kind: 'teacher',
    label: 'Teacher',
    buttonLabel: 'Add teacher',
    title: 'Add a teacher',
    description:
      'Mentor, class teacher and duty teacher. A teacher normally holds all three.',
    roles: TEACHER_ROLES,
  },
  {
    kind: 'security',
    label: 'Gate security',
    buttonLabel: 'Add security',
    title: 'Add a gate security officer',
    description:
      'Gate security only. They verify passes at the gate and record gate-out and gate-in.',
    roles: ['gate_security'],
  },
] as const satisfies ReadonlyArray<{
  kind: string
  label: string
  buttonLabel: string
  title: string
  description: string
  roles: readonly StaffRole[]
}>

type AccountKind = (typeof ACCOUNT_PRESETS)[number]['kind']

function presetFor(kind: AccountKind) {
  return ACCOUNT_PRESETS.find((p) => p.kind === kind) ?? ACCOUNT_PRESETS[0]
}

const PASSWORD_HINT = 'At least 8 characters, with a letter and a digit.'
const USERNAME_ERROR =
  'Usernames are 3–32 characters: lowercase letters, digits, dot, dash or underscore.'

function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one digit.'
  }
  return null
}

export function AdminUsers() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [createKind, setCreateKind] = useState<AccountKind | null>(null)
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [rolesTarget, setRolesTarget] = useState<string | null>(null)

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: listProfiles,
  })
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

  function onFailure(err: unknown) {
    setNotice(null)
    setError(friendlyError(err))
  }

  const createMutation = useMutation({
    mutationFn: adminCreateStaff,
    onSuccess: (result) => {
      setError(null)
      setCreateKind(null)
      setNotice(`Account “${result.username}” created.`)
      invalidate()
    },
    onError: onFailure,
  })

  const resetMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      adminResetPassword(userId, password),
    onSuccess: () => {
      setError(null)
      setResetTarget(null)
      setNotice('Password reset. The user must change it at next sign-in.')
      invalidate()
    },
    onError: onFailure,
  })

  const renameMutation = useMutation({
    mutationFn: ({ userId, username }: { userId: string; username: string }) =>
      adminSetUsername(userId, username),
    onSuccess: (result) => {
      setError(null)
      setRenameTarget(null)
      setNotice(`Username changed to “${result.username}”.`)
      invalidate()
    },
    onError: onFailure,
  })

  const rolesMutation = useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: StaffRole[] }) =>
      adminSetRoles(userId, roles),
    onSuccess: (_result, variables) => {
      setError(null)
      setRolesTarget(null)
      setNotice(
        `Roles updated to ${variables.roles.map((r) => ROLE_LABELS[r]).join(', ')}.`,
      )
      invalidate()
    },
    onError: onFailure,
  })

  const activeMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      adminSetActive(userId, isActive),
    onSuccess: (_result, variables) => {
      setError(null)
      setNotice(
        variables.isActive ? 'Account reactivated.' : 'Account deactivated.',
      )
      invalidate()
    },
    onError: onFailure,
  })

  const busy =
    createMutation.isPending ||
    resetMutation.isPending ||
    renameMutation.isPending ||
    rolesMutation.isPending ||
    activeMutation.isPending

  const profiles = (profilesQuery.data ?? []).filter((p) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (
      (p.username ?? '').toLowerCase().includes(term) ||
      (p.full_name ?? '').toLowerCase().includes(term)
    )
  })

  const targetOf = (id: string | null) =>
    profilesQuery.data?.find((p) => p.id === id) ?? null

  return (
    <div>
      <PageHeader
        title="Teachers &amp; administrators"
        subtitle="Create staff accounts, set their username and password, and choose the permissions they hold."
        actions={
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_PRESETS.map((preset) => (
              <button
                key={preset.kind}
                type="button"
                className="btn-primary"
                onClick={() => {
                  setCreateKind(preset.kind)
                  setError(null)
                  setNotice(null)
                }}
              >
                {preset.buttonLabel}
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="mb-4 max-w-md">
        <input
          className="input"
          placeholder="Search by username or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {profilesQuery.isLoading ? (
        <Spinner label="Loading accounts…" />
      ) : profiles.length === 0 ? (
        <EmptyState
          title="No staff accounts found"
          description="Add a teacher or a gate security officer to create their username and password."
        />
      ) : (
        <div className="space-y-4">
          {profiles.map((p) => {
            const userRoles = rolesByUser.get(p.id) ?? []
            const isStaff = userRoles.some((r) => r !== 'student')
            return (
              <div key={p.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-navy-900">
                      {p.full_name || 'Unnamed user'}
                    </p>
                    <p className="font-mono text-sm text-teal-700">
                      {p.username ?? '— no username —'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {userRoles.length === 0 ? (
                        <span className="badge bg-mist-200 text-mist-600">
                          No role
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
                      {p.is_active === false ? (
                        <span className="badge bg-red-100 text-red-700">
                          Deactivated
                        </span>
                      ) : null}
                      {p.must_change_password ? (
                        <span className="badge bg-amber-100 text-amber-800">
                          Must change password
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {isStaff ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-mist-200 pt-4">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setRolesTarget(p.id)
                        setError(null)
                        setNotice(null)
                      }}
                    >
                      Edit roles
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setResetTarget(p.id)
                        setError(null)
                        setNotice(null)
                      }}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setRenameTarget(p.id)
                        setError(null)
                        setNotice(null)
                      }}
                    >
                      Change username
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() =>
                        activeMutation.mutate({
                          userId: p.id,
                          isActive: p.is_active === false,
                        })
                      }
                    >
                      {p.is_active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 border-t border-mist-200 pt-4 text-xs text-mist-500">
                    This account holds no staff role, so it can reach nothing.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-mist-500">
        Only an administrator can change a username. Teachers can change their
        own password after signing in, but not their username.
      </p>

      <CreateStaffModal
        kind={createKind}
        busy={createMutation.isPending}
        onClose={() => setCreateKind(null)}
        onSubmit={(input) => createMutation.mutate(input)}
      />

      <ResetPasswordModal
        open={resetTarget !== null}
        subject={targetOf(resetTarget)?.username ?? null}
        busy={resetMutation.isPending}
        onClose={() => setResetTarget(null)}
        onSubmit={(password) =>
          resetTarget && resetMutation.mutate({ userId: resetTarget, password })
        }
      />

      <RenameUsernameModal
        open={renameTarget !== null}
        current={targetOf(renameTarget)?.username ?? null}
        busy={renameMutation.isPending}
        onClose={() => setRenameTarget(null)}
        onSubmit={(username) =>
          renameTarget &&
          renameMutation.mutate({ userId: renameTarget, username })
        }
      />

      <EditRolesModal
        open={rolesTarget !== null}
        subject={targetOf(rolesTarget)?.full_name ?? null}
        initialRoles={rolesByUser.get(rolesTarget ?? '') ?? []}
        busy={rolesMutation.isPending}
        onClose={() => setRolesTarget(null)}
        onSubmit={(roles) =>
          rolesTarget && rolesMutation.mutate({ userId: rolesTarget, roles })
        }
      />
    </div>
  )
}

/**
 * Role checkboxes. The three teaching roles are pre-selected because a teacher
 * normally holds all of them; the admin and gate/medical duties are opt-in.
 */
function RolePicker({
  selected,
  onToggle,
}: {
  selected: StaffRole[]
  onToggle: (role: StaffRole) => void
}) {
  return (
    <div className="space-y-2">
      {STAFF_ROLES.map((r) => (
        <label
          key={r}
          className="flex items-center gap-2.5 text-sm text-navy-800"
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-mist-300 text-teal-600"
            checked={selected.includes(r)}
            onChange={() => onToggle(r)}
          />
          {ROLE_LABELS[r]}
          {r === 'admin' ? (
            <span className="text-xs text-mist-500">
              full access, including creating accounts
            </span>
          ) : null}
        </label>
      ))}
    </div>
  )
}

function CreateStaffModal({
  kind,
  busy,
  onClose,
  onSubmit,
}: {
  kind: AccountKind | null
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    username: string
    fullName: string
    roles: StaffRole[]
    password: string
  }) => void
}) {
  const preset = presetFor(kind ?? 'teacher')
  const open = kind !== null

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [roles, setRoles] = useState<StaffRole[]>([...preset.roles])
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [seededKind, setSeededKind] = useState<AccountKind | null>(null)

  // Re-seed the form whenever the modal is opened for a different kind, so
  // "Add security" never inherits the teacher's pre-selected roles.
  if (open && seededKind !== kind) {
    setSeededKind(kind)
    setRoles([...preset.roles])
    setLocalError(null)
  }
  if (!open && seededKind !== null) {
    setSeededKind(null)
    setFullName('')
    setUsername('')
    setPassword('')
    setLocalError(null)
  }

  function toggle(role: StaffRole) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role],
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const handle = normaliseUsername(username)

    if (!fullName.trim()) {
      setLocalError('Enter their full name.')
      return
    }
    if (!isValidUsername(handle)) {
      setLocalError(USERNAME_ERROR)
      return
    }
    if (roles.length === 0) {
      setLocalError('Choose at least one role.')
      return
    }
    const weak = passwordProblem(password)
    if (weak) {
      setLocalError(weak)
      return
    }

    setLocalError(null)
    onSubmit({ username: handle, fullName: fullName.trim(), roles, password })
  }

  return (
    <Modal
      open={open}
      title={preset.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-staff-form"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="create-staff-form" onSubmit={submit} className="space-y-4">
        {localError ? <Alert tone="danger">{localError}</Alert> : null}

        <Field label="Full name" htmlFor="staff-name">
          <input
            id="staff-name"
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Dr. Ayesha Rahman"
          />
        </Field>

        <Field
          label="Username"
          htmlFor="staff-username"
          hint="Used to sign in. Lowercase letters, digits, dot, dash or underscore."
        >
          <input
            id="staff-username"
            className="input font-mono"
            value={username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. ayesha.rahman"
          />
        </Field>

        <Field
          label="Roles"
          htmlFor="staff-roles"
          hint={`${preset.description} The database re-checks these on every approval.`}
        >
          <div id="staff-roles">
            <RolePicker selected={roles} onToggle={toggle} />
          </div>
        </Field>

        <Field
          label="Initial password"
          htmlFor="staff-password"
          hint={`${PASSWORD_HINT} They must change it at first sign-in.`}
        >
          <input
            id="staff-password"
            type="text"
            className="input font-mono"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}

function EditRolesModal({
  open,
  subject,
  initialRoles,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  subject: string | null
  initialRoles: AppRole[]
  busy: boolean
  onClose: () => void
  onSubmit: (roles: StaffRole[]) => void
}) {
  const staffOnly = initialRoles.filter((r): r is StaffRole =>
    (STAFF_ROLES as readonly AppRole[]).includes(r),
  )
  const [roles, setRoles] = useState<StaffRole[]>(staffOnly)
  const [localError, setLocalError] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)

  // Re-seed the checkboxes whenever a different account is opened.
  if (open && key !== subject) {
    setKey(subject)
    setRoles(staffOnly)
    setLocalError(null)
  }

  function toggle(role: StaffRole) {
    setRoles((current) =>
      current.includes(role)
        ? current.filter((r) => r !== role)
        : [...current, role],
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (roles.length === 0) {
      setLocalError('Choose at least one role.')
      return
    }
    setLocalError(null)
    onSubmit(roles)
  }

  return (
    <Modal
      open={open}
      title="Edit roles"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-roles-form"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save roles'}
          </button>
        </>
      }
    >
      <form id="edit-roles-form" onSubmit={submit} className="space-y-4">
        {localError ? <Alert tone="danger">{localError}</Alert> : null}
        <p className="text-sm text-mist-500">
          Roles for{' '}
          <span className="font-semibold text-navy-800">
            {subject ?? 'this account'}
          </span>
          . This replaces the current set.
        </p>
        <RolePicker selected={roles} onToggle={toggle} />
      </form>
    </Modal>
  )
}

function ResetPasswordModal({
  open,
  subject,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  subject: string | null
  busy: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const weak = passwordProblem(password)
    if (weak) {
      setLocalError(weak)
      return
    }
    setLocalError(null)
    onSubmit(password)
  }

  return (
    <Modal
      open={open}
      title="Reset password"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="reset-password-form"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={submit} className="space-y-4">
        {localError ? <Alert tone="danger">{localError}</Alert> : null}
        <p className="text-sm text-mist-500">
          Setting a new password for{' '}
          <span className="font-mono text-navy-800">
            {subject ?? 'this user'}
          </span>
          . They will be required to change it at next sign-in.
        </p>
        <Field
          label="New password"
          htmlFor="reset-password"
          hint={PASSWORD_HINT}
        >
          <input
            id="reset-password"
            type="text"
            className="input font-mono"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}

function RenameUsernameModal({
  open,
  current,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  current: string | null
  busy: boolean
  onClose: () => void
  onSubmit: (username: string) => void
}) {
  const [username, setUsername] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const handle = normaliseUsername(username)
    if (!isValidUsername(handle)) {
      setLocalError(USERNAME_ERROR)
      return
    }
    setLocalError(null)
    onSubmit(handle)
  }

  return (
    <Modal
      open={open}
      title="Change username"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="rename-username-form"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Change username'}
          </button>
        </>
      }
    >
      <form id="rename-username-form" onSubmit={submit} className="space-y-4">
        {localError ? <Alert tone="danger">{localError}</Alert> : null}
        <p className="text-sm text-mist-500">
          Current username:{' '}
          <span className="font-mono text-navy-800">{current ?? '—'}</span>
        </p>
        <Field label="New username" htmlFor="rename-username">
          <input
            id="rename-username"
            className="input font-mono"
            value={username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}
