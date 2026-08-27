import type { Me, Message, SearchPage, SyncPage, Topic } from './types'

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'unknown_error'
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers
  })
  if (!response.ok) {
    let envelope: ErrorEnvelope = {}
    try {
      envelope = (await response.json()) as ErrorEnvelope
    } catch {
      // A proxy or network intermediary may return a non-JSON error page.
    }
    throw new ApiError(
      envelope.error?.message ?? `The server returned ${response.status}.`,
      response.status,
      envelope.error?.code
    )
  }
  return (await response.json()) as T
}

export interface ApiClient {
  me(): Promise<Me>
  sync(after: number, limit: number): Promise<SyncPage>
  createTopic(topic: Pick<Topic, 'id' | 'title'>): Promise<Topic>
  updateTopic(topicId: string, changes: { title?: string; archived?: boolean }): Promise<Topic>
  createMessage(topicId: string, message: Pick<Message, 'id' | 'body' | 'reply_to_id'>): Promise<Message>
  updateMessage(messageId: string, body: string): Promise<Message>
  deleteMessage(messageId: string): Promise<Message>
  search(query: string, cursor?: string): Promise<SearchPage>
}

export const api: ApiClient = {
  me: () => request('/api/me'),
  sync: (after, limit) => request(`/api/sync?after=${after}&limit=${limit}`),
  createTopic: (topic) => request('/api/topics', { method: 'POST', body: JSON.stringify(topic) }),
  updateTopic: (topicId, changes) =>
    request(`/api/topics/${topicId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  createMessage: (topicId, message) =>
    request(`/api/topics/${topicId}/messages`, { method: 'POST', body: JSON.stringify(message) }),
  updateMessage: (messageId, body) =>
    request(`/api/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteMessage: (messageId) => request(`/api/messages/${messageId}`, { method: 'DELETE' }),
  search: (query, cursor) => {
    const params = new URLSearchParams({ q: query, limit: '50' })
    if (cursor) params.set('cursor', cursor)
    return request(`/api/search?${params}`)
  }
}
