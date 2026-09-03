import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me, Message, Topic } from '../data/types'
import { Conversation } from './Conversation'
import { installFakeMediaStack, RECORDED_CHUNK, type MediaStack } from '../test/fakeMediaRecorder'
import type { VoiceRecording } from '../hooks/useVoiceRecorder'

const me: Me = { user_id: 'user@example.com', display_name: 'Avery', role: 'editor' }
const topic: Topic = {
  id: '00000000-0000-4000-8000-000000000010', created_by: me.user_id, title: 'Garden notes', archived_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', sync_version: 1
}
const message: Message = {
  id: '00000000-0000-4000-8000-000000000020', topic_id: topic.id, author_id: 'other@example.com', author_display_name: 'Morgan',
  body: 'Try the north corner', reply_to_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  edited_at: null, deleted_at: null, sync_version: 2, has_voice_note: false
}

let media: MediaStack

beforeEach(() => {
  media = installFakeMediaStack()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type SendHandler = (body: string, replyToId: string | null, voiceNote: VoiceRecording | null) => Promise<void>

function renderConversation(onSend = vi.fn<SendHandler>(async () => undefined)) {
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
    expect(onSend).toHaveBeenCalledWith('That should work', message.id, null)
  })

  it('keeps author identity explicit', () => {
    renderConversation()
    expect(screen.getByText('Morgan')).toBeInTheDocument()
    expect(screen.getByText('Try the north corner')).toBeInTheDocument()
  })

  it('renders a server-synced null body only as a deletion placeholder', () => {
    const deleted = { ...message, body: null, deleted_at: '2026-01-02T00:00:00Z' }
    render(<Conversation topic={topic} messages={[deleted]} me={me} jumpMessageId={null} onJumpHandled={vi.fn()} onBack={vi.fn()}
      onRename={vi.fn()} onArchive={vi.fn()} onSend={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Message deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
  })

  it('sends a recorded voice note with the message', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()

    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))
    expect(await screen.findByText(/Recording/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText(/Voice note ready/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('', null, expect.objectContaining({ mimeType: 'audio/webm' }))
    expect(onSend.mock.calls[0]![2]!.blob.size).toBe(RECORDED_CHUNK.length)
  })

  it('sends without text, because a voice note can stand alone', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('does not submit the message when recording starts', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()

    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))

    expect(onSend).not.toHaveBeenCalled()
    expect(await screen.findByText(/Recording/)).toBeInTheDocument()
  })

  it('finishes a recording that is still running when send is pressed', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()

    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))
    await screen.findByText(/Recording/)
    await user.type(screen.getByLabelText('Write a message'), 'Listen to this')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onSend).toHaveBeenCalledWith(
      'Listen to this',
      null,
      expect.objectContaining({ mimeType: 'audio/webm' })
    )
  })

  it('discards a recording instead of sending it, and frees the microphone', async () => {
    const user = userEvent.setup()
    const onSend = renderConversation()

    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(screen.queryByText(/Voice note ready/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
  })

  it('hides recording entirely where the browser cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    renderConversation()
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).not.toBeInTheDocument()
  })

  it('surfaces a declined microphone to the person using it', async () => {
    const user = userEvent.setup()
    media.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    renderConversation()

    await user.click(screen.getByRole('button', { name: 'Record a voice note' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access was declined.')
  })
})
