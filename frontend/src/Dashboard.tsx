import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { DiagramSummary, User } from './types'

interface DashboardProps {
  user: User
  logoutError: string
  onLogout: () => void
  onOpenDiagram: (id: string) => void
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function DiagramDashboard({
  user,
  logoutError,
  onLogout,
  onOpenDiagram,
}: DashboardProps) {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchDiagrams = useCallback(() => api.get<DiagramSummary[]>('/diagrams/'), [])

  const loadDiagrams = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      setDiagrams(await fetchDiagrams())
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setLoading(false)
    }
  }, [fetchDiagrams])

  useEffect(() => {
    let active = true
    fetchDiagrams()
      .then((result) => {
        if (active) setDiagrams(result)
      })
      .catch((requestError: unknown) => {
        if (active) setError(messageFor(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fetchDiagrams])

  const createDiagram = async () => {
    setCreating(true)
    setError('')
    try {
      const diagram = await api.post<DiagramSummary>('/diagrams/', { title: '' })
      onOpenDiagram(diagram.id)
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setCreating(false)
    }
  }

  const duplicateDiagram = async (diagram: DiagramSummary) => {
    setBusyId(diagram.id)
    setError('')
    try {
      const duplicate = await api.post<DiagramSummary>(`/diagrams/${diagram.id}/duplicate/`)
      setDiagrams((current) => [duplicate, ...current])
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const deleteDiagram = async (diagram: DiagramSummary) => {
    const title = diagram.title || 'Untitled diagram'
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return
    setBusyId(diagram.id)
    setError('')
    try {
      await api.delete(`/diagrams/${diagram.id}/`)
      setDiagrams((current) => current.filter((item) => item.id !== diagram.id))
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setBusyId(null)
    }
  }

  const renameDiagram = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingId) return
    setBusyId(editingId)
    setError('')
    try {
      const renamed = await api.patch<DiagramSummary>(`/diagrams/${editingId}/`, {
        title: editingTitle,
      })
      setDiagrams((current) => current.map((item) => (item.id === editingId ? renamed : item)))
      setEditingId(null)
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="app-header">
        <a className="wordmark" href="/" onClick={(event) => event.preventDefault()}>
          Flowchart
        </a>
        <div className="account-menu">
          {user.is_superuser && <span className="role-label">Administrator</span>}
          <span className="account-name">{user.username}</span>
          <button className="button button-quiet" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <h1>Your diagrams</h1>
            <p>Keep a clear view of the steps and decisions in your process.</p>
          </div>
          <button
            className="button button-primary"
            disabled={creating}
            onClick={() => void createDiagram()}
            type="button"
          >
            {creating ? 'Creating…' : 'New diagram'}
          </button>
        </div>

        {error && (
          <div className="notice notice-error" role="alert">
            <span>{error}</span>
            <button className="text-button" onClick={() => void loadDiagrams()} type="button">
              Retry
            </button>
          </div>
        )}
        {logoutError && (
          <div className="notice notice-error" role="alert">
            <span>{logoutError}</span>
          </div>
        )}

        {loading ? (
          <div className="diagram-list-skeleton" aria-label="Loading diagrams">
            <div />
            <div />
            <div />
          </div>
        ) : error && diagrams.length === 0 ? (
          <div className="empty-state">
            <h2>Diagrams could not be loaded</h2>
            <p>Try again when the connection is available.</p>
            <button className="button button-secondary" onClick={() => void loadDiagrams()} type="button">
              Retry
            </button>
          </div>
        ) : diagrams.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark" aria-hidden="true"><span /><span /><span /></div>
            <h2>Start with a blank canvas</h2>
            <p>Create a diagram, then add actions, decisions, and connections as you go.</p>
            <button
              className="button button-primary"
              disabled={creating}
              onClick={() => void createDiagram()}
              type="button"
            >
              Create a diagram
            </button>
          </div>
        ) : (
          <div className="diagram-list">
            {diagrams.map((diagram) => (
              <article className="diagram-row" key={diagram.id}>
                <div className="diagram-open">
                  <span className="diagram-mark" aria-hidden="true"><i /><i /><i /></span>
                  <span className="diagram-main">
                    {editingId === diagram.id ? (
                      <form className="rename-form" onSubmit={renameDiagram}>
                        <label className="visually-hidden" htmlFor={`rename-${diagram.id}`}>
                          Diagram title
                        </label>
                        <input
                          autoFocus
                          id={`rename-${diagram.id}`}
                          maxLength={200}
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                        />
                        <button className="button button-primary button-small" disabled={busyId === diagram.id} type="submit">
                          Save name
                        </button>
                        <button className="button button-quiet button-small" onClick={() => setEditingId(null)} type="button">
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          className="diagram-title-button"
                          onClick={() => onOpenDiagram(diagram.id)}
                          type="button"
                        >
                          {diagram.title || 'Untitled diagram'}
                        </button>
                        <span className="diagram-meta">
                          {user.is_superuser ? `Owned by ${diagram.owner.username} · ` : ''}
                          Updated {new Date(diagram.updated_at).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {editingId !== diagram.id && (
                  <div className="diagram-actions">
                    <button
                      className="button button-quiet button-small"
                      onClick={() => {
                        setEditingId(diagram.id)
                        setEditingTitle(diagram.title)
                      }}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      className="button button-quiet button-small"
                      disabled={busyId === diagram.id}
                      onClick={() => void duplicateDiagram(diagram)}
                      type="button"
                    >
                      Duplicate
                    </button>
                    <button
                      className="button button-danger button-small"
                      disabled={busyId === diagram.id}
                      onClick={() => void deleteDiagram(diagram)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
