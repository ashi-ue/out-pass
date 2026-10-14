import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { ApprovalStatus, CampusStatus } from '../lib/types'
import { APPROVAL_STATUS_LABELS } from '../lib/types'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-mist-500">
      <span
        className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-mist-300 border-t-teal-600"
        role="status"
        aria-label={label ?? 'Loading'}
      />
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  )
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export function StatusBadge({ status }: { status: ApprovalStatus }) {
  const tone: Record<ApprovalStatus, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-teal-100 text-teal-800',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-mist-200 text-mist-600',
  }
  return (
    <span className={clsx('badge', tone[status])}>
      {APPROVAL_STATUS_LABELS[status]}
    </span>
  )
}

export function CampusBadge({ status }: { status: CampusStatus }) {
  return (
    <span
      className={clsx(
        'badge',
        status === 'outside'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-navy-100 text-navy-700',
      )}
    >
      {status === 'outside' ? 'Outside campus' : 'On campus'}
    </span>
  )
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children?: ReactNode
}) {
  const tones = {
    info: 'border-navy-200 bg-navy-50 text-navy-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    danger: 'border-red-300 bg-red-50 text-red-800',
    success: 'border-teal-300 bg-teal-50 text-teal-900',
  }
  return (
    <div className={clsx('rounded-lg border p-3.5 text-sm', tones[tone])}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-mist-300 bg-white/60 px-6 py-12 text-center">
      <p className="font-semibold text-navy-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-mist-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-card)] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-mist-200 px-5 py-4">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button
            type="button"
            className="rounded-md p-1 text-mist-500 hover:bg-mist-100"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-mist-200 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-mist-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-mist-500">{hint}</p> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  tone = 'navy',
  hint,
}: {
  label: string
  value: number | string
  tone?: 'navy' | 'teal' | 'amber' | 'red'
  hint?: string
}) {
  const tones = {
    navy: 'text-navy-800',
    teal: 'text-teal-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold tracking-wide text-mist-500 uppercase">
        {label}
      </p>
      <p className={clsx('mt-2 text-3xl font-bold', tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-mist-500">{hint}</p> : null}
    </div>
  )
}
