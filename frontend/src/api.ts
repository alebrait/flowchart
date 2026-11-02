export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function csrfToken() {
  const token = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('csrftoken='))
    ?.split('=')
    .slice(1)
    .join('=')
  return token ? decodeURIComponent(token) : ''
}

function describeError(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    if ('detail' in body && typeof body.detail === 'string') return body.detail
    const messages = Object.entries(body).map(([field, value]) => {
      const text = Array.isArray(value)
        ? value.map(String).join(' ')
        : typeof value === 'string'
          ? value
          : JSON.stringify(value)
      return `${field}: ${text}`
    })
    if (messages.length) return messages.join(' ')
  }
  return `Request failed (${status}).`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method)) {
    const token = csrfToken()
    if (token) headers.set('X-CSRFToken', token)
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
  })
  if (response.status === 204) return undefined as T

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(describeError(body, response.status), response.status, body)
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export async function initializeSession() {
  await api.get<{ detail: string }>('/csrf/')
  return api.get<{ user: { id: number; username: string; is_superuser: boolean } | null }>(
    '/auth/me/',
  )
}
