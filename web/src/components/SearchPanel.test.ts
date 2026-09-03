import { describe, expect, it } from 'vitest'
import type { Message, Topic } from '../data/types'
import { buildLocalSearchHits } from './SearchPanel'

const topic: Topic = {
  id: '00000000-0000-4000-8000-000000000010',
  created_by: 'user@example.com',
  title: 'House notes',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  sync_version: 1
}

describe('offline search', () => {
  it('never exposes a server-synced deleted message with a null body', () => {
    const deleted: Message = {
      id: '00000000-0000-4000-8000-000000000020',
      topic_id: topic.id,
      author_id: 'user@example.com',
      author_display_name: 'Avery',
      body: null,
      reply_to_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      edited_at: null,
      deleted_at: '2026-01-02T00:00:00Z',
      sync_version: 2,
      has_voice_note: false
    }

    expect(buildLocalSearchHits([topic], [deleted], 'secret')).toEqual([])
  })
})
