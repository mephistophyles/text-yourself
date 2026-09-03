import { extractSafeLinks, linkify } from '../lib/format'

export function MessageContent({ body }: { body: string | null }) {
  const links = extractSafeLinks(body)
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
    </>
  )
}
