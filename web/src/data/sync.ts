import { ApiError, type ApiClient } from './api'
import type { TextYourselfDatabase } from './db'
import type { Message, Mutation, OutboxItem, Topic } from './types'

const SYNC_PAGE_SIZE = 200

export interface SyncSummary {
  sent: number
  received: number
  pending: number
}

export class SyncEngine {
  private running: Promise<SyncSummary> | null = null

  constructor(private readonly database: TextYourselfDatabase, private readonly client: ApiClient) {}

  run(): Promise<SyncSummary> {
    if (!this.running) {
      this.running = this.perform().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async perform(): Promise<SyncSummary> {
    const sent = await this.flushOutbox()
    const received = await this.pullPages()
    return { sent, received, pending: await this.database.outbox.count() }
  }

  private async flushOutbox(): Promise<number> {
    let sent = 0
    const queue = await this.database.outbox.orderBy('sequence').toArray()
    for (const item of queue) {
      if (item.blocked) break
      try {
        const confirmed = await this.send(item.mutation)
        await this.database.transaction(
          'rw',
          this.database.topics,
          this.database.messages,
          this.database.outbox,
          async () => {
            if ('topic_id' in confirmed || 'author_id' in confirmed) {
              await this.database.messages.put(confirmed as Message)
            } else {
              await this.database.topics.put(confirmed as Topic)
            }
            if (item.sequence !== undefined) await this.database.outbox.delete(item.sequence)
          }
        )
        sent += 1
      } catch (error) {
        const permanentlyBlocked = error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)
        await this.markFailed(item, error instanceof Error ? error.message : 'Sync failed.', permanentlyBlocked)
        break
      }
    }
    return sent
  }

  private send(mutation: Mutation): Promise<Topic | Message> {
    switch (mutation.type) {
      case 'create_topic':
        return this.client.createTopic({ id: mutation.topic.id, title: mutation.topic.title })
      case 'update_topic':
        return this.client.updateTopic(mutation.topic_id, mutation.changes)
      case 'create_message':
        return this.client.createMessage(mutation.message.topic_id, {
          id: mutation.message.id,
          body: mutation.message.body,
          reply_to_id: mutation.message.reply_to_id
        })
      case 'update_message':
        return this.client.updateMessage(mutation.message_id, mutation.body)
      case 'delete_message':
        return this.client.deleteMessage(mutation.message_id)
    }
  }

  private async markFailed(item: OutboxItem, message: string, blocked: boolean): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.topics,
      this.database.messages,
      this.database.outbox,
      async () => {
        if (item.sequence !== undefined) await this.database.outbox.update(item.sequence, { last_error: message, blocked })
        const mutation = item.mutation
        if (mutation.type === 'create_topic') await this.database.topics.update(mutation.topic.id, { _status: 'failed', _error: message })
        if (mutation.type === 'update_topic') await this.database.topics.update(mutation.topic_id, { _status: 'failed', _error: message })
        if (mutation.type === 'create_message') await this.database.messages.update(mutation.message.id, { _status: 'failed', _error: message })
        if (mutation.type === 'update_message' || mutation.type === 'delete_message') {
          await this.database.messages.update(mutation.message_id, { _status: 'failed', _error: message })
        }
      }
    )
  }

  private async pullPages(): Promise<number> {
    let version = Number((await this.database.meta.get('sync_version'))?.value ?? 0)
    let received = 0
    for (;;) {
      const page = await this.client.sync(version, SYNC_PAGE_SIZE)
      await this.database.transaction('rw', this.database.topics, this.database.messages, this.database.meta, async () => {
        const topics = page.changes.filter((change) => change.kind === 'topic').map((change) => change.data)
        const messages = page.changes.filter((change) => change.kind === 'message').map((change) => change.data)
        if (topics.length) await this.database.topics.bulkPut(topics as Topic[])
        if (messages.length) await this.database.messages.bulkPut(messages as Message[])
        await this.database.meta.put({ key: 'sync_version', value: page.next_version })
      })
      received += page.changes.length
      if (page.has_more && page.next_version <= version) {
        throw new Error('The sync cursor did not advance.')
      }
      version = page.next_version
      if (!page.has_more) return received
    }
  }
}
