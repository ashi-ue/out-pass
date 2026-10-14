import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/context'
import { listPassRequests } from '../../lib/api'
import {
  formatDateTime,
  isPassCurrentlyValid,
  relativeToNow,
} from '../../lib/time'
import { REQUEST_TYPE_LABELS, type PassWithStudent } from '../../lib/types'
import {
  Alert,
  CampusBadge,
  EmptyState,
  PageHeader,
  Spinner,
  StatusBadge,
} from '../../components/ui'

export function StudentPortal() {
  const { student, needsStudentLink, profile } = useAuth()

  const admission = student?.admission_number

  const passesQuery = useQuery({
    queryKey: ['passes', 'student', admission],
    queryFn: () =>
      listPassRequests({ admissionNumber: admission as string }),
    enabled: Boolean(admission),
  })

  const passes = passesQuery.data ?? []
  const active = passes.find(
    (p) =>
      p.approval_status === 'approved' &&
      isPassCurrentlyValid(p.valid_from, p.valid_until),
  )
  const pending = passes.filter((p) => p.approval_status === 'pending')

  return (
    <div>
      <PageHeader
        title={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ''}`}
        subtitle={
          student
            ? `Admission no. ${student.admission_number} · ID-card barcode`
            : undefined
        }
        actions={
          <Link to="/student/new" className="btn-primary">
            New out-pass request
          </Link>
        }
      />

      {needsStudentLink ? (
        <div className="mb-6">
          <Alert tone="warning" title="Account not linked">
            Your login is not yet linked to a student record. Please ask the
            administrator to link your account using your admission number
            (the barcode on your ID card) before submitting a request.
          </Alert>
        </div>
      ) : null}

      {passesQuery.isError ? (
        <div className="mb-6">
          <Alert tone="danger" title="Could not load your passes">
            {String(
              (passesQuery.error as { message?: string })?.message ??
                'Please try again.',
            )}
          </Alert>
        </div>
      ) : null}

      {active ? (
        <div className="card mb-6 border-teal-300 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
                Current valid pass
              </p>
              <p className="mt-1 text-lg font-semibold text-navy-900">
                {REQUEST_TYPE_LABELS[active.request_type]}
              </p>
              <p className="text-sm text-mist-500">{active.purpose}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-mist-500">Valid until</p>
              <p className="font-semibold text-navy-900">
                {formatDateTime(active.valid_until)}
              </p>
              <p className="text-xs text-teal-700">
                {relativeToNow(active.valid_until)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Link to={`/passes/${active.id}`} className="btn-ghost">
              View pass details
            </Link>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <Alert tone="info">
            You have no currently valid pass. An approved pass is required before
            gate security can record a Gate-Out.
          </Alert>
        </div>
      )}

      {pending.length > 0 ? (
        <p className="mb-3 text-sm text-mist-500">
          {pending.length} request{pending.length === 1 ? '' : 's'} awaiting
          approval.
        </p>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold text-navy-900">Request history</h2>

      {passesQuery.isLoading ? (
        <Spinner label="Loading your requests…" />
      ) : passes.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Submit your first out-pass request to get started."
          action={
            <Link to="/student/new" className="btn-primary">
              New out-pass request
            </Link>
          }
        />
      ) : (
        <PassTable passes={passes} />
      )}
    </div>
  )
}

function PassTable({ passes }: { passes: PassWithStudent[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-mist-200 bg-mist-50">
            <tr>
              <th className="th">Type</th>
              <th className="th">Purpose</th>
              <th className="th">Validity</th>
              <th className="th">Status</th>
              <th className="th">Campus</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-100">
            {passes.map((p) => (
              <tr key={p.id} className="hover:bg-mist-50">
                <td className="td font-medium">
                  {REQUEST_TYPE_LABELS[p.request_type]}
                </td>
                <td className="td max-w-[220px] truncate text-mist-600">
                  {p.purpose}
                </td>
                <td className="td text-mist-600">
                  {formatDateTime(p.valid_from)}
                  <br />
                  <span className="text-xs">
                    to {formatDateTime(p.valid_until)}
                  </span>
                </td>
                <td className="td">
                  <StatusBadge status={p.approval_status} />
                </td>
                <td className="td">
                  <CampusBadge
                    status={
                      p.last_gate_out_at && !p.last_gate_in_at
                        ? 'outside'
                        : 'on_campus'
                    }
                  />
                </td>
                <td className="td text-right">
                  <Link
                    to={`/passes/${p.id}`}
                    className="font-semibold text-teal-700 hover:underline"
                  >
                    Details
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
