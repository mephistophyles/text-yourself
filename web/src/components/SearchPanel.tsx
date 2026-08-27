import { useEffect, useMemo, useState } from 'react'
import { api } from '../data/api'
import { db } from '../data/db'
import type { SearchHit, Topic } from '../data/types'
import { useLiveData } from '../hooks/useLiveData'
import { formatTimestamp } from '../lib/format'
import { CloseIcon, SearchIcon } from './Icons'
import { ThreadMark } from './ThreadMark'

interface Props {
  topics: Topic[]
  onClose(): void
  onJump(topicId: string, messageId?: string): void
}

export function SearchPanel({ topics, onClose, onJump }: Props) {
  const [query, setQuery] = useState('')
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const messages = useLiveData(() => db.messages.toArray(), [], [])
  const normalized = query.trim().toLocaleLowerCase()

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    if (normalized.length < 2 || !navigator.onLine) {
      setRemoteHits([])
      return
    }
    const delay = window.setTimeout(() => {
      setSearching(true)
      api.search(normalized).then((page) => setRemoteHits(page.results)).catch(() => undefined).finally(() => setSearching(false))
    }, 250)
    return () => {
      window.clearTimeout(delay)
    }
  }, [normalized])

  const localHits = useMemo(() => {
    if (!normalized) return []
    const hits: SearchHit[] = []
    for (const topic of topics) {
      if (topic.title.toLocaleLowerCase().includes(normalized)) {
        hits.push({ kind: 'topic', topic_id: topic.id, topic_title: topic.title, excerpt: topic.title, created_at: topic.created_at })
      }
    }
    const topicById = new Map(topics.map((topic) => [topic.id, topic]))
    for (const message of messages) {
      if (message.deleted_at || !message.body.toLocaleLowerCase().includes(normalized)) continue
      const topic = topicById.get(message.topic_id)
      if (!topic) continue
      hits.push({
        kind: 'message',
        topic_id: topic.id,
        topic_title: topic.title,
        message_id: message.id,
        excerpt: message.body,
        created_at: message.created_at
      })
    }
    return hits.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100)
  }, [messages, normalized, topics])

  const hits = useMemo(() => {
    const keyed = new Map<string, SearchHit>()
    for (const hit of [...localHits, ...remoteHits]) keyed.set(`${hit.kind}:${hit.message_id ?? hit.topic_id}`, hit)
    return [...keyed.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [localHits, remoteHits])

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title">
        <header>
          <div><p className="eyebrow">Every thread</p><h2 id="search-title">Find a note</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close search"><CloseIcon /></button>
        </header>
        <label className="search-input">
          <SearchIcon />
          <span className="sr-only">Search topics and messages</span>
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try a place, plan, or link" />
        </label>
        <div className="search-results" aria-live="polite" aria-busy={searching}>
          {!normalized ? <p className="search-guidance">Search the full local copy—even while offline.</p> : hits.length === 0 ? (
            <p className="search-guidance">{searching ? 'Searching…' : 'No matching notes. Try a shorter phrase.'}</p>
          ) : hits.map((hit) => (
            <button key={`${hit.kind}-${hit.message_id ?? hit.topic_id}`} onClick={() => onJump(hit.topic_id, hit.message_id)}>
              <ThreadMark id={hit.topic_id} small />
              <span><strong>{hit.topic_title}</strong><small>{hit.excerpt}</small></span>
              <time dateTime={hit.created_at}>{formatTimestamp(hit.created_at)}</time>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
