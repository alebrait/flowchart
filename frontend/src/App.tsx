import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, initializeSession } from './api'
import { DiagramDashboard } from './Dashboard'
import { DiagramEditor } from './Editor'
import { clearUserRecoveryDrafts } from './flow/recoveryDrafts'
import type { DiagramSummary, User } from './types'
import './App.css'

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function AuthenticationScreen({
  onAuthenticated,
  notice,
}: {
  onAuthenticated: (user: User) => void
  notice: string
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'register') {
        await api.post('/auth/register/', { username, password })
      }
      const response = await api.post<User>('/auth/login/', { username, password })
      onAuthenticated(response)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <a className="wordmark" href="/" aria-label="Flowchart home">
          Flowchart
        </a>
        <div>
          <p className="eyebrow">Process mapping</p>
          <h1>See the shape of your work.</h1>
          <p>Map actions, decisions, hand-offs, and the paths between them.</p>
        </div>
        <p className="auth-footnote">Your diagrams stay private to your account.</p>
      </section>
      <section className="auth-form-region">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <h2>{mode === 'login' ? 'Welcome back' : 'Create an account'}</h2>
            <p>
              {mode === 'login'
                ? 'Sign in to continue to your diagrams.'
                : 'Create an account to save your diagrams.'}
            </p>
          </div>
          {notice && <p className="inline-notice" role="status">{notice}</p>}
          <label>
            Username
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={submitting} type="submit">
            {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? 'New to Flowchart?' : 'Already have an account?'}{' '}
            <button
              className="text-button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError('')
              }}
              type="button"
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </section>
    </main>
  )
}

function diagramIdFromPath(path: string) {
  const match = path.match(/^\/diagrams\/([0-9a-f-]+)\/?$/i)
  return match?.[1] ?? null
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [path, setPath] = useState(window.location.pathname)
  const [diagram, setDiagram] = useState<DiagramSummary | null>(null)
  const [diagramFailure, setDiagramFailure] = useState<{ id: string; message: string } | null>(
    null,
  )
  const diagramId = diagramIdFromPath(path)

  const refreshSession = useCallback(async () => {
    setSessionError('')
    setSessionReady(false)
    try {
      const session = await initializeSession()
      setUser(session.user)
    } catch (error) {
      setSessionError(errorMessage(error))
    } finally {
      setSessionReady(true)
    }
  }, [])

  useEffect(() => {
    let active = true
    initializeSession()
      .then((session) => {
        if (active) setUser(session.user)
      })
      .catch((error: unknown) => {
        if (active) setSessionError(errorMessage(error))
      })
      .finally(() => {
        if (active) setSessionReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!user || !diagramId) return
    let active = true
    api
      .get<DiagramSummary>(`/diagrams/${diagramId}/`)
      .then((result) => {
        if (active) {
          setDiagram(result)
          setDiagramFailure(null)
        }
      })
      .catch((error: unknown) => {
        if (active) setDiagramFailure({ id: diagramId, message: errorMessage(error) })
      })
    return () => {
      active = false
    }
  }, [diagramId, user])

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }, [])

  const handleAuthenticated = (nextUser: User) => {
    setSessionError('')
    setAuthNotice('')
    setUser(nextUser)
    navigate('/')
  }

  const handleSessionExpired = (message: string) => {
    setAuthNotice(message)
    setUser(null)
    setDiagram(null)
    navigate('/')
  }

  const handleLogout = async () => {
    const activeUser = user
    if (!activeUser) return
    setSessionError('')
    try {
      await api.post('/auth/logout/')
      let notice = ''
      try {
        clearUserRecoveryDrafts(window.localStorage, activeUser.id)
      } catch (storageError) {
        notice =
          storageError instanceof Error
            ? `Signed out, but recovery drafts could not be cleared from this browser: ${storageError.message}`
            : 'Signed out, but recovery drafts could not be cleared from this browser.'
      }
      setAuthNotice(notice)
      setUser(null)
      setDiagram(null)
      navigate('/')
    } catch (error) {
      setSessionError(errorMessage(error))
    }
  }

  if (!sessionReady) {
    return <main className="loading-screen" aria-label="Loading account"><div className="skeleton-line" /></main>
  }
  if (sessionError && !user) {
    return (
      <main className="message-screen">
        <h1>Could not connect</h1>
        <p role="alert">{sessionError}</p>
        <button className="button button-primary" onClick={() => void refreshSession()} type="button">
          Try again
        </button>
      </main>
    )
  }
  if (!user) {
    return <AuthenticationScreen onAuthenticated={handleAuthenticated} notice={authNotice} />
  }
  if (diagramId && diagramFailure?.id === diagramId) {
    return (
      <main className="message-screen">
        <h1>Diagram unavailable</h1>
        <p role="alert">{diagramFailure.message}</p>
        <button className="button button-secondary" onClick={() => navigate('/')} type="button">
          Back to diagrams
        </button>
      </main>
    )
  }
  if (diagramId && diagram?.id !== diagramId) {
    return <main className="loading-screen" aria-label="Loading diagram"><div className="skeleton-line" /></main>
  }
  if (diagram && diagram.id === diagramId) {
    return (
      <DiagramEditor
        key={diagram.id}
        diagram={diagram}
        user={user}
        onBack={() => navigate('/')}
        onOpenDiagram={(id) => navigate(`/diagrams/${id}`)}
        onSessionExpired={handleSessionExpired}
        onDiagramChanged={setDiagram}
      />
    )
  }
  return (
    <DiagramDashboard
      user={user}
      logoutError={sessionError}
      onLogout={handleLogout}
      onOpenDiagram={(id) => navigate(`/diagrams/${id}`)}
    />
  )
}
