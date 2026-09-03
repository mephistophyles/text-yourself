import { useEffect, useState } from 'react'
import { db, type TextYourselfDatabase } from '../data/db'
import { toBlob } from '../lib/audio'

interface Props {
  messageId: string
  /** Defaults to the app database; tests supply their own instance. */
  database?: TextYourselfDatabase
}

/**
 * Plays a message's voice note.
 *
 * The audio is never carried on the sync channel, so it is resolved lazily:
 * from the local recording when this device made it (which also works
 * offline), otherwise streamed from the server on demand.
 */
export function VoiceNote({ messageId, database = db }: Props) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    const remote = `/api/messages/${messageId}/voice-note`
    setFailed(false)

    database.voiceNotes
      .get(messageId)
      .then((local) => {
        if (cancelled) return
        if (local) {
          objectUrl = URL.createObjectURL(toBlob(local.audio, local.mime_type))
          setSource(objectUrl)
        } else {
          setSource(remote)
        }
      })
      .catch(() => {
        if (!cancelled) setSource(remote)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [messageId, database])

  return (
    <div className="voice-note">
      {source && (
        <audio
          className="voice-note-player"
          controls
          preload="none"
          src={source}
          aria-label="Voice note"
          onError={() => setFailed(true)}
        />
      )}
      {failed && <p className="voice-note-error">This voice note has not finished syncing yet.</p>}
    </div>
  )
}
