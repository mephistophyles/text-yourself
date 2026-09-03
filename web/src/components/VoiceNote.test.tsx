import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextYourselfDatabase } from '../data/db'
import { VoiceNote } from './VoiceNote'

const MESSAGE_ID = '00000000-0000-4000-8000-000000000020'
const databases: TextYourselfDatabase[] = []

function database(): TextYourselfDatabase {
  const instance = new TextYourselfDatabase(`test-${crypto.randomUUID()}-${databases.length}`)
  databases.push(instance)
  return instance
}

// jsdom implements neither, and both are needed to play a local recording.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:local-recording')
  URL.revokeObjectURL = vi.fn()
})

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()))
})

describe('VoiceNote', () => {
  it('plays the local recording when this device made it, without touching the network', async () => {
    const store = database()
    await store.voiceNotes.put({
      message_id: MESSAGE_ID,
      audio: new TextEncoder().encode('opus-bytes').buffer as ArrayBuffer,
      mime_type: 'audio/webm'
    })

    render(<VoiceNote messageId={MESSAGE_ID} database={store} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Voice note')).toHaveAttribute('src', 'blob:local-recording')
    })
  })

  it('streams from the server when there is no local copy', async () => {
    const store = database()
    render(<VoiceNote messageId={MESSAGE_ID} database={store} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Voice note')).toHaveAttribute(
        'src',
        `/api/messages/${MESSAGE_ID}/voice-note`
      )
    })
    // Audio must never be preloaded for every message in a topic.
    expect(screen.getByLabelText('Voice note')).toHaveAttribute('preload', 'none')
  })

  it('explains an unplayable note rather than showing a broken player', async () => {
    const store = database()
    render(<VoiceNote messageId={MESSAGE_ID} database={store} />)

    const player = await screen.findByLabelText('Voice note')
    player.dispatchEvent(new Event('error'))

    expect(await screen.findByText(/has not finished syncing/)).toBeInTheDocument()
  })
})
