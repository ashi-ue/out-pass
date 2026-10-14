import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { loginEmail } from '../lib/login'
import type { AppRole, Profile, Student } from '../lib/types'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  // Distinguishes "roles loaded (possibly empty)" from "roles not fetched yet",
  // so a redirect never runs against an empty role list.
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [student, setStudent] = useState<Student | null>(null)

  const loadIdentity = useCallback(async (activeSession: Session | null) => {
    if (!activeSession?.user) {
      setProfile(null)
      setRoles([])
      setStudent(null)
      setIdentityLoaded(true)
      return
    }

    const userId = activeSession.user.id

    const [profileRes, rolesRes, studentRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', userId),
      supabase.from('students').select('*').eq('user_id', userId).maybeSingle(),
    ])

    setProfile((profileRes.data as Profile | null) ?? null)
    setRoles(
      ((rolesRes.data as { role: AppRole }[] | null) ?? []).map((r) => r.role),
    )
    setStudent((studentRes.data as Student | null) ?? null)
    setIdentityLoaded(true)
  }, [])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    setSession(data.session ?? null)
    await loadIdentity(data.session ?? null)
  }, [loadIdentity])

  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!isSupabaseConfigured) {
        setReady(true)
        return
      }
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setSession(data.session ?? null)
      await loadIdentity(data.session ?? null)
      if (!cancelled) setReady(true)
    }

    void init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void (async () => {
        setSession(next)
        setIdentityLoaded(false)
        await loadIdentity(next)
      })()
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadIdentity])

  const signIn = useCallback(async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail(username),
      password,
    })
    if (error) throw error
  }, [])

  const changePassword = useCallback(
    async (newPassword: string) => {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })
      if (error) throw error
      // Clear the server-side flag. A failure here is not fatal: the password
      // has already changed and the flag only drives a prompt.
      await supabase.rpc('complete_password_change')
      await refresh()
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setRoles([])
    setStudent(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      identityReady: ready && identityLoaded,
      session,
      profile,
      roles,
      student,
      needsStudentLink: Boolean(session) && roles.includes('student') && !student,
      mustChangePassword: Boolean(profile?.must_change_password),
      isDeactivated: Boolean(session) && profile?.is_active === false,
      refresh,
      signIn,
      changePassword,
      signOut,
    }),
    [
      ready,
      identityLoaded,
      session,
      profile,
      roles,
      student,
      refresh,
      signIn,
      changePassword,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
