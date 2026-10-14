import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/context'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { landingPath } from './auth/roles'
import { CenteredSpinner } from './components/ui'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { AdminStudents } from './pages/admin/AdminStudents'
import { AdminUsers } from './pages/admin/AdminUsers'
import { AdminAudit } from './pages/admin/AdminAudit'
import { AdminRules } from './pages/admin/AdminRules'
import { ApproverInbox } from './pages/approver/ApproverInbox'
import { StudentPortal } from './pages/student/StudentPortal'
import { StudentNewRequest } from './pages/student/StudentNewRequest'
import { PassDetailPage } from './pages/PassDetailPage'
import { GatePortal } from './pages/gate/GatePortal'

function HomeRedirect() {
  const { ready, session, roles } = useAuth()
  if (!ready) return <CenteredSpinner />
  if (!session) return <Navigate to="/login" replace />
  return <Navigate to={landingPath(roles)} replace />
}

const ADMIN: ['admin'] = ['admin']
const APPROVER = ['admin', 'mentor', 'class_teacher', 'medical_approver', 'duty_teacher'] as const
const GATE = ['admin', 'gate_security'] as const
const STUDENT = ['student', 'admin'] as const

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />

      {/* Authenticated shell */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={[...ADMIN]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/students"
          element={
            <ProtectedRoute roles={[...ADMIN]}>
              <AdminStudents />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={[...ADMIN]}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/rules"
          element={
            <ProtectedRoute roles={[...ADMIN]}>
              <AdminRules />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <ProtectedRoute roles={[...ADMIN]}>
              <AdminAudit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/approver"
          element={
            <ProtectedRoute roles={[...APPROVER]}>
              <ApproverInbox />
            </ProtectedRoute>
          }
        />
        <Route
          path="/gate"
          element={
            <ProtectedRoute roles={[...GATE]}>
              <GatePortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student"
          element={
            <ProtectedRoute roles={[...STUDENT]}>
              <StudentPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/student/new"
          element={
            <ProtectedRoute roles={[...STUDENT]}>
              <StudentNewRequest />
            </ProtectedRoute>
          }
        />
        <Route
          path="/passes/:id"
          element={
            <ProtectedRoute>
              <PassDetailPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
