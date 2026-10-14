/**
 * Timezone-consistent time helpers.
 *
 * Timestamps are stored and compared in UTC by Postgres. Display always uses
 * the campus timezone (app_settings.campus_timezone, surfaced as
 * VITE_CAMPUS_TZ) so every role sees the same wall-clock time.
 */

export const CAMPUS_TZ = import.meta.env.VITE_CAMPUS_TZ || 'Asia/Kolkata'

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAMPUS_TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAMPUS_TZ,
    dateStyle: 'medium',
  }).format(new Date(iso))
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CAMPUS_TZ,
    timeStyle: 'short',
  }).format(new Date(iso))
}

/** Convert a `datetime-local` input value (campus wall clock) to a UTC ISO string. */
export function localInputToUtcIso(value: string): string {
  if (!value) return ''
  const asCampus = new Date(`${value}:00`)
  const offsetMs = campusOffsetMs(asCampus)
  return new Date(asCampus.getTime() - offsetMs).toISOString()
}

/** UTC ISO string -> value suitable for a `datetime-local` input in campus time. */
export function utcIsoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const offsetMs = campusOffsetMs(d)
  return new Date(d.getTime() + offsetMs).toISOString().slice(0, 16)
}

function campusOffsetMs(date: Date): number {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const campus = new Date(date.toLocaleString('en-US', { timeZone: CAMPUS_TZ }))
  return campus.getTime() - utc.getTime()
}

export function isExpired(validUntil: string, now: Date = new Date()): boolean {
  return now.getTime() > new Date(validUntil).getTime()
}

export function isNotYetValid(validFrom: string, now: Date = new Date()): boolean {
  return now.getTime() < new Date(validFrom).getTime()
}

export function isPassCurrentlyValid(
  validFrom: string,
  validUntil: string,
  now: Date = new Date(),
): boolean {
  return !isExpired(validUntil, now) && !isNotYetValid(validFrom, now)
}

/** Human-friendly "in 2h 15m" / "3h 40m ago" relative description. */
export function relativeToNow(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const mins = Math.round(abs / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const label =
    days > 0
      ? `${days}d ${hours % 24}h`
      : hours > 0
        ? `${hours}h ${mins % 60}m`
        : `${mins}m`
  return diffMs >= 0 ? `in ${label}` : `${label} ago`
}
