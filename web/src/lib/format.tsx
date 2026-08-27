import type { ReactNode } from 'react'

const URL_PATTERN = /https?:\/\/[^\s<>]+/gi
const TRAILING_PUNCTUATION = /[),.!?;:]+$/

export interface SafeLink {
  url: string
  domain: string
}

export function extractSafeLinks(body: string | null): SafeLink[] {
  if (body === null) return []
  return [...body.matchAll(URL_PATTERN)].flatMap((match) => {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return []
      return [{ url: parsed.href, domain: parsed.hostname.replace(/^www\./, '') }]
    } catch {
      return []
    }
  })
}

export function linkify(body: string | null): ReactNode[] {
  if (body === null) return []
  const output: ReactNode[] = []
  let cursor = 0
  for (const match of body.matchAll(URL_PATTERN)) {
    if (match.index === undefined) continue
    const raw = match[0]
    const url = raw.replace(TRAILING_PUNCTUATION, '')
    const trailing = raw.slice(url.length)
    let valid = false
    try {
      const parsed = new URL(url)
      valid = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      valid = false
    }
    output.push(body.slice(cursor, match.index))
    output.push(
      valid ? (
        <a key={`${match.index}-${url}`} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      ) : (
        raw
      )
    )
    if (valid) output.push(trailing)
    cursor = match.index + raw.length
  }
  output.push(body.slice(cursor))
  return output
}

export function formatTimestamp(value: string): string {
  const date = new Date(value)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

export function threadColor(id: string): string {
  const colors = ['#176B73', '#E8795A', '#486581', '#8B6F47', '#6E5A8A', '#3E7C59']
  let hash = 0
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]!
}
