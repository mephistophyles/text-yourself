import Dexie, { type EntityTable } from 'dexie'
import type { Message, OutboxItem, Topic } from './types'

export interface MetaValue {
  key: string
  value: number | string
}

export class TextYourselfDatabase extends Dexie {
  topics!: EntityTable<Topic, 'id'>
  messages!: EntityTable<Message, 'id'>
  outbox!: EntityTable<OutboxItem, 'sequence'>
  meta!: EntityTable<MetaValue, 'key'>

  constructor(name = 'text-yourself') {
    super(name)
    this.version(1).stores({
      topics: 'id, archived_at, updated_at',
      messages: 'id, topic_id, author_id, created_at, deleted_at',
      outbox: '++sequence, created_at',
      meta: 'key'
    })
  }
}

export const db = new TextYourselfDatabase()
