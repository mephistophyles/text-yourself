import { useState, type FormEvent } from 'react'
import type { Topic } from '../data/types'
import { formatTimestamp } from '../lib/format'
import { PlusIcon, SearchIcon, SyncIcon } from './Icons'
import { ThreadMark } from './ThreadMark'

interface Props {
  topics: Topic[]
  activeId: string | null
  archivedVisible: boolean
  syncing: boolean
  offline: boolean
  canEdit: boolean
  onSelect(topic: Topic): void
  onCreate(title: string): Promise<void>
  onToggleArchived(): void
  onSearch(): void
  onSync(): void
}

export function TopicRail(props: Props) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    await props.onCreate(title)
    setTitle('')
    setCreating(false)
  }

  return (
    <aside className="topic-rail" aria-label="Topics">
      <header className="brand-row">
        <div>
          <p className="eyebrow">Household notes</p>
          <h1>Text Yourself</h1>
        </div>
        <button className="icon-button" onClick={props.onSearch} aria-label="Search all topics"><SearchIcon /></button>
      </header>

      <div className="rail-actions">
        <button className="sync-button" onClick={props.onSync} disabled={props.syncing}>
          <SyncIcon className={props.syncing ? 'is-spinning' : ''} />
          {props.syncing ? 'Syncing' : 'Sync'}
        </button>
        <span className={`connection-state ${props.offline ? 'is-offline' : ''}`}>
          <i aria-hidden="true" />{props.offline ? 'Offline' : 'Up to date locally'}
        </span>
      </div>

      {props.canEdit && (creating ? (
        <form className="new-topic-form" onSubmit={submit}>
          <label htmlFor="topic-title">New topic</label>
          <input id="topic-title" autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Weekend plans" />
          <div><button type="button" className="text-button" onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="primary-button">Create</button></div>
        </form>
      ) : (
        <button className="new-topic-button" onClick={() => setCreating(true)}><PlusIcon /> Start a topic</button>
      ))}

      <nav className="topic-list" aria-label={props.archivedVisible ? 'Archived topics' : 'Current topics'}>
        {props.topics.length === 0 ? (
          <div className="empty-rail">
            <ThreadMark id="empty" />
            <p>{props.archivedVisible ? 'No archived topics.' : 'Start with something you want to remember together.'}</p>
          </div>
        ) : props.topics.map((topic) => (
          <button
            key={topic.id}
            className={`topic-row${props.activeId === topic.id ? ' is-active' : ''}`}
            onClick={() => props.onSelect(topic)}
            aria-current={props.activeId === topic.id ? 'page' : undefined}
          >
            <ThreadMark id={topic.id} />
            <span className="topic-row__copy">
              <strong>{topic.title}</strong>
              <small>{topic._status === 'failed' ? 'Couldn’t sync' : topic._status === 'pending' ? 'Waiting to sync' : formatTimestamp(topic.updated_at)}</small>
            </span>
          </button>
        ))}
      </nav>

      <button className="archive-toggle" onClick={props.onToggleArchived}>
        {props.archivedVisible ? 'Back to current topics' : 'View archived topics'}
      </button>
    </aside>
  )
}
