import { extractSafeLinks, linkify } from '../lib/format'
import { useState } from 'react'

export function MessageContent({ body, voice_note_base64 }: { body: string | null; voice_note_base64: string | null }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const voiceNoteUrl = voice_note_base64 ? `data:audio/webm;base64,${voice_note_base64}` : null

  const handlePlay = () => {
    setIsPlaying(prev => {
      if (prev) {
        setError(null)
        return false
      }
      return true
    })
  }

  return (
    <>
      <p className="message-body">{linkify(body)}</p>
      {links.length > 0 && <div className="link-list">
        {links.map((link) => (
          <a key={link.url} className="link-card" href={link.url} target="_blank" rel="noopener noreferrer">
            <span>{link.domain}</span><small>{link.url}</small>
          </a>
        ))}
      </div>}

      {voice_note_base64 && (
        <div className="voice-note">
          <button className="voice-note-button" aria-label={isPlaying ? 'Stop voice note' : 'Play voice note'} onClick={handlePlay} disabled={isPlaying}>
            {isPlaying ? 'Stop' : 'Listen'}
          </button>
          {isPlaying && voice_note_base64 && <audio src={voiceNoteUrl} controls />}
          {error && <p className="voice-note-error">Could not play voice note</p>}
        </div>
      )}
    </>
  )
}
