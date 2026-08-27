import { useCallback, useEffect, useMemo, useState } from 'react'
import { Conversation } from './components/Conversation'
import { SearchPanel } from './components/SearchPanel'
import { TopicRail } from './components/TopicRail'
import { api } from './data/api'
import { db } from './data/db'
import { queueMessageCreate, queueMessageDelete, queueMessageUpdate, queueTopicCreate, queueTopicUpdate } from './data/mutations'
import { SyncEngine } from './data/sync'
import type { Me, Message, Topic } from './data/types'
import { useLiveData } from './hooks/useLiveData'

const CACHED_ME_KEY = 'text-yourself.identity'

function readCachedMe(): Me | null {
  try {
    const value = localStorage.getItem(CACHED_ME_KEY)
    return value ? JSON.parse(value) as Me : null
  } catch {
    return null
  }
}

export default function App() {
  const [me, setMe] = useState<Me | null>(readCachedMe)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'topics' | 'conversation'>('topics')
  const [archivedVisible, setArchivedVisible] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [announcement, setAnnouncement] = useState('Local copy ready.')
  const engine = useMemo(() => new SyncEngine(db, api), [])
  const allTopics = useLiveData(() => db.topics.orderBy('updated_at').reverse().toArray(), [], [])
  const messages = useLiveData(
    () => activeTopicId ? db.messages.where('topic_id').equals(activeTopicId).sortBy('created_at') : Promise.resolve([]),
    [activeTopicId],
    []
  )
  const outboxCount = useLiveData(() => db.outbox.count(), [], 0)
  const activeTopic = allTopics.find((topic) => topic.id === activeTopicId) ?? null
  const visibleTopics = allTopics.filter((topic) => archivedVisible ? Boolean(topic.archived_at) : !topic.archived_at)

  const syncNow = useCallback(async (quiet = false) => {
    if (!navigator.onLine) {
      setOffline(true)
      if (!quiet) setAnnouncement('Offline. Changes are saved on this device and will sync when connected.')
      return
    }
    setSyncing(true)
    try {
      const result = await engine.run()
      setOffline(false)
      if (!quiet) setAnnouncement(result.pending ? `${result.pending} change${result.pending === 1 ? '' : 's'} still waiting to sync.` : 'Everything is synced.')
    } catch {
      setOffline(true)
      if (!quiet) setAnnouncement('The server could not be reached. Your local copy is still available.')
    } finally {
      setSyncing(false)
    }
  }, [engine])

  useEffect(() => {
    let cancelled = false
    api.me().then((identity) => {
      if (cancelled) return
      setMe(identity)
      localStorage.setItem(CACHED_ME_KEY, JSON.stringify(identity))
    }).catch(() => {
      // The cached server-confirmed identity, if present, keeps offline writes attributable.
    })
    void syncNow(true)
    return () => { cancelled = true }
  }, [syncNow])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow(true)
    }, 5_000)
    const cameOnline = () => { setOffline(false); void syncNow(false) }
    const wentOffline = () => setOffline(true)
    window.addEventListener('online', cameOnline)
    window.addEventListener('offline', wentOffline)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', cameOnline)
      window.removeEventListener('offline', wentOffline)
    }
  }, [syncNow])

  function selectTopic(topic: Topic) {
    setActiveTopicId(topic.id)
    setMobilePane('conversation')
  }

  async function afterMutation(message: string) {
    setAnnouncement(message)
    if (navigator.onLine) await syncNow(true)
  }

  return (
    <div className="app-shell" data-mobile-pane={mobilePane}>
      <TopicRail
        topics={visibleTopics}
        activeId={activeTopicId}
        archivedVisible={archivedVisible}
        syncing={syncing}
        offline={offline}
        canEdit={me?.role === 'editor'}
        onSelect={selectTopic}
        onCreate={async (title) => {
          if (!me) return
          const topic = await queueTopicCreate(db, title, me)
          selectTopic(topic)
          await afterMutation('Topic saved locally.')
        }}
        onToggleArchived={() => { setArchivedVisible((visible) => !visible); setActiveTopicId(null); setMobilePane('topics') }}
        onSearch={() => setSearchOpen(true)}
        onSync={() => void syncNow(false)}
      />
      <Conversation
        topic={activeTopic}
        messages={messages}
        me={me}
        jumpMessageId={jumpMessageId}
        onJumpHandled={() => setJumpMessageId(null)}
        onBack={() => setMobilePane('topics')}
        onRename={async (title) => {
          if (!activeTopic) return
          await queueTopicUpdate(db, activeTopic, { title })
          await afterMutation('Topic renamed locally.')
        }}
        onArchive={async () => {
          if (!activeTopic) return
          await queueTopicUpdate(db, activeTopic, { archived: true })
          setActiveTopicId(null)
          setMobilePane('topics')
          await afterMutation('Topic archived.')
        }}
        onSend={async (body, replyToId) => {
          if (!activeTopic || !me) return
          await queueMessageCreate(db, activeTopic.id, body, replyToId, me)
          await afterMutation('Message saved locally.')
        }}
        onEdit={async (message, body) => {
          await queueMessageUpdate(db, message, body)
          await afterMutation('Changes saved locally.')
        }}
        onDelete={async (message) => {
          await queueMessageDelete(db, message)
          await afterMutation('Message deleted locally.')
        }}
      />
      {searchOpen && <SearchPanel topics={allTopics} onClose={() => setSearchOpen(false)} onJump={(topicId, messageId) => {
        const topic = allTopics.find((candidate) => candidate.id === topicId)
        if (topic) {
          setArchivedVisible(Boolean(topic.archived_at))
          selectTopic(topic)
          setJumpMessageId(messageId ?? null)
        }
        setSearchOpen(false)
      }} />}
      <div className="sr-only" role="status" aria-live="polite">{announcement}{outboxCount > 0 ? ` ${outboxCount} queued.` : ''}</div>
    </div>
  )
}
