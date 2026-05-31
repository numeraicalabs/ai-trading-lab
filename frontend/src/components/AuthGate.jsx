/**
 * AuthGate — Supabase magic-link auth.
 *
 * Uses @supabase/supabase-js as npm dependency (no CDN needed).
 * import.meta.env.VITE_* vars are injected by Vite at build time.
 *
 * Render setup:
 *   VITE_SUPABASE_URL  = https://YOUR_PROJECT.supabase.co
 *   VITE_SUPABASE_ANON = eyJhbGci...  (anon/public key — safe for frontend)
 *
 * Supabase Dashboard:
 *   Authentication → URL Configuration → Site URL = your Render URL
 *   Authentication → Providers → Email → enable
 */
import { useState, useEffect, createContext, useContext } from 'react'
import { createClient } from '@supabase/supabase-js'
import { C } from './UI'

// ── Supabase singleton ────────────────────────────────────────────────────────
let _sb = null

function getSupabase() {
  if (_sb) return _sb

  const url  = import.meta.env.VITE_SUPABASE_URL  || ''
  const anon = import.meta.env.VITE_SUPABASE_ANON || ''

  if (!url || !anon) return null

  try {
    _sb = createClient(url, anon)
    return _sb
  } catch (e) {
    console.error('Supabase init error:', e)
    return null
  }
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
    setLoading(true)
    setError('')

    const sb = getSupabase()
    if (!sb) {
      setError(
        'Supabase non configurato. ' +
        'Verifica che VITE_SUPABASE_URL e VITE_SUPABASE_ANON siano ' +
        'impostate in Render → Environment prima del build.'
      )
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
      minHeight: '100vh', background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 40, maxWidth: 400, width: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,.5)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>
            AI Trading Lab
          </h1>
          <p style={{ color: C.muted, fontSize: 12, margin: '6px 0 0' }}>
            Multi-agent paper trading platform
          </p>
        </div>

        {!sent ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10, color: C.muted, marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                Indirizzo email
              </div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendLink()}
                placeholder="tu@esempio.com"
                style={{
                  width: '100%', background: C.bg,
                  border: `1px solid ${C.border}`, borderRadius: 9,
                  color: C.text, padding: '11px 14px',
                  fontSize: 14, outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{
                fontSize: 11, color: C.red, marginBottom: 12,
                padding: '9px 12px', background: `${C.red}15`,
                borderRadius: 8, border: `1px solid ${C.red}44`,
                lineHeight: 1.6,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={sendLink}
              disabled={loading || !email.trim()}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                fontSize: 14, fontWeight: 800, cursor: 'pointer',
                border: 'none', color: 'white',
                background: `linear-gradient(135deg,${C.accent},${C.purple})`,
                opacity: (loading || !email.trim()) ? 0.5 : 1,
                boxShadow: `0 4px 16px ${C.accent}44`,
                marginBottom: 10,
              }}
            >
              {loading ? '⏳ Invio in corso…' : '✉️ Invia Magic Link'}
            </button>

            <button
              onClick={onSkip}
              style={{
                width: '100%', padding: '9px 0', borderRadius: 9,
                fontSize: 12, cursor: 'pointer',
                background: C.surface, border: `1px solid ${C.border}`,
                color: C.muted,
              }}
            >
              Continua senza login (demo)
            </button>

            <p style={{ fontSize: 10, color: C.dim, textAlign: 'center', marginTop: 14 }}>
              Nessuna password — ricevi un link via email per accedere
            </p>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>📧</div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Controlla la tua email
            </h2>
            <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.7, marginBottom: 18 }}>
              Abbiamo inviato un magic link a{' '}
              <strong style={{ color: C.accent }}>{email}</strong>.
              Clicca il link per accedere.
            </p>
            <button
              onClick={() => setSent(false)}
              style={{
                padding: '7px 20px', borderRadius: 8, cursor: 'pointer',
                fontSize: 11, background: C.surface,
                border: `1px solid ${C.border}`, color: C.muted,
              }}
            >
              Usa un altro indirizzo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AuthGate wrapper ──────────────────────────────────────────────────────────
export function AuthGate({ children }) {
  const [session, setSession] = useState(undefined)   // undefined = loading
  const [skipped, setSkipped] = useState(false)

  useEffect(() => {
    const sb = getSupabase()

    if (!sb) {
      // No Supabase configured → show login (which will show config error)
      setSession(null)
      return
    }

    // Restore existing session
    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // Listen for future auth changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    const sb = getSupabase()
    if (sb) await sb.auth.signOut()
    setSession(null)
    setSkipped(false)
  }

  // Loading state
  if (session === undefined) {
    return (
      <div style={{
        minHeight: '100vh', background: C.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div
          className="spin"
          style={{
            width: 32, height: 32, borderRadius: '50%',
            border: `3px solid ${C.border}`, borderTopColor: C.accent,
          }}
        />
      </div>
    )
  }

  // Not authenticated and not skipped → show login
  if (!session && !skipped) {
    return <LoginForm onSkip={() => setSkipped(true)} />
  }

  // Authenticated or skipped
  return (
    <AuthCtx.Provider value={{ session, user: session?.user || null, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}
