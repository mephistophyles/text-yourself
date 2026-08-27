import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Me, Message, Topic } from '../data/types'
import { Conversation } from './Conversation'

const me: Me = { user_id: 'user@example.com', display_name: 'Avery', role: 'editor' }
const topic: Topic = {
  id: '00000000-0000-4000-8000-000000000010', created_by: me.user_id, title: 'Garden notes', archived_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', sync_version: 1
}
const message: Message = {
  id: '00000000-0000-4000-8000-000000000020', topic_id: topic.id, author_id: 'other@example.com', author_display_name: 'Morgan',
  body: 'Try the north corner', reply_to_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  edited_at: null, deleted_at: null, sync_version: 2
}

function renderConversation(onSend = vi.fn(async () => undefined)) {
  render(<Conversation topic={topic} messages={[message]} me={me} jumpMessageId={null} onJumpHandled={vi.fn()} onBack={vi.fn()}
    onRename={vi.fn()} onArchive={vi.fn()} onSend={onSend} onEdit={vi.fn()} onDelete={vi.fn()} />)
  return onSend
}

describe('Conversation', () => {
  it('sends a one-level quoted reply', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    expect(screen.getByText(/Replying to/)).toHaveTextContent('Morgan')
    await user.type(screen.getByLabelText('Write a message'), 'That should work')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('That should work', message.id)
  })

  it('keeps author identity explicit', () => {
    renderConversation()
    expect(screen.getByText('Morgan')).toBeInTheDocument()
    expect(screen.getByText('Try the north corner')).toBeInTheDocument()
  })
})
