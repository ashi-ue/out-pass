import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminLinkStudentAccount,
  adminUpsertStudent,
  listStudents,
} from '../../lib/api'
import { friendlyError } from '../../lib/errors'
import type { Student } from '../../lib/types'
import {
  Alert,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
} from '../../components/ui'

export function AdminStudents() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [creating, setCreating] = useState(false)
  const [linkTarget, setLinkTarget] = useState<Student | null>(null)
  const [error, setError] = useState<string | null>(null)

  const studentsQuery = useQuery({
    queryKey: ['students', search],
    queryFn: () => listStudents(search),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Admission numbers are the ID-card barcode values and are never regenerated."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setCreating(true)
              setError(null)
            }}
          >
            Add student
          </button>
        }
      />

      {error ? (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="mb-4 max-w-md">
        <input
          className="input"
          placeholder="Search by admission number or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {studentsQuery.isLoading ? (
        <Spinner label="Loading students…" />
      ) : (studentsQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No students found"
          description="Add student records, or import them from the existing attendance system."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-mist-200 bg-mist-50">
                <tr>
                  <th className="th">Admission no.</th>
                  <th className="th">Name</th>
                  <th className="th">Department</th>
                  <th className="th">Account</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {(studentsQuery.data ?? []).map((s) => (
                  <tr key={s.id} className="hover:bg-mist-50">
                    <td className="td font-mono text-sm">
                      {s.admission_number}
                    </td>
                    <td className="td font-medium">{s.full_name ?? '—'}</td>
                    <td className="td text-mist-600">{s.department ?? '—'}</td>
                    <td className="td">
                      {s.user_id ? (
                        <span className="badge bg-teal-100 text-teal-800">
                          Linked
                        </span>
                      ) : (
                        <span className="badge bg-mist-200 text-mist-600">
                          Not linked
                        </span>
                      )}
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-3 text-xs font-semibold text-teal-700 hover:underline"
                        onClick={() => {
                          setEditing(s)
                          setError(null)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-teal-700 hover:underline"
                        onClick={() => {
                          setLinkTarget(s)
                          setError(null)
                        }}
                      >
                        Link account
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating || editing ? (
        <StudentForm
          student={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            invalidate()
          }}
          onError={setError}
        />
      ) : null}

      {linkTarget ? (
        <LinkAccountModal
          student={linkTarget}
          onClose={() => setLinkTarget(null)}
          onSaved={() => {
            setLinkTarget(null)
            invalidate()
          }}
          onError={setError}
        />
      ) : null}

      <p className="mt-4 text-xs text-mist-500">
        Need a login for a student? Create the auth user in the Supabase
        dashboard, then link the account here. New sign-ups default to the
        student role.{' '}
        <Link to="/admin/users" className="text-teal-700 hover:underline">
          Manage users
        </Link>
      </p>
    </div>
  )
}

function StudentForm({
  student,
  onClose,
  onSaved,
  onError,
}: {
  student: Student | null
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [admissionNumber, setAdmissionNumber] = useState(
    student?.admission_number ?? '',
  )
  const [fullName, setFullName] = useState(student?.full_name ?? '')
  const [department, setDepartment] = useState(student?.department ?? '')
  const [program, setProgram] = useState(student?.program ?? '')
  const [academicYear, setAcademicYear] = useState(
    student?.academic_year?.toString() ?? '',
  )
  const [email, setEmail] = useState(student?.email ?? '')
  const [phone, setPhone] = useState(student?.phone ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      adminUpsertStudent({
        admissionNumber,
        fullName,
        department: department || null,
        program: program || null,
        academicYear: academicYear ? Number(academicYear) : null,
        email: email || null,
        phone: phone || null,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      const message = friendlyError(err)
      setFormError(message)
      onError(message)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    mutation.mutate()
  }

  return (
    <Modal
      open
      title={student ? 'Edit student' : 'Add student'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="student-form"
            className="btn-primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save student'}
          </button>
        </>
      }
    >
      {formError ? (
        <div className="mb-4">
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}
      <form id="student-form" onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Admission number (ID-card barcode)"
          htmlFor="adm"
          hint="Do not change an existing barcode value."
        >
          <input
            id="adm"
            className="input"
            required
            value={admissionNumber}
            disabled={Boolean(student)}
            onChange={(e) => setAdmissionNumber(e.target.value)}
          />
        </Field>
        <Field label="Full name" htmlFor="name">
          <input
            id="name"
            className="input"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" htmlFor="dept">
            <input
              id="dept"
              className="input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </Field>
          <Field label="Program" htmlFor="prog">
            <input
              id="prog"
              className="input"
              value={program}
              onChange={(e) => setProgram(e.target.value)}
            />
          </Field>
          <Field label="Academic year" htmlFor="year">
            <input
              id="year"
              type="number"
              className="input"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <input
              id="phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  )
}

function LinkAccountModal({
  student,
  onClose,
  onSaved,
  onError,
}: {
  student: Student
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [userId, setUserId] = useState(student.user_id ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => adminLinkStudentAccount(student.admission_number, userId),
    onSuccess: onSaved,
    onError: (err) => {
      const message = friendlyError(err)
      setFormError(message)
      onError(message)
    },
  })

  return (
    <Modal
      open
      title={`Link account · ${student.admission_number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={mutation.isPending || !userId}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Linking…' : 'Link account'}
          </button>
        </>
      }
    >
      {formError ? (
        <div className="mb-4">
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}
      <Field
        label="Auth user ID"
        htmlFor="uid"
        hint="The user's UUID from Supabase Auth (Authentication → Users)."
      >
        <input
          id="uid"
          className="input font-mono text-sm"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Field>
    </Modal>
  )
}
