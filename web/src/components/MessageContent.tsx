import { extractSafeLinks, linkify } from '../lib/format'
import { VoiceNote } from './VoiceNote'

interface Props {
  body: string | null
  messageId: string
  hasVoiceNote: boolean
}

export function MessageContent({ body, messageId, hasVoiceNote }: Props) {
  const links = extractSafeLinks(body)
  return (
    <>
      {body && <p className="message-body">{linkify(body)}</p>}
      {hasVoiceNote && <VoiceNote messageId={messageId} />}
      {links.length > 0 && <div className="link-list">
        {links.map((link) => (
          <a key={link.url} className="link-card" href={link.url} target="_blank" rel="noopener noreferrer">
            <span>{link.domain}</span><small>{link.url}</small>
          </a>
        ))}
      </div>}
    </>
  )
}
