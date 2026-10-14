import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/context'
import { canDecide } from '../auth/roles'
import {
  approvePassRequest,
  cancelPassRequest,
  getPassRequest,
  listGateEvents,
  rejectPassRequest,
} from '../lib/api'
import { friendlyError } from '../lib/errors'
import {
  formatDateTime,
  isExpired,
  isNotYetValid,
  relativeToNow,
} from '../lib/time'
import { REQUEST_TYPE_LABELS, ROLE_LABELS } from '../lib/types'
import {
  Alert,
  CampusBadge,
  CenteredSpinner,
  EmptyState,
  Modal,
  PageHeader,
  StatusBadge,
} from '../components/ui'

export function PassDetailPage() {
  const { id = '' } = useParams()
  const { roles, session } = useAuth()
  const queryClient = useQueryClient()
  const [remarks, setRemarks] = useState('')
  const [confirmReject, setConfirmReject] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const passQuery = useQuery({
    queryKey: ['pass', id],
    queryFn: () => getPassRequest(id),
    enabled: Boolean(id),
  })

  const eventsQuery = useQuery({
    queryKey: ['gate-events', passQuery.data?.admission_number],
    queryFn: () => listGateEvents(passQuery.data!.admission_number),
    enabled: Boolean(passQuery.data?.admission_number),
  })

  const pass = passQuery.data

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['pass', id] })
    void queryClient.invalidateQueries({ queryKey: ['passes'] })
    void queryClient.invalidateQueries({ queryKey: ['gate-events'] })
    void queryClient.invalidateQueries({ queryKey: ['campus-status'] })
  }

  const approveMutation = useMutation({
    mutationFn: () => approvePassRequest(id, remarks),
    onSuccess: () => {
      setRemarks('')
      setActionError(null)
      invalidate()
    },
    onError: (err) => setActionError(friendlyError(err)),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectPassRequest(id, remarks),
    onSuccess: () => {
      setRemarks('')
      setConfirmReject(false)
      setActionError(null)
      invalidate()
    },
    onError: (err) => setActionError(friendlyError(err)),
  })

  const cancelMutation = useMutation({
    mutationFn: () => cancelPassRequest(id),
    onSuccess: () => {
      setActionError(null)
      invalidate()
    },
    onError: (err) => setActionError(friendlyError(err)),
  })

  if (passQuery.isLoading) return <CenteredSpinner label="Loading pass…" />

  if (passQuery.isError || !pass) {
    return (
      <div>
        <PageHeader title="Pass details" />
        <EmptyState
          title="Pass not found"
          description="This pass does not exist, or you do not have permission to view it."
          action={
            <Link to="/" className="btn-ghost">
              Back
            </Link>
          }
        />
      </div>
    )
  }

  const isOwner = pass.student_user_id === session?.user.id
  const canApprove = canDecide(roles, pass.request_type)
  const pending = pass.approval_status === 'pending'
  const expired = isExpired(pass.valid_until)
  const notYet = isNotYetValid(pass.valid_from)
  const isOutside = Boolean(pass.last_gate_out_at && !pass.last_gate_in_at)

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={REQUEST_TYPE_LABELS[pass.request_type]}
        subtitle={`Pass ${pass.id.slice(0, 8)} · ${pass.admission_number}`}
        actions={
          <Link to="/" className="btn-ghost">
            Back
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge status={pass.approval_status} />
        <CampusBadge status={isOutside ? 'outside' : 'on_campus'} />
        {expired ? (
          <span className="badge bg-red-100 text-red-700">Expired</span>
        ) : notYet ? (
          <span className="badge bg-mist-200 text-mist-600">Not yet valid</span>
        ) : pass.approval_status === 'approved' ? (
          <span className="badge bg-teal-100 text-teal-800">Currently valid</span>
        ) : null}
      </div>

      {actionError ? (
        <div className="mb-5">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-mist-500 uppercase">
            Request details
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Student" value={pass.student?.full_name ?? '—'} />
            <Detail label="Admission no." value={pass.admission_number} />
            <Detail
              label="Department"
              value={pass.student?.department ?? '—'}
            />
            <Detail label="Purpose" value={pass.purpose} />
            {pass.destination ? (
              <Detail label="Destination" value={pass.destination} />
            ) : null}
            {pass.reason ? <Detail label="Reason" value={pass.reason} /> : null}
            <Detail
              label="Requested departure"
              value={formatDateTime(pass.requested_departure)}
            />
            <Detail
              label="Requested return"
              value={formatDateTime(pass.requested_return)}
            />
            <Detail label="Valid from" value={formatDateTime(pass.valid_from)} />
            <Detail
              label="Valid until"
              value={`${formatDateTime(pass.valid_until)} (${relativeToNow(pass.valid_until)})`}
            />
            <Detail
              label="Approver"
              value={
                pass.approver_role
                  ? ROLE_LABELS[pass.approver_role]
                  : 'Not yet decided'
              }
            />
            <Detail
              label="Decided at"
              value={formatDateTime(pass.decided_at)}
            />
            {pass.remarks ? (
              <Detail label="Remarks" value={pass.remarks} />
            ) : null}
            <Detail
              label="Last Gate-Out"
              value={formatDateTime(pass.last_gate_out_at)}
            />
            <Detail
              label="Last Gate-In"
              value={formatDateTime(pass.last_gate_in_at)}
            />
          </dl>
        </div>

        <div className="space-y-5">
          {isOutside ? (
            <Alert tone="warning" title="Student is currently outside">
              A Gate-Out has been recorded without a matching Gate-In. Gate
              security must record a Gate-In on return.
            </Alert>
          ) : null}

          {expired && pass.approval_status === 'approved' ? (
            <Alert tone="info" title="Pass expired">
              This pass can no longer authorize a new departure. A Gate-In remains
              available if the student is still outside.
            </Alert>
          ) : null}

          {canApprove && pending ? (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-navy-900">
                Decision
              </h2>
              <textarea
                className="input min-h-[80px]"
                placeholder="Remarks (required to reject)"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn-danger flex-1"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => setConfirmReject(true)}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {isOwner && pending ? (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-navy-900">
                Your request
              </h2>
              <button
                type="button"
                className="btn-ghost w-full"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel request'}
              </button>
            </div>
          ) : null}

          {isOwner && pass.approval_status === 'approved' ? (
            <Alert tone="info" title="Approval ≠ permission to leave">
              Your pass is approved, but you have not left campus until gate
              security records a Gate-Out.
            </Alert>
          ) : null}
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-navy-900">
        Gate event history
      </h2>
      {eventsQuery.isLoading ? (
        <p className="text-sm text-mist-500">Loading events…</p>
      ) : (eventsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No gate events"
          description="No Gate-Out or Gate-In has been recorded for this student yet."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-mist-200 bg-mist-50">
              <tr>
                <th className="th">Event</th>
                <th className="th">Occurred at</th>
                <th className="th">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-100">
              {(eventsQuery.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="td font-medium">
                    {e.event_type === 'gate_out' ? 'Gate-Out' : 'Gate-In'}
                  </td>
                  <td className="td text-mist-600">
                    {formatDateTime(e.occurred_at)}
                  </td>
                  <td className="td text-mist-600">{e.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={confirmReject}
        title="Reject this request?"
        onClose={() => setConfirmReject(false)}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirmReject(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Reject request'}
            </button>
          </>
        }
      >
        <p className="text-sm text-mist-600">
          Remarks are required so the student understands the decision.
        </p>
        <textarea
          className="input mt-3 min-h-[80px]"
          placeholder="Reason for rejection"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </Modal>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-navy-900">{value}</dd>
    </div>
  )
}
