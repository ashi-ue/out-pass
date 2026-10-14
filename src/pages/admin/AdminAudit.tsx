import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAuditLog } from '../../lib/api'
import { formatDateTime } from '../../lib/time'
import { ROLE_LABELS } from '../../lib/types'
import {
  Alert,
  EmptyState,
  PageHeader,
  Spinner,
} from '../../components/ui'

export function AdminAudit() {
  const [filter, setFilter] = useState('')
  const auditQuery = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => listAuditLog(300),
  })

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const all = auditQuery.data ?? []
    if (!term) return all
    return all.filter(
      (e) =>
        e.action.toLowerCase().includes(term) ||
        (e.admission_number ?? '').toLowerCase().includes(term) ||
        e.entity_type.toLowerCase().includes(term),
    )
  }, [auditQuery.data, filter])

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of approvals, rejections, gate events and administrative changes."
      />

      <div className="mb-4 max-w-md">
        <input
          className="input"
          placeholder="Filter by action, entity or admission number"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {auditQuery.isError ? (
        <Alert tone="danger" title="Could not load the audit log">
          {String(
            (auditQuery.error as { message?: string })?.message ??
              'Please try again.',
          )}
        </Alert>
      ) : auditQuery.isLoading ? (
        <Spinner label="Loading audit log…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description="Approvals, gate events and administrative changes appear here."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-mist-200 bg-mist-50">
                <tr>
                  <th className="th">When</th>
                  <th className="th">Action</th>
                  <th className="th">Entity</th>
                  <th className="th">Admission no.</th>
                  <th className="th">Actor role</th>
                  <th className="th">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {rows.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-mist-50">
                    <td className="td whitespace-nowrap text-mist-600">
                      {formatDateTime(e.created_at)}
                    </td>
                    <td className="td font-medium">{e.action}</td>
                    <td className="td text-mist-600">{e.entity_type}</td>
                    <td className="td font-mono text-xs">
                      {e.admission_number ?? '—'}
                    </td>
                    <td className="td text-mist-600">
                      {e.actor_role ? ROLE_LABELS[e.actor_role] : '—'}
                    </td>
                    <td className="td max-w-[280px]">
                      <code className="text-xs break-all text-mist-500">
                        {Object.keys(e.details ?? {}).length > 0
                          ? JSON.stringify(e.details)
                          : '—'}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
