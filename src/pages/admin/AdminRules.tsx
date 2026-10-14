import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminSetApprovalRule, listApprovalRules } from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import {
  REQUEST_TYPES,
  REQUEST_TYPE_LABELS,
  ROLE_LABELS,
  type AppRole,
  type RequestType,
} from '../../lib/types'
import { Alert, PageHeader, Spinner } from '../../components/ui'

const ELIGIBLE_APPROVERS: AppRole[] = [
  'class_teacher',
  'mentor',
  'medical_approver',
  'duty_teacher',
]

export function AdminRules() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['approval-rules'],
    queryFn: listApprovalRules,
  })

  const mutation = useMutation({
    mutationFn: ({
      type,
      role,
      active,
    }: {
      type: RequestType
      role: AppRole
      active: boolean
    }) => adminSetApprovalRule(type, role, active),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['approval-rules'] })
    },
    onError: (err) => setError(friendlyError(err)),
  })

  const ruleMap = new Map(
    (rulesQuery.data ?? []).map((r) => [r.request_type, r]),
  )

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Approval rules"
        subtitle="Which role approves each request type. Enforced by the database, not the UI."
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {rulesQuery.isLoading ? (
        <Spinner label="Loading rules…" />
      ) : (
        <div className="card divide-y divide-mist-100">
          {REQUEST_TYPES.map((type) => {
            const rule = ruleMap.get(type)
            return (
              <div
                key={type}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold text-navy-900">
                    {REQUEST_TYPE_LABELS[type]}
                  </p>
                  <p className="text-xs text-mist-500">
                    {rule?.is_active
                      ? `Approved by ${ROLE_LABELS[rule.approver_role]}`
                      : 'No active approver configured'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className="input w-48"
                    value={rule?.approver_role ?? ''}
                    disabled={mutation.isPending}
                    onChange={(e) =>
                      mutation.mutate({
                        type,
                        role: e.target.value as AppRole,
                        active: rule?.is_active ?? true,
                      })
                    }
                  >
                    <option value="" disabled>
                      Select approver…
                    </option>
                    {ELIGIBLE_APPROVERS.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm text-navy-800">
                    <input
                      type="checkbox"
                      checked={rule?.is_active ?? false}
                      disabled={mutation.isPending || !rule}
                      onChange={(e) =>
                        rule &&
                        mutation.mutate({
                          type,
                          role: rule.approver_role,
                          active: e.target.checked,
                        })
                      }
                    />
                    Active
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-mist-500">
        Administrators can always decide any request. Students can never approve
        their own request.
      </p>
    </div>
  )
}
