import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageContent } from './MessageContent'

const MESSAGE_ID = '00000000-0000-4000-8000-000000000020'

describe('MessageContent', () => {
  it('renders HTTP links as safe external links and domain cards', () => {
    render(<MessageContent body="The details are at https://example.com/plans." messageId={MESSAGE_ID} hasVoiceNote={false} />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/plans')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('does not turn non-web schemes into links', () => {
    render(<MessageContent body="Do not open javascript:alert(1)" messageId={MESSAGE_ID} hasVoiceNote={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders no content or links for a deleted null body', () => {
    const { container } = render(<MessageContent body={null} messageId={MESSAGE_ID} hasVoiceNote={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('')
  })
})
