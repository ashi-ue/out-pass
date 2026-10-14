import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/context'
import { submitPassRequest } from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { localInputToUtcIso, utcIsoToLocalInput } from '../../lib/time'
import { REQUEST_TYPES, REQUEST_TYPE_LABELS, type RequestType } from '../../lib/types'
import { Alert, Field, PageHeader } from '../../components/ui'

/** Which request types need a destination vs. a reason. */
const NEEDS_DESTINATION: RequestType[] = ['going_home', 'afternoon_out']
const NEEDS_REASON: RequestType[] = ['medical']

function nextDefault(): { departure: string; ret: string } {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 30)
  const dep = new Date(now)
  dep.setMinutes(0, 0, 0)
  const ret = new Date(dep.getTime() + 4 * 60 * 60 * 1000)
  return {
    departure: utcIsoToLocalInput(dep.toISOString()),
    ret: utcIsoToLocalInput(ret.toISOString()),
  }
}

export function StudentNewRequest() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { student, needsStudentLink } = useAuth()
  const defaults = useMemo(() => nextDefault(), [])

  const [requestType, setRequestType] = useState<RequestType>('going_home')
  const [purpose, setPurpose] = useState('')
  const [destination, setDestination] = useState('')
  const [reason, setReason] = useState('')
  const [departure, setDeparture] = useState(defaults.departure)
  const [ret, setRet] = useState(defaults.ret)
  const [sameWindow, setSameWindow] = useState(true)
  const [validFrom, setValidFrom] = useState(defaults.departure)
  const [validUntil, setValidUntil] = useState(defaults.ret)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      submitPassRequest({
        requestType,
        purpose,
        destination: NEEDS_DESTINATION.includes(requestType) ? destination : null,
        reason: NEEDS_REASON.includes(requestType) ? reason : null,
        requestedDeparture: localInputToUtcIso(departure),
        requestedReturn: localInputToUtcIso(ret),
        validFrom: localInputToUtcIso(sameWindow ? departure : validFrom),
        validUntil: localInputToUtcIso(sameWindow ? ret : validUntil),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['passes'] })
      navigate(`/passes/${created.id}`)
    },
    onError: (err) => setError(friendlyError(err)),
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate()
  }

  if (needsStudentLink) {
    return (
      <div>
        <PageHeader title="New out-pass request" />
        <Alert tone="warning" title="Account not linked">
          Your login is not linked to a student record yet, so requests cannot be
          submitted. Ask the administrator to link your admission number to your
          account.
        </Alert>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New out-pass request"
        subtitle={
          student
            ? `Submitting as ${student.full_name ?? 'student'} · ${student.admission_number}`
            : undefined
        }
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger" title="Request not submitted">
            {error}
          </Alert>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <Field label="Request type" htmlFor="requestType">
          <select
            id="requestType"
            className="input"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as RequestType)}
          >
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Purpose" htmlFor="purpose" hint="Why are you leaving campus?">
          <input
            id="purpose"
            className="input"
            required
            maxLength={500}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>

        {NEEDS_DESTINATION.includes(requestType) ? (
          <Field label="Destination" htmlFor="destination">
            <input
              id="destination"
              className="input"
              maxLength={200}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </Field>
        ) : null}

        {NEEDS_REASON.includes(requestType) ? (
          <Field
            label="Reason"
            htmlFor="reason"
            hint="Required for medical trips."
          >
            <textarea
              id="reason"
              className="input min-h-[80px]"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Requested departure" htmlFor="departure">
            <input
              id="departure"
              type="datetime-local"
              className="input"
              required
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </Field>
          <Field label="Requested return" htmlFor="ret">
            <input
              id="ret"
              type="datetime-local"
              className="input"
              required
              value={ret}
              onChange={(e) => setRet(e.target.value)}
            />
          </Field>
        </div>

        {requestType === 'thursday_friday' ? (
          <Alert tone="info">
            Thursday/Friday permissions must start on a Thursday or a Friday.
          </Alert>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={sameWindow}
            onChange={(e) => setSameWindow(e.target.checked)}
          />
          Use the departure and return times as the pass validity window
        </label>

        {!sameWindow ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Valid from" htmlFor="validFrom">
              <input
                id="validFrom"
                type="datetime-local"
                className="input"
                required
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </Field>
            <Field label="Valid until" htmlFor="validUntil">
              <input
                id="validUntil"
                type="datetime-local"
                className="input"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-mist-200 pt-5">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate('/student')}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-mist-500">
        Submitting a request does not authorize you to leave campus. You may leave
        only after a pass is approved and gate security records a Gate-Out.
      </p>
    </div>
  )
}
