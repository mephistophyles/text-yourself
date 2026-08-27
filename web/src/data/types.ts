export type Role = 'editor' | 'viewer'
export type LocalStatus = 'pending' | 'failed'

export interface Me {
  user_id: string
  display_name: string
  role: Role
}

export interface Topic {
  id: string
  created_by: string
  creator_display_name?: string
  title: string
  archived_at: string | null
  created_at: string
  updated_at: string
  sync_version: number
  _status?: LocalStatus
  _error?: string
}

export interface Message {
  id: string
  topic_id: string
  author_id: string
  author_display_name: string
  body: string
  reply_to_id: string | null
  created_at: string
  updated_at: string
  edited_at: string | null
  deleted_at: string | null
  sync_version: number
  _status?: LocalStatus
  _error?: string
}

export type SyncChange =
  | { kind: 'topic'; data: Topic }
  | { kind: 'message'; data: Message }

export interface SyncPage {
  changes: SyncChange[]
  next_version: number
  has_more: boolean
}

export type Mutation =
  | { type: 'create_topic'; topic: Topic }
  | { type: 'update_topic'; topic_id: string; changes: { title?: string; archived?: boolean } }
  | { type: 'create_message'; message: Message }
  | { type: 'update_message'; message_id: string; body: string }
  | { type: 'delete_message'; message_id: string }

export interface OutboxItem {
  sequence?: number
  mutation: Mutation
  created_at: string
  last_error?: string
  blocked?: boolean
}

export interface SearchHit {
  kind: 'topic' | 'message'
  topic_id: string
  topic_title: string
  message_id?: string
  excerpt: string
  created_at: string
}

export interface SearchPage {
  results: SearchHit[]
  next_cursor: string | null
  has_more: boolean
}
