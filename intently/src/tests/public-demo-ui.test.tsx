// ─────────────────────────────────────────────
// The shopper landing shows a dismissible visitor welcome ONLY in public-demo
// mode; a private or embedded deployment never renders it.
// ─────────────────────────────────────────────

import { render, screen, fireEvent } from '@testing-library/react'
import { NextExperience } from '@/app/next/NextExperience'

beforeEach(() => sessionStorage.clear())

describe('visitor welcome', () => {
  it('is absent in a private / embedded deployment', () => {
    render(<NextExperience />)
    expect(screen.queryByLabelText('About this demo')).toBeNull()
  })

  it('appears in public mode, links to the Studio, and stays dismissed', () => {
    const { unmount } = render(<NextExperience publicDemo />)
    const card = screen.getByLabelText('About this demo')
    expect(card).toHaveTextContent('Public demo')
    expect(card).toHaveTextContent(/prototype, so results may vary/)
    expect(card).toHaveTextContent(/logged anonymously/)
    expect(screen.getByRole('link', { name: /Open the Studio/ })).toHaveAttribute('href', '/admin/enrichment/studio')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByLabelText('About this demo')).toBeNull()

    unmount()
    render(<NextExperience publicDemo />)
    expect(screen.queryByLabelText('About this demo')).toBeNull()
  })
})
