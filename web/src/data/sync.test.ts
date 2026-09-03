import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from './api'
import { TextYourselfDatabase } from './db'
import { queueMessageCreate, queueTopicCreate } from './mutations'
import { SyncEngine } from './sync'
import type { Me, Message, SyncPage, Topic } from './types'
import type { VoiceRecording } from '../hooks/useVoiceRecorder'

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
    uploadVoiceNote: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    search: vi.fn(noSearch),
    ...overrides
  }
}

function serverMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    topic_id: '00000000-0000-4000-8000-000000000099',
    author_id: me.user_id,
    author_display_name: me.display_name,
    body: '',
    reply_to_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    deleted_at: null,
    sync_version: 5,
    has_voice_note: false,
    ...overrides
  }
}

function recording(): VoiceRecording {
  return { blob: new Blob(['opus-bytes'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 1200 }
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
      sync_version: 3,
      has_voice_note: false
    }
    const page: SyncPage = { changes: [{ kind: 'message', data: deleted }], next_version: 3, has_more: false }
    const client = mockClient({ sync: vi.fn(async () => page) })

    await new SyncEngine(store, client).run()

    expect((await store.messages.get(deleted.id))?.body).toBeNull()
  })

  it('uploads the audio after creating a message that carries a voice note', async () => {
    const store = database()
    const created = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000099', 'Listen', null, me, recording())
    const createMessage = vi.fn(async () => serverMessage(created.id, { body: 'Listen', has_voice_note: true }))
    const uploadVoiceNote = vi.fn(async () => serverMessage(created.id, { body: 'Listen', has_voice_note: true }))

    await new SyncEngine(store, mockClient({ createMessage, uploadVoiceNote })).run()

    expect(createMessage).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000099', {
      id: created.id,
      body: 'Listen',
      reply_to_id: null,
      has_voice_note: true
    })
    const [messageId, blob, mimeType] = uploadVoiceNote.mock.calls[0] as unknown as [string, Blob, string]
    expect(messageId).toBe(created.id)
    // The exact bytes recorded must be the bytes uploaded.
    expect(blob.size).toBe('opus-bytes'.length)
    expect(mimeType).toBe('audio/webm')
    expect(await store.outbox.count()).toBe(0)
  })

  it('never uploads audio for a message that has none', async () => {
    const store = database()
    const created = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000099', 'Just text', null, me)
    const uploadVoiceNote = vi.fn()

    await new SyncEngine(store, mockClient({
      createMessage: vi.fn(async () => serverMessage(created.id, { body: 'Just text' })),
      uploadVoiceNote
    })).run()

    expect(uploadVoiceNote).not.toHaveBeenCalled()
  })

  it('keeps the outbox item when only the audio upload fails, then completes on retry', async () => {
    const store = database()
    const created = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000099', '', null, me, recording())
    const createMessage = vi.fn(async () => serverMessage(created.id, { has_voice_note: true }))
    const uploadVoiceNote = vi
      .fn<ApiClient['uploadVoiceNote']>()
      .mockRejectedValueOnce(new Error('Network down.'))
      .mockResolvedValueOnce(serverMessage(created.id, { has_voice_note: true }))
    const client = mockClient({ createMessage, uploadVoiceNote })

    await new SyncEngine(store, client).run()

    // The message is on the server but its audio is not, so the work is not done.
    expect(await store.outbox.count()).toBe(1)
    expect((await store.messages.get(created.id))?._status).toBe('failed')

    await new SyncEngine(store, client).run()

    expect(createMessage).toHaveBeenCalledTimes(2)
    expect(uploadVoiceNote).toHaveBeenCalledTimes(2)
    expect(await store.outbox.count()).toBe(0)
  })

  it('gives up on the upload when the local recording is gone rather than blocking the queue', async () => {
    const store = database()
    const created = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000099', 'Listen', null, me, recording())
    await store.voiceNotes.delete(created.id)
    const uploadVoiceNote = vi.fn()

    await new SyncEngine(store, mockClient({
      createMessage: vi.fn(async () => serverMessage(created.id, { body: 'Listen', has_voice_note: true })),
      uploadVoiceNote
    })).run()

    expect(uploadVoiceNote).not.toHaveBeenCalled()
    expect(await store.outbox.count()).toBe(0)
  })

  it('keeps a pending recording when a sync pull replaces the message row', async () => {
    const store = database()
    const created = await queueMessageCreate(store, '00000000-0000-4000-8000-000000000099', 'Listen', null, me, recording())
    const page: SyncPage = {
      changes: [{ kind: 'message', data: serverMessage(created.id, { body: 'Listen', has_voice_note: true }) }],
      next_version: 5,
      has_more: false
    }

    await new SyncEngine(store, mockClient({
      sync: vi.fn(async () => page),
      createMessage: vi.fn(async () => serverMessage(created.id, { body: 'Listen', has_voice_note: true })),
      uploadVoiceNote: vi.fn(async () => serverMessage(created.id, { body: 'Listen', has_voice_note: true }))
    })).run()

    expect(await store.voiceNotes.get(created.id)).toBeDefined()
  })
})
