import type { TextYourselfDatabase } from './db'
import type { Me, Message, Topic } from './types'
import type { VoiceRecording } from '../hooks/useVoiceRecorder'
import { blobToArrayBuffer } from '../lib/audio'

const now = () => new Date().toISOString()

export async function queueTopicCreate(database: TextYourselfDatabase, title: string, me: Me): Promise<Topic> {
  const timestamp = now()
  const topic: Topic = {
    id: crypto.randomUUID(),
    title: title.trim(),
    created_by: me.user_id,
    creator_display_name: me.display_name,
    archived_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    sync_version: 0,
    _status: 'pending'
  }
  await database.transaction('rw', database.topics, database.outbox, async () => {
    await database.topics.add(topic)
    await database.outbox.add({ mutation: { type: 'create_topic', topic }, created_at: timestamp })
  })
  return topic
}

export async function queueTopicUpdate(
  database: TextYourselfDatabase,
  topic: Topic,
  changes: { title?: string; archived?: boolean }
): Promise<void> {
  const timestamp = now()
  const next: Topic = {
    ...topic,
    ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
    ...(changes.archived !== undefined ? { archived_at: changes.archived ? timestamp : null } : {}),
    updated_at: timestamp,
    _status: 'pending',
    _error: undefined
  }
  await database.transaction('rw', database.topics, database.outbox, async () => {
    await database.topics.put(next)
    await database.outbox.add({ mutation: { type: 'update_topic', topic_id: topic.id, changes }, created_at: timestamp })
  })
}

export async function queueMessageCreate(
  database: TextYourselfDatabase,
  topicId: string,
  body: string,
  replyToId: string | null,
  me: Me,
  voiceNote: VoiceRecording | null = null
): Promise<Message> {
  const timestamp = now()
  const audio = voiceNote ? await blobToArrayBuffer(voiceNote.blob) : null
  const message: Message & { body: string } = {
    id: crypto.randomUUID(),
    topic_id: topicId,
    author_id: me.user_id,
    author_display_name: me.display_name,
    body: body.trim(),
    reply_to_id: replyToId,
    created_at: timestamp,
    updated_at: timestamp,
    edited_at: null,
    deleted_at: null,
    sync_version: 0,
    has_voice_note: Boolean(voiceNote),
    _status: 'pending'
  }
  await database.transaction(
    'rw',
    database.messages,
    database.outbox,
    database.voiceNotes,
    async () => {
      await database.messages.add(message)
      // The recording is stored before the outbox entry, so a queued upload
      // can never reference audio that is not on disk yet.
      if (voiceNote && audio) {
        await database.voiceNotes.put({
          message_id: message.id,
          audio,
          mime_type: voiceNote.mimeType
        })
      }
      await database.outbox.add({ mutation: { type: 'create_message', message }, created_at: timestamp })
    }
  )
  return message
}

export async function queueMessageUpdate(database: TextYourselfDatabase, message: Message, body: string): Promise<void> {
  const timestamp = now()
  await database.transaction('rw', database.messages, database.outbox, async () => {
    await database.messages.put({
      ...message,
      body: body.trim(),
      updated_at: timestamp,
      edited_at: timestamp,
      _status: 'pending',
      _error: undefined
    })
    await database.outbox.add({
      mutation: { type: 'update_message', message_id: message.id, body: body.trim() },
      created_at: timestamp
    })
  })
}

export async function queueMessageDelete(database: TextYourselfDatabase, message: Message): Promise<void> {
  const timestamp = now()
  await database.transaction('rw', database.messages, database.outbox, async () => {
    await database.messages.put({ ...message, body: null, deleted_at: timestamp, updated_at: timestamp, _status: 'pending' })
    await database.outbox.add({ mutation: { type: 'delete_message', message_id: message.id }, created_at: timestamp })
  })
}
