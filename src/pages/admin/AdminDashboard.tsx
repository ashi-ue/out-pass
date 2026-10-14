import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  listPassRequests,
  listStudents,
  listStudentsOutside,
} from '../../lib/api'
import {
  formatDateTime,
  isExpired,
  isPassCurrentlyValid,
  relativeToNow,
} from '../../lib/time'
import { REQUEST_TYPE_LABELS } from '../../lib/types'
import {
  Alert,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
  StatusBadge,
} from '../../components/ui'

export function AdminDashboard() {
  const outsideQuery = useQuery({
    queryKey: ['campus-status', 'outside'],
    queryFn: listStudentsOutside,
  })
  const pendingQuery = useQuery({
    queryKey: ['passes', 'pending'],
    queryFn: () => listPassRequests({ status: 'pending' }),
  })
  const approvedQuery = useQuery({
    queryKey: ['passes', 'approved'],
    queryFn: () => listPassRequests({ status: 'approved' }),
  })
  const studentsQuery = useQuery({
    queryKey: ['students', 'all'],
    queryFn: () => listStudents(),
  })

  const outside = useMemo(() => outsideQuery.data ?? [], [outsideQuery.data])
  const pending = useMemo(() => pendingQuery.data ?? [], [pendingQuery.data])
  const approved = useMemo(() => approvedQuery.data ?? [], [approvedQuery.data])

  const activePasses = useMemo(
    () =>
      approved.filter((p) =>
        isPassCurrentlyValid(p.valid_from, p.valid_until),
      ),
    [approved],
  )

  const overdue = useMemo(
    () =>
      outside.filter(
        (s) => s.pass && isExpired(s.pass.valid_until),
      ),
    [outside],
  )

  const loading =
    outsideQuery.isLoading ||
    pendingQuery.isLoading ||
    approvedQuery.isLoading

  return (
    <div>
      <PageHeader
        title="Admin dashboard"
        subtitle="Live campus status, approvals and pass activity."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students outside"
          value={outside.length}
          tone={outside.length > 0 ? 'amber' : 'teal'}
          hint="Recorded Gate-Out, no Gate-In yet"
        />
        <StatCard
          label="Pending approvals"
          value={pending.length}
          tone="navy"
        />
        <StatCard
          label="Active passes"
          value={activePasses.length}
          tone="teal"
          hint="Approved and inside the validity window"
        />
        <StatCard
          label="Overdue returns"
          value={overdue.length}
          tone={overdue.length > 0 ? 'red' : 'navy'}
          hint="Outside with an expired pass"
        />
      </div>

      <div className="mb-6 grid gap-2 text-sm">
        <Link
          to="/admin/students"
          className="text-teal-700 hover:underline"
        >
          → Manage students
        </Link>
        <Link to="/admin/users" className="text-teal-700 hover:underline">
          → Manage users &amp; roles
        </Link>
        <Link to="/admin/rules" className="text-teal-700 hover:underline">
          → Approval rules
        </Link>
        <Link to="/admin/audit" className="text-teal-700 hover:underline">
          → Audit log
        </Link>
      </div>

      {loading ? (
        <Spinner label="Loading dashboard…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Currently outside */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-navy-900">
              Students currently outside
            </h2>
            {outside.length === 0 ? (
              <EmptyState
                title="Everyone is on campus"
                description="No student has an open Gate-Out."
              />
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-mist-200 bg-mist-50">
                    <tr>
                      <th className="th">Student</th>
                      <th className="th">Since</th>
                      <th className="th">Pass</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mist-100">
                    {outside.map((s) => {
                      const overdueRow =
                        s.pass && isExpired(s.pass.valid_until)
                      return (
                        <tr
                          key={s.admission_number}
                          className={overdueRow ? 'bg-red-50' : undefined}
                        >
                          <td className="td">
                            <span className="font-medium">
                              {s.student?.full_name ?? 'Student'}
                            </span>
                            <br />
                            <span className="text-xs text-mist-500">
                              {s.admission_number}
                            </span>
                          </td>
                          <td className="td text-mist-600">
                            {formatDateTime(s.since)}
                            <br />
                            <span className="text-xs">
                              {relativeToNow(s.since)}
                            </span>
                          </td>
                          <td className="td">
                            {s.pass ? (
                              <>
                                <span className="text-sm">
                                  {REQUEST_TYPE_LABELS[s.pass.request_type]}
                                </span>
                                <br />
                                {overdueRow ? (
                                  <span className="badge bg-red-100 text-red-700">
                                    Overdue
                                  </span>
                                ) : (
                                  <span className="text-xs text-mist-500">
                                    until {formatDateTime(s.pass.valid_until)}
                                  </span>
                                )}
                                <br />
                                <Link
                                  to={`/passes/${s.pass.id}`}
                                  className="text-xs font-semibold text-teal-700 hover:underline"
                                >
                                  Pass details
                                </Link>
                              </>
                            ) : (
                              <span className="text-xs text-mist-500">
                                No linked pass
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Pending approvals */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-navy-900">
              Pending approvals
            </h2>
            {pending.length === 0 ? (
              <EmptyState
                title="No pending requests"
                description="All requests have been decided."
              />
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full">
                  <thead className="border-b border-mist-200 bg-mist-50">
                    <tr>
                      <th className="th">Student</th>
                      <th className="th">Type</th>
                      <th className="th">Status</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mist-100">
                    {pending.slice(0, 12).map((p) => (
                      <tr key={p.id}>
                        <td className="td">
                          <span className="font-medium">
                            {p.student?.full_name ?? 'Student'}
                          </span>
                          <br />
                          <span className="text-xs text-mist-500">
                            {p.admission_number}
                          </span>
                        </td>
                        <td className="td text-mist-600">
                          {REQUEST_TYPE_LABELS[p.request_type]}
                        </td>
                        <td className="td">
                          <StatusBadge status={p.approval_status} />
                        </td>
                        <td className="td text-right">
                          <Link
                            to={`/passes/${p.id}`}
                            className="text-xs font-semibold text-teal-700 hover:underline"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pending.length > 12 ? (
                  <p className="border-t border-mist-200 px-4 py-2 text-xs text-mist-500">
                    Showing 12 of {pending.length}. Approvers see the full list in
                    their inbox.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}

      <p className="mt-6 text-xs text-mist-500">
        {studentsQuery.data
          ? `${studentsQuery.data.length} student records loaded.`
          : 'Student records load in the background.'}
      </p>

      <div className="mt-4">
        <Alert tone="info">
          Approval and physical campus status are tracked separately. Approving a
          request never records an exit — gate security must confirm a Gate-Out.
        </Alert>
      </div>
    </div>
  )
}
