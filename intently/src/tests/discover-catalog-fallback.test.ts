/**
 * @jest-environment node
 */
// ─────────────────────────────────────────────
// On the fashion-only vision catalogue (NEXT_PUBLIC_CATALOG=vision), a brief
// the client routes to 'outdoor' must be answered from the catalogue that
// exists — not dead-end on an empty set.
// ─────────────────────────────────────────────

const original = process.env.NEXT_PUBLIC_CATALOG
afterAll(() => { process.env.NEXT_PUBLIC_CATALOG = original })

function post(body: unknown): Request {
  return new Request('http://localhost/api/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'fallback-test' },
    body: JSON.stringify(body),
  })
}

interface Turn {
  results: unknown[]
  question?: { id: string; options: { id: string; label: string }[] }
  updatedSession: unknown
}

it('answers an outdoor-routed brief on the vision catalogue', async () => {
  process.env.NEXT_PUBLIC_CATALOG = 'vision'
  jest.resetModules()
  const { POST } = await import('@/app/api/discover/route')
  const { getProductsByCatalog } = await import('@/lib/data')
  expect(getProductsByCatalog('outdoor')).toHaveLength(0) // the premise

  // Play the consultation to a reveal: escape each blocking question.
  let session: unknown
  let body: { query: string; catalog: string; answer?: unknown } =
    { query: 'a warm jacket for an autumn hike', catalog: 'outdoor' }
  let data: Turn = { results: [], updatedSession: undefined }
  for (let i = 0; i < 4; i++) {
    data = await (await POST(post({ ...body, session }))).json()
    session = data.updatedSession
    if (data.results.length > 0 || !data.question) break
    const opt = data.question.options[data.question.options.length - 1]
    body = { query: opt.label, catalog: 'outdoor', answer: { questionId: data.question.id, optionId: opt.id } }
  }
  expect(data.results.length).toBeGreaterThan(0)
})
