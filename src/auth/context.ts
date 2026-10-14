import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppRole, Profile, Student } from '../lib/types'

export interface AuthState {
  /** The session has been resolved. Roles may still be loading — see identityReady. */
  ready: boolean
  /** The session AND the caller's roles/student record have both loaded. */
  identityReady: boolean
  session: Session | null
  profile: Profile | null
  roles: AppRole[]
  student: Student | null
  /** A student account that is not yet linked to a student record. */
  needsStudentLink: boolean
  /** The account still holds the temporary password an admin set. */
  mustChangePassword: boolean
  /** An administrator has deactivated this account. */
  isDeactivated: boolean
  refresh: () => Promise<void>
  /** Signs in with a username, mapped to the synthetic login address. */
  signIn: (username: string, password: string) => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
