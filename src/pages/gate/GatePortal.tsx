import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gateLookup, recordGateIn, recordGateOut } from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import { formatDateTime, isExpired, relativeToNow } from '../../lib/time'
import { REQUEST_TYPE_LABELS, type GateLookupResult } from '../../lib/types'
import { Alert, PageHeader, Spinner } from '../../components/ui'
import { useBarcodeScanner } from './useBarcodeScanner'

type Confirmation =
  | { kind: 'gate_out'; admission: string; at: string }
  | { kind: 'gate_in'; admission: string; at: string }

export function GatePortal() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [lookup, setLookup] = useState<GateLookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const runLookup = useCallback(async (admissionNumber: string) => {
    const value = admissionNumber.trim()
    if (!value) return
    setLookingUp(true)
    setLookupError(null)
    setActionError(null)
    setConfirmation(null)
    try {
      const result = await gateLookup(value)
      setLookup(result)
    } catch (err) {
      setLookup(null)
      setLookupError(friendlyError(err))
    } finally {
      setLookingUp(false)
    }
  }, [])

  const scanner = useBarcodeScanner(videoRef, (text) => {
    setManualValue(text)
    void runLookup(text)
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['campus-status'] })
    void queryClient.invalidateQueries({ queryKey: ['passes'] })
    void queryClient.invalidateQueries({ queryKey: ['gate-events'] })
  }

  const gateOutMutation = useMutation({
    mutationFn: (requestId: string) => recordGateOut(requestId, note),
    onSuccess: (res) => {
      setConfirmation({
        kind: 'gate_out',
        admission: res.admission_number,
        at: res.occurred_at,
      })
      setNote('')
      setActionError(null)
      refresh()
      void runLookup(res.admission_number)
    },
    onError: (err) => setActionError(friendlyError(err)),
  })

  const gateInMutation = useMutation({
    mutationFn: (admission: string) => recordGateIn(admission, note),
    onSuccess: (res) => {
      setConfirmation({
        kind: 'gate_in',
        admission: res.admission_number,
        at: res.occurred_at,
      })
      setNote('')
      setActionError(null)
      refresh()
      void runLookup(res.admission_number)
    },
    onError: (err) => setActionError(friendlyError(err)),
  })

  function handleManualSubmit(event: FormEvent) {
    event.preventDefault()
    scanner.stop()
    void runLookup(manualValue)
  }

  useEffect(() => {
    // Pause the camera while a result is on screen to save battery.
    if (lookup && scanner.active) scanner.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup])

  const pass = lookup?.pass ?? null
  const isOutside = lookup?.campus_status === 'outside'
  const expired = pass ? isExpired(pass.valid_until) : false
  const canGateOut =
    Boolean(pass) &&
    pass?.approval_status === 'approved' &&
    !expired &&
    !isOutside &&
    lookup?.pass_is_valid === true

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Gate security"
        subtitle="Scan an ID card or enter the admission number, verify identity, then record the movement explicitly."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Scanner + manual lookup */}
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-mist-500 uppercase">
            Identify student
          </h2>

          <div className="relative overflow-hidden rounded-lg bg-navy-900">
            <video
              ref={videoRef}
              className="h-56 w-full object-cover"
              muted
              playsInline
            />
            {!scanner.active ? (
              <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-navy-100">
                Camera preview
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-teal-400/80" />
            )}
          </div>

          <div className="mt-3 flex gap-2">
            {scanner.active ? (
              <button type="button" className="btn-ghost" onClick={scanner.stop}>
                Stop camera
              </button>
            ) : (
              <button
                type="button"
                className="btn-navy"
                onClick={() => void scanner.start()}
                disabled={!scanner.supported}
              >
                Start camera scanner
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                scanner.resetDedupe()
                setManualValue('')
                setLookup(null)
                setLookupError(null)
                setConfirmation(null)
                setNote('')
              }}
            >
              Clear
            </button>
          </div>

          {scanner.error ? (
            <p className="mt-2 text-xs text-amber-700">{scanner.error}</p>
          ) : null}

          <form onSubmit={handleManualSubmit} className="mt-4">
            <label className="label" htmlFor="admission">
              Manual admission number lookup
            </label>
            <div className="flex gap-2">
              <input
                id="admission"
                className="input"
                placeholder="e.g. 2023CS1042"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={lookingUp || !manualValue.trim()}
              >
                {lookingUp ? 'Looking up…' : 'Look up'}
              </button>
            </div>
          </form>
        </div>

        {/* Result */}
        <div className="space-y-4">
          {confirmation ? (
            <Alert
              tone="success"
              title={
                confirmation.kind === 'gate_out'
                  ? 'Gate-Out recorded'
                  : 'Gate-In recorded'
              }
            >
              {confirmation.admission} —{' '}
              {confirmation.kind === 'gate_out'
                ? 'left campus'
                : 'returned to campus'}{' '}
              at {formatDateTime(confirmation.at)}.
            </Alert>
          ) : null}

          {lookupError ? (
            <Alert tone="danger" title="Lookup failed">
              {lookupError}
            </Alert>
          ) : null}

          {actionError ? (
            <Alert tone="danger" title="Action not recorded">
              {actionError}
            </Alert>
          ) : null}

          {lookingUp ? <Spinner label="Looking up student…" /> : null}

          {lookup && !lookingUp ? (
            <div className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-navy-900">
                    {lookup.student.full_name ?? 'Student'}
                  </p>
                  <p className="text-sm text-mist-500">
                    {lookup.student.admission_number}
                    {lookup.student.department
                      ? ` · ${lookup.student.department}`
                      : ''}
                  </p>
                </div>
                {isOutside ? (
                  <span className="badge bg-amber-100 text-amber-800">
                    Outside campus
                  </span>
                ) : (
                  <span className="badge bg-navy-100 text-navy-700">
                    On campus
                  </span>
                )}
              </div>

              {isOutside ? (
                <div className="mt-4">
                  <Alert tone="warning" title="Already outside">
                    This student is already outside
                    {lookup.outside_since
                      ? ` (since ${formatDateTime(lookup.outside_since)}, ${relativeToNow(
                          lookup.outside_since,
                        )})`
                      : ''}
                    . Record a Gate-In on return. A second Gate-Out is blocked.
                  </Alert>
                </div>
              ) : null}

              {pass ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <dt className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
                      Pass
                    </dt>
                    <dd className="mt-0.5 font-medium text-navy-900">
                      {REQUEST_TYPE_LABELS[pass.request_type]} — {pass.purpose}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
                      Validity
                    </dt>
                    <dd className="mt-0.5 text-navy-900">
                      {formatDateTime(pass.valid_from)} →{' '}
                      {formatDateTime(pass.valid_until)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
                      Status
                    </dt>
                    <dd className="mt-0.5">
                      {expired ? (
                        <span className="badge bg-red-100 text-red-700">
                          Expired
                        </span>
                      ) : lookup.pass_is_valid ? (
                        <span className="badge bg-teal-100 text-teal-800">
                          Valid now
                        </span>
                      ) : (
                        <span className="badge bg-mist-200 text-mist-600">
                          Not currently valid
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="mt-4">
                  <Alert tone="warning">
                    No approved pass found for this student. A Gate-Out cannot be
                    recorded. A Gate-In is still available if they are outside.
                  </Alert>
                </div>
              )}

              {expired ? (
                <div className="mt-3">
                  <Alert tone="info">
                    The pass has expired. It cannot authorize a new departure, but
                    Gate-In remains available.
                  </Alert>
                </div>
              ) : null}

              <div className="mt-4">
                <label className="label" htmlFor="gateNote">
                  Note (optional)
                </label>
                <input
                  id="gateNote"
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canGateOut || gateOutMutation.isPending}
                  onClick={() =>
                    pass && gateOutMutation.mutate(pass.id)
                  }
                >
                  {gateOutMutation.isPending ? 'Recording…' : 'Confirm Gate-Out'}
                </button>
                <button
                  type="button"
                  className="btn-navy"
                  disabled={!isOutside || gateInMutation.isPending}
                  onClick={() =>
                    gateInMutation.mutate(lookup.student.admission_number)
                  }
                >
                  {gateInMutation.isPending ? 'Recording…' : 'Confirm Gate-In'}
                </button>
              </div>

              {!canGateOut && !isOutside ? (
                <p className="mt-2 text-xs text-mist-500">
                  Gate-Out is enabled only for an approved pass inside its
                  validity window.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
