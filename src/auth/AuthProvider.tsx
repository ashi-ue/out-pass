import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { AppRole, Profile, Student } from '../lib/types'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [student, setStudent] = useState<Student | null>(null)

  const loadIdentity = useCallback(async (activeSession: Session | null) => {
    if (!activeSession?.user) {
      setProfile(null)
      setRoles([])
      setStudent(null)
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
        await loadIdentity(next)
      })()
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadIdentity])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setRoles([])
    setStudent(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      profile,
      roles,
      student,
      needsStudentLink: Boolean(session) && roles.includes('student') && !student,
      refresh,
      signIn,
      signOut,
    }),
    [ready, session, profile, roles, student, refresh, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
