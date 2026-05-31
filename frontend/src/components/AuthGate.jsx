/**
 * AuthGate — wraps the entire app with Supabase Auth (magic link).
 * Uses the anon Supabase JS client (no backend needed for auth).
 * On success, passes session to children.
 *
 * HOW IT WORKS:
 *   1. User enters email → Supabase sends magic link
 *   2. User clicks link → redirected back → session created
 *   3. Session stored in localStorage by Supabase SDK
 *   4. AuthGate shows the app only when session exists
 *
 * SETUP:
 *   In Supabase Dashboard → Authentication → URL Configuration:
 *     Site URL: https://your-app.onrender.com
 *   In Supabase → Authentication → Providers: Email enabled
 *
 * ENV (frontend, set in index.html meta or via Vite define):
 *   VITE_SUPABASE_URL  = https://xxx.supabase.co
 *   VITE_SUPABASE_ANON = eyJhbGci...
 */
import { useState, useEffect, createContext, useContext } from 'react'
import { C } from './UI'

// ── Supabase client (lazy init) ───────────────────────────────────────────────
let _sb = null

function getSupabaseClient() {
  if (_sb) return _sb
  const url  = window.__SUPABASE_URL__  || import.meta.env?.VITE_SUPABASE_URL  || ''
  const anon = window.__SUPABASE_ANON__ || import.meta.env?.VITE_SUPABASE_ANON || ''
  if (!url || !anon) return null
  try {
    const { createClient } = window.supabase || {}
    if (createClient) {
      _sb = createClient(url, anon)
    }
  } catch (e) {
    console.warn('Supabase JS not available:', e.message)
  }
  return _sb
}

// ── Auth context ──────────────────────────────────────────────────────────────
const AuthCtx = createContext({ session: null, user: null, signOut: () => {} })
export const useAuth = () => useContext(AuthCtx)

// ── Login form ────────────────────────────────────────────────────────────────
function LoginForm({ onSkip }) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const sendLink = async () => {
    if (!email.trim()) return
    setLoading(true); setError('')
    const sb = getSupabaseClient()
    if (!sb) {
      setError('Supabase not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON to env vars')
      setLoading(false)
      return
    }
    const { error: err } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (err) setError(err.message)
    else     setSent(true)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 40, maxWidth: 420, width: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,.5)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>
            AI Trading Lab
          </h1>
          <p style={{ color: C.muted, fontSize: 12, margin: '6px 0 0' }}>
            Multi-agent paper trading platform
          </p>
        </div>

        {!sent ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 6,
                            textTransform: 'uppercase', letterSpacing: 1 }}>
                Email address
              </div>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendLink()}
                type="email"
                placeholder="you@example.com"
                style={{
                  width: '100%', background: C.bg, border: `1px solid ${C.border}`,
                  borderRadius: 9, color: C.text, padding: '11px 14px',
                  fontSize: 14, outline: 'none',
                }}
              />
            </div>
            {error && (
              <div style={{ fontSize: 11, color: C.red, marginBottom: 10,
                            padding: '7px 10px', background: `${C.red}15`,
                            borderRadius: 7, border: `1px solid ${C.red}44` }}>
                {error}
              </div>
            )}
            <button onClick={sendLink} disabled={loading || !email.trim()} style={{
              width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14,
              fontWeight: 800, cursor: 'pointer', border: 'none', color: 'white',
              background: `linear-gradient(135deg,${C.accent},${C.purple})`,
              opacity: (loading || !email.trim()) ? 0.5 : 1,
              boxShadow: `0 4px 16px ${C.accent}44`,
              marginBottom: 12,
            }}>
              {loading ? '⏳ Sending…' : '✉️ Send Magic Link'}
            </button>
            <button onClick={onSkip} style={{
              width: '100%', padding: '9px 0', borderRadius: 9, fontSize: 12,
              cursor: 'pointer', background: C.surface,
              border: `1px solid ${C.border}`, color: C.muted,
            }}>
              Skip auth (demo mode)
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>📧</div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Check your email
            </h2>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.7, marginBottom: 16 }}>
              We sent a magic link to <strong style={{ color: C.accent }}>{email}</strong>.
              Click the link to sign in — no password needed.
            </p>
            <button onClick={() => setSent(false)} style={{
              padding: '7px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
              background: C.surface, border: `1px solid ${C.border}`, color: C.muted,
            }}>
              Use different email
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AuthGate wrapper ──────────────────────────────────────────────────────────
export function AuthGate({ children }) {
  const [session,  setSession]  = useState(undefined)   // undefined = loading
  const [skipped,  setSkipped]  = useState(false)

  useEffect(() => {
    const sb = getSupabaseClient()
    if (!sb) {
      setSession(null)   // no supabase configured → show login or skip
      return
    }
    // Check existing session
    sb.auth.getSession().then(({ data: { session } }) => setSession(session))
    // Listen for auth changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    const sb = getSupabaseClient()
    if (sb) await sb.auth.signOut()
    setSession(null)
    setSkipped(false)
  }

  // Loading
  if (session === undefined) {
    return (
      <div style={{ minHeight:'100vh', background:C.bg, display:'flex',
                    alignItems:'center', justifyContent:'center' }}>
        <div className="spin" style={{ width:32, height:32, borderRadius:'50%',
                                       border:`3px solid ${C.border}`, borderTopColor:C.accent }}/>
      </div>
    )
  }

  // Not authenticated and not skipped
  if (!session && !skipped) {
    return <LoginForm onSkip={() => setSkipped(true)}/>
  }

  // Authenticated or skipped
  const user = session?.user || null
  return (
    <AuthCtx.Provider value={{ session, user, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}
