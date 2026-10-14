import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context'
import { approvableTypes } from '../../auth/roles'
import { listApprovalRules, listPassRequests } from '../../lib/api'
import { formatDateTime, relativeToNow } from '../../lib/time'
import {
  REQUEST_TYPE_LABELS,
  type ApprovalRule,
  type RequestType,
} from '../../lib/types'
import {
  Alert,
  EmptyState,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../../components/ui'

export function ApproverInbox() {
  const { roles } = useAuth()
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all')

  const rulesQuery = useQuery({
    queryKey: ['approval-rules'],
    queryFn: listApprovalRules,
  })

  const ruleMap = useMemo(() => {
    const map: Partial<Record<RequestType, ApprovalRule['approver_role']>> = {}
    for (const r of rulesQuery.data ?? []) {
      if (r.is_active) map[r.request_type] = r.approver_role
    }
    return map
  }, [rulesQuery.data])

  const mine = useMemo(() => approvableTypes(roles, ruleMap), [roles, ruleMap])

  const pendingQuery = useQuery({
    queryKey: ['passes', 'pending', mine.join(',')],
    queryFn: () => listPassRequests({ status: 'pending' }),
    enabled: mine.length > 0,
  })

  const pending = useMemo(() => {
    const all = pendingQuery.data ?? []
    return all.filter((p) => mine.includes(p.request_type))
  }, [pendingQuery.data, mine])

  const visible = useMemo(
    () =>
      typeFilter === 'all'
        ? pending
        : pending.filter((p) => p.request_type === typeFilter),
    [pending, typeFilter],
  )

  if (mine.length === 0) {
    return (
      <div>
        <PageHeader title="Approvals" />
        <Alert tone="warning" title="No approval scope">
          Your account does not have an approver role. Ask an administrator to
          grant the role matching your responsibility.
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Approval inbox"
        subtitle={`You can decide: ${mine
          .map((t) => REQUEST_TYPE_LABELS[t])
          .join(', ')}`}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <FilterChip
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
        >
          All ({pending.length})
        </FilterChip>
        {mine.map((t) => (
          <FilterChip
            key={t}
            active={typeFilter === t}
            onClick={() => setTypeFilter(t)}
          >
            {REQUEST_TYPE_LABELS[t]} (
            {pending.filter((p) => p.request_type === t).length})
          </FilterChip>
        ))}
      </div>

      {pendingQuery.isError ? (
        <Alert tone="danger" title="Could not load requests">
          {String(
            (pendingQuery.error as { message?: string })?.message ??
              'Please try again.',
          )}
        </Alert>
      ) : pendingQuery.isLoading ? (
        <Spinner label="Loading requests…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing awaiting your decision"
          description="New requests that fall within your approval scope will appear here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((p) => (
            <article key={p.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy-900">
                    {p.student?.full_name ?? 'Student'}
                  </p>
                  <p className="text-xs text-mist-500">
                    {p.admission_number}
                    {p.student?.department ? ` · ${p.student.department}` : ''}
                  </p>
                </div>
                <StatusBadge status={p.approval_status} />
              </div>

              <p className="mt-3 text-sm font-medium text-teal-700">
                {REQUEST_TYPE_LABELS[p.request_type]}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-mist-600">
                {p.purpose}
              </p>

              <dl className="mt-3 space-y-1 text-xs text-mist-500">
                <div className="flex justify-between gap-2">
                  <dt>Departure</dt>
                  <dd className="text-navy-800">
                    {formatDateTime(p.requested_departure)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Return</dt>
                  <dd className="text-navy-800">
                    {formatDateTime(p.requested_return)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Submitted</dt>
                  <dd className="text-navy-800">
                    {relativeToNow(p.created_at)}
                  </dd>
                </div>
              </dl>

              <Link
                to={`/passes/${p.id}`}
                className="btn-navy mt-4 w-full justify-center"
              >
                Review &amp; decide
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-navy-800 px-3.5 py-1.5 text-sm font-semibold text-white'
          : 'rounded-full border border-mist-300 bg-white px-3.5 py-1.5 text-sm font-medium text-navy-800 hover:bg-mist-100'
      }
    >
      {children}
    </button>
  )
}
