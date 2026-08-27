import { threadColor } from '../lib/format'

export function ThreadMark({ id, label, small = false }: { id: string; label?: string; small?: boolean }) {
  return (
    <span
      className={`thread-mark${small ? ' thread-mark--small' : ''}`}
      style={{ '--thread-color': threadColor(id) } as React.CSSProperties}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <i /><i /><i />
    </span>
  )
}
