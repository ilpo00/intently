// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/embedder.ts
//
// We don't exercise the real Xenova pipeline in
// Jest — model weights aren't deterministic across
// versions and download-on-first-use is wrong for
// CI. The deterministic embedder is what's tested
// here; the Xenova impl is covered by the type
// system and manual smoke (admin "Sync from PIM").
// ─────────────────────────────────────────────

import { DeterministicEmbedder, OpenAIEmbedder } from '@/lib/enrichment/embedder'
import { norm } from '@/lib/enrichment/vector-math'

describe('DeterministicEmbedder', () => {
  const embedder = new DeterministicEmbedder()

  it('produces 384-dim vectors', async () => {
    const v = await embedder.embed('a blue shirt')
    expect(v.length).toBe(384)
  })

  it('produces unit-length vectors', async () => {
    const v = await embedder.embed('a blue shirt')
    expect(norm(v)).toBeCloseTo(1, 6)
  })

  it('is deterministic for identical input', async () => {
    const a = await embedder.embed('a blue shirt')
    const b = await embedder.embed('a blue shirt')
    expect(a).toEqual(b)
  })

  it('produces different vectors for materially different inputs', async () => {
    const a = await embedder.embed('a blue shirt')
    const b = await embedder.embed('a yellow handbag')
    expect(a).not.toEqual(b)
  })

  it('embedMany returns one vector per input', async () => {
    const result = await embedder.embedMany(['a', 'b', 'c'])
    expect(result.length).toBe(3)
    expect(result.every((v) => v.length === 384)).toBe(true)
  })

  it('embedMany matches single embed', async () => {
    const [a, b] = await embedder.embedMany(['hello', 'world'])
    const a2 = await embedder.embed('hello')
    const b2 = await embedder.embed('world')
    expect(a).toEqual(a2)
    expect(b).toEqual(b2)
  })

  it('exposes modelId and dimension', () => {
    expect(embedder.modelId).toBe('deterministic-hash-v1')
    expect(embedder.dimension).toBe(384)
  })
})

// OpenAIEmbedder is exercised against a mocked fetch — never the real
// API (no key in CI, no network in Jest). What we pin down: the request
// contract (dimensions:384), order-by-index defence, chunking, the
// missing-key error, and that upstream error bodies are never echoed.
describe('OpenAIEmbedder', () => {
  const realFetch = global.fetch
  const realKey = process.env.OPENAI_API_KEY

  const fakeVector = (seed: number) => {
    const v = new Array<number>(384).fill(0)
    v[seed % 384] = 1 // unit vector — normalise() is idempotent on it
    return v
  }

  const okResponse = (count: number, { shuffle = false } = {}) => {
    const data = Array.from({ length: count }, (_, i) => ({
      index: i,
      embedding: fakeVector(i),
    }))
    if (shuffle) data.reverse() // API order is by-index; we sort defensively
    return {
      ok: true,
      json: async () => ({ data }),
    } as Response
  }

  afterEach(() => {
    global.fetch = realFetch
    if (realKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = realKey
  })

  it('throws a clear error when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY
    const embedder = new OpenAIEmbedder()
    await expect(embedder.embed('a blue shirt')).rejects.toThrow(
      /OPENAI_API_KEY is not set/,
    )
  })

  it('requests dimensions:384 and returns unit vectors in input order', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const mock = jest.fn(async () => okResponse(2, { shuffle: true }))
    global.fetch = mock as unknown as typeof fetch
    const embedder = new OpenAIEmbedder()

    const [a, b] = await embedder.embedMany(['first', 'second'])
    const body = JSON.parse(
      (mock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    )
    expect(body.dimensions).toBe(384)
    expect(body.input).toEqual(['first', 'second'])
    // shuffled response, but output must follow input order (index 0 first)
    expect(a[0]).toBe(1)
    expect(b[1]).toBe(1)
    expect(norm(a)).toBeCloseTo(1, 6)
  })

  it('chunks large batches into multiple requests', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const mock = jest.fn(
      async (_url: string, init: { body: string }) =>
        okResponse((JSON.parse(init.body) as { input: string[] }).input.length),
    )
    global.fetch = mock as unknown as typeof fetch
    const embedder = new OpenAIEmbedder()

    const texts = Array.from({ length: 292 }, (_, i) => `product ${i}`)
    const out = await embedder.embedMany(texts)
    expect(out.length).toBe(292)
    expect(mock).toHaveBeenCalledTimes(3) // 128 + 128 + 36
  })

  it('rejects wrong-dimension responses', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    global.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
    })) as unknown as typeof fetch
    const embedder = new OpenAIEmbedder()
    await expect(embedder.embed('x')).rejects.toThrow(/expected 384 dims/)
  })

  it('reports HTTP failures by status only — never the response body', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    global.fetch = (async () => ({
      ok: false,
      status: 429,
      text: async () => 'body that echoes the user input — must not leak',
    })) as unknown as typeof fetch
    const embedder = new OpenAIEmbedder()
    await expect(embedder.embed('secret prompt')).rejects.toThrow(
      /HTTP 429/,
    )
    await expect(embedder.embed('secret prompt')).rejects.not.toThrow(
      /must not leak/,
    )
  })

  it('exposes a dimension-qualified modelId', () => {
    const embedder = new OpenAIEmbedder()
    expect(embedder.modelId).toBe('text-embedding-3-small@384')
    expect(embedder.dimension).toBe(384)
  })
})
