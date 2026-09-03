import Dexie, { type EntityTable } from 'dexie'
import type { LocalVoiceNote, Message, OutboxItem, Topic } from './types'

export interface MetaValue {
  key: string
  value: number | string
}

export class TextYourselfDatabase extends Dexie {
  topics!: EntityTable<Topic, 'id'>
  messages!: EntityTable<Message, 'id'>
  outbox!: EntityTable<OutboxItem, 'sequence'>
  meta!: EntityTable<MetaValue, 'key'>
  voiceNotes!: EntityTable<LocalVoiceNote, 'message_id'>

  constructor(name = 'text-yourself') {
    super(name)
    this.version(1).stores({
      topics: 'id, archived_at, updated_at',
      messages: 'id, topic_id, author_id, created_at, deleted_at',
      outbox: '++sequence, created_at',
      meta: 'key'
    })
    // Audio lives in its own table so a sync pull, which replaces whole
    // message rows, cannot wipe a recording that has not been uploaded yet.
    this.version(2).stores({ voiceNotes: 'message_id' })
  }
}

export const db = new TextYourselfDatabase()
