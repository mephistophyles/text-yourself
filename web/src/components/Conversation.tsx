import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Me, Message, Topic } from '../data/types'
import { formatTimestamp } from '../lib/format'
import { BackIcon, CloseIcon, MoreIcon, ReplyIcon, SendIcon } from './Icons'
import { MessageContent } from './MessageContent'
import { ThreadMark } from './ThreadMark'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'

interface Props {
  topic: Topic | null
  messages: Message[]
  me: Me | null
  jumpMessageId: string | null
  onJumpHandled(): void
  onBack(): void
  onRename(title: string): Promise<void>
  onArchive(): Promise<void>
  onSend(body: string, replyToId: string | null, voiceNoteBase64: string | null): Promise<void>
  onEdit(message: Message, body: string): Promise<void>
  onDelete(message: Message): Promise<void>
}

interface VoiceNoteState {
  isRecording: boolean
  recordedBase64: string | null
}

export function Conversation(props: Props) {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<Message | null>(null)
  const [editBody, setEditBody] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const byId = useMemo(() => new Map(props.messages.map((message) => [message.id, message])), [props.messages])
  const canEdit = props.me?.role === 'editor'
  const [voiceNoteState, setVoiceNoteState] = useState<VoiceNoteState>({ isRecording: false, recordedBase64: null })
  const [voiceRecorder, setVoiceRecorder] = useVoiceRecorder()

  const handleRecord = async () => {
    if (voiceNoteState.isRecording) {
      const base64 = await voiceRecorder.stop()
      setVoiceNoteState({ isRecording: false, recordedBase64: base64 })
    } else {
      await voiceRecorder.start()
      setVoiceNoteState({ isRecording: true, recordedBase64: null })
    }
  }

  const handleSendWithVoiceNote = async (body: string, replyToId: string | null, voiceNoteBase64: string | null) => {
    await props.onSend(body, replyToId, voiceNoteBase64)
    setBody('')
    setVoiceNoteState({ isRecording: false, recordedBase64: null })
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }))
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() && !voiceNoteState.recordedBase64) return
    await handleSendWithVoiceNote(body, replyingTo?.id ?? null, voiceNoteState.recordedBase64)
  }

  if (!props.topic) {
    return <main className="conversation conversation--empty">
      <div className="empty-conversation"><ThreadMark id="welcome" /><p className="eyebrow">Your shared margin</p><h2>Choose a topic</h2><p>Keep links, half-formed plans, and the things worth finding again.</p></div>
    </main>
  }

  return (
    <main className="conversation">
      <header className="conversation-header">
        <button className="icon-button mobile-back" onClick={props.onBack} aria-label="Back to topics"><BackIcon /></button>
        <ThreadMark id={props.topic.id} />
        <div className="conversation-title">
          {renaming ? <form onSubmit={async (event) => { event.preventDefault(); if (title.trim()) await props.onRename(title); setRenaming(false) }}>
            <label className="sr-only" htmlFor="rename-topic">Topic title</label>
            <input id="rename-topic" autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
          </form> : <><h2>{props.topic.title}</h2><small>{props.messages.length} {props.messages.length === 1 ? 'note' : 'notes'}</small></>}
        </div>
        {canEdit && <div className="topic-menu">
          <button className="icon-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Topic actions" aria-expanded={menuOpen}><MoreIcon /></button>
          {menuOpen && <div className="menu-popover">
            <button onClick={() => { setRenaming(true); setMenuOpen(false) }}>Rename topic</button>
            <button onClick={() => void props.onArchive()}>Archive topic</button>
          </div>}
        </div>}
      </header>

      <section className="message-stream" aria-label={`Messages in ${props.topic.title}`}>
        {props.messages.length === 0 ? <div className="empty-thread"><p>No notes here yet.</p><span>Write the first one below.</span></div> : props.messages.map((message) => {
          const own = message.author_id === props.me?.user_id
          const replied = message.reply_to_id ? byId.get(message.reply_to_id) : undefined
          const deleted = Boolean(message.deleted_at) || message.body === null
          return <article
            id={`message-${message.id}`}
            tabIndex={-1}
            key={message.id}
            className={`message ${own ? 'message--own' : ''} ${message._status ? `message--${message._status}` : ''}`}
          >
            <div className="message-meta"><strong>{message.author_display_name}</strong><time dateTime={message.created_at}>{formatTimestamp(message.created_at)}</time></div>
            <div className="message-card">
              {replied && <button className="quoted-reply" onClick={() => document.getElementById(`message-${replied.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
                <ThreadMark id={message.topic_id} small /><span><strong>{replied.author_display_name}</strong>{replied.deleted_at || replied.body === null ? 'Deleted message' : replied.body.slice(0, 120)}</span>
              </button>}
              {editing?.id === message.id ? <form className="edit-form" onSubmit={async (event) => { event.preventDefault(); if (editBody.trim()) await props.onEdit(message, editBody); setEditing(null) }}>
                <label className="sr-only" htmlFor={`edit-${message.id}`}>Edit message</label>
                <textarea id={`edit-${message.id}`} autoFocus value={editBody} maxLength={10000} onChange={(event) => setEditBody(event.target.value)} />
                <div><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" type="submit">Save changes</button></div>
              </form> : deleted ? <p className="deleted-message">Message deleted</p> : <MessageContent body={message.body} voice_note_base64={message.voice_note_base64} />}
            </div>
            <div className="message-footer">
              {message.edited_at && !deleted && <span>Edited</span>}
              {message._status && <span className={`delivery-state delivery-state--${message._status}`}>{message._status === 'pending' ? 'Waiting to sync' : `Couldn't sync${message._error ? `: ${message._error}` : ''}`}</span>
              {canEdit && !deleted && <span className="message-actions">
                <button onClick={() => { setReplyingTo(message); composerRef.current?.focus() }}><ReplyIcon /> Reply</button>
                {own && <><button onClick={() => { setEditing(message); setEditBody(message.body ?? '') }}>Edit</button><button onClick={() => { if (window.confirm('Delete this message? It will remain recoverable in the database.')) void props.onDelete(message) }}>Delete</button></>}
                {canEdit && (
                  <button onClick={handleRecord} className="voice-note-button" aria-label={voiceNoteState.isRecording ? 'Stop recording' : 'Record a voice note'}><svg viewBox="0 0 24 24" width={16} height={16} fill={voiceNoteState.isRecording ? 'red' : 'currentColor'}/><path d="M3 3v2h2l8.59 8.59L17 18l2-2 5.41 5.41L20 7l-5-5-1.41 1.41L7 15l-5-1z"/></svg>{voiceNoteState.isRecording ? ' Recording' : ' Voice Note'}</button>
                )}
              </span>}
            </div>
          </article>
        })}
        <div ref={endRef} />
      </section>

      {canEdit ? <form className="composer" onSubmit={send}>
        {replyingTo && <div className="reply-banner"><ReplyIcon /><span>Replying to <strong>{replyingTo.author_display_name}</strong>: {replyingTo.body?.slice(0, 90) ?? 'Deleted message'}</span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><CloseIcon /></button></div>}
        <label className="sr-only" htmlFor="message-body">Write a message</label>
        <textarea ref={composerRef} id="message-body" rows={1} maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Leave a note…" onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
        }} />
        <div className="composer-actions">
          <button className="send-button" type="submit" disabled={!body.trim() && !voiceNoteState.recordedBase64} aria-label="Send message"><SendIcon /></button>
          {canEdit && (
            <button onClick={handleRecord} className="voice-note-record-button" aria-label={voiceNoteState.isRecording ? 'Stop recording' : 'Record a voice note'}><svg viewBox="0 0 24 24" width={16} height={16} fill={voiceNoteState.isRecording ? 'red' : 'currentColor'}/><path d="M3 3v2h2l8.59 8.59L17 18l2-2 5.41 5.41L20 7l-5-5-1.41 1.41L7 15l-5-1z"/></svg>{voiceNoteState.isRecording ? ' Recording' : ' Voice Note'}</button>
          )}
        </div>
      </form> : <div className="viewer-note">You have view-only access.</div>}
    </main>
  )
}