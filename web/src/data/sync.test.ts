import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from './api'
import { TextYourselfDatabase } from './db'
import { queueMessageCreate, queueTopicCreate } from './mutations'
import { SyncEngine } from './sync'
import type { Me, Message, SyncPage, Topic } from './types'

const me: Me = { user_id: 'user@example.com', display_name: 'Avery', role: 'editor' }
const databases: TextYourselfDatabase[] = []

function topic(id: string, version: number): Topic {
  return {
    id,
    title: `Topic ${version}`,
    created_by: me.user_id,
    creator_display_name: me.display_name,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    sync_version: version
  }
}

function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const noSearch = async () => ({ results: [], next_cursor: null, has_more: false })
  return {
    me: vi.fn(async () => me),
    sync: vi.fn(async () => ({ changes: [], next_version: 0, has_more: false })),
    createTopic: vi.fn(async (input) => topic(input.id, 1)),
    updateTopic: vi.fn(),
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    search: vi.fn(noSearch),
    ...overrides
  }
}

function database(): TextYourselfDatabase {
  const instance = new TextYourselfDatabase(`test-${crypto.randomUUID()}-${databases.length}`)
  databases.push(instance)
  return instance
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()))
})

describe('SyncEngine', () => {
  it('pulls every bounded page and advances the durable cursor', async () => {
    const pages: SyncPage[] = [
      { changes: [{ kind: 'topic', data: topic('00000000-0000-4000-8000-000000000010', 1) }], next_version: 1, has_more: true },
      { changes: [{ kind: 'topic', data: topic('00000000-0000-4000-8000-000000000011', 2) }], next_version: 2, has_more: false }
    ]
    const client = mockClient({ sync: vi.fn(async () => pages.shift()!) })
    const store = database()

    const result = await new SyncEngine(store, client).run()

    expect(result.received).toBe(2)
    expect(await store.topics.count()).toBe(2)
    expect((await store.meta.get('sync_version'))?.value).toBe(2)
    expect(client.sync).toHaveBeenNthCalledWith(1, 0, 200)
    expect(client.sync).toHaveBeenNthCalledWith(2, 1, 200)
  })

  it('preserves mutation order and stops after a failed item', async () => {
    const store = database()
    await queueTopicCreate(store, 'First', me)
    await queueTopicCreate(store, 'Second', me)
    const createTopic = vi.fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockImplementation(async (input: Pick<Topic, 'id' | 'title'>) => topic(input.id, 2))
    const client = mockClient({ createTopic })
    const engine = new SyncEngine(store, client)

    await engine.run()
    expect(createTopic).toHaveBeenCalledTimes(1)
    expect(await store.outbox.count()).toBe(2)
    expect((await store.topics.toArray())[0]?._status).toBe('failed')

    await engine.run()
    expect(createTopic).toHaveBeenCalledTimes(3)
    expect(await store.outbox.count()).toBe(0)
  })

  it('replaces an optimistic message with the server-confirmed entity', async () => {
    const store = database()
    const local = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000020', 'Remember this', null, me)
    const confirmed: Message = { ...local, sync_version: 9, _status: undefined, created_at: '2026-01-02T00:00:00Z' }
    const client = mockClient({ createMessage: vi.fn(async () => confirmed) })

    await new SyncEngine(store, client).run()

    expect(await store.messages.get(local.id)).toEqual(confirmed)
    expect(await store.outbox.count()).toBe(0)
  })

  it('does not repeatedly send a permanently rejected mutation', async () => {
    const store = database()
    await queueTopicCreate(store, 'Rejected', me)
    const createTopic = vi.fn().mockRejectedValue(new ApiError('Not allowed.', 403, 'forbidden'))
    const engine = new SyncEngine(store, mockClient({ createTopic }))

    await engine.run()
    await engine.run()

    expect(createTopic).toHaveBeenCalledTimes(1)
    expect((await store.outbox.toArray())[0]?.blocked).toBe(true)
    expect((await store.topics.toArray())[0]?._error).toBe('Not allowed.')
  })

  it('stores a server-synced soft deletion without retaining its body', async () => {
    const store = database()
    const deleted: Message = {
      id: '00000000-0000-4000-8000-000000000030',
      topic_id: '00000000-0000-4000-8000-000000000020',
      author_id: me.user_id,
      author_display_name: me.display_name,
      body: null,
      reply_to_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      edited_at: null,
      deleted_at: '2026-01-02T00:00:00Z',
      sync_version: 3
    }
    const page: SyncPage = { changes: [{ kind: 'message', data: deleted }], next_version: 3, has_more: false }
    const client = mockClient({ sync: vi.fn(async () => page) })

    await new SyncEngine(store, client).run()

    expect((await store.messages.get(deleted.id))?.body).toBeNull()
  })
})
