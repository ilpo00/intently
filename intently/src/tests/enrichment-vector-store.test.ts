// ─────────────────────────────────────────────
// Tests: src/lib/enrichment/vector-store-local.ts
//
// File-backed store. Tests use a fresh tmpdir per
// describe block so they're independent and the
// dev's real .enrichment/vectors.json is untouched.
// ─────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { LocalJsonVectorStore } from '@/lib/enrichment/vector-store-local'
import type { VectorRecord } from '@/types/enrichment'

function makeRecord(id: string, embedding: number[]): VectorRecord {
  return {
    id,
    embedding,
    embedText: `text-${id}`,
    embeddedAt: '2026-05-30T00:00:00.000Z',
    model: 'test-model',
    dimension: embedding.length,
    metadata: {
      id,
      title: `Product ${id}`,
      source: 'kaggle',
    },
  }
}

async function tmpStore(): Promise<{
  store: LocalJsonVectorStore
  dir: string
  file: string
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intently-vstore-'))
  const file = path.join(dir, 'vectors.json')
  return { store: new LocalJsonVectorStore(file), dir, file }
}

describe('LocalJsonVectorStore', () => {
  it('upserts and reads back', async () => {
    const { store } = await tmpStore()
    await store.upsert(makeRecord('a', [1, 0, 0]))
    const got = await store.get('a')
    expect(got).not.toBeNull()
    expect(got?.embedding).toEqual([1, 0, 0])
  })

  it('persists across instances', async () => {
    const { dir } = await tmpStore()
    const file = path.join(dir, 'vectors.json')
    const a = new LocalJsonVectorStore(file)
    await a.upsert(makeRecord('a', [1, 0, 0]))

    const b = new LocalJsonVectorStore(file)
    const got = await b.get('a')
    expect(got?.id).toBe('a')
  })

  it('upsertMany replaces existing by id', async () => {
    const { store } = await tmpStore()
    await store.upsert(makeRecord('a', [1, 0, 0]))
    await store.upsertMany([
      makeRecord('a', [0, 1, 0]),
      makeRecord('b', [0, 0, 1]),
    ])
    expect(await store.count()).toBe(2)
    expect((await store.get('a'))?.embedding).toEqual([0, 1, 0])
  })

  it('search returns top-k by cosine descending', async () => {
    const { store } = await tmpStore()
    await store.upsertMany([
      makeRecord('a', [1, 0, 0]),
      makeRecord('b', [0.9, 0.1, 0]),
      makeRecord('c', [0, 1, 0]),
      makeRecord('d', [0, 0, 1]),
    ])
    const results = await store.search([1, 0, 0], 3)
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    // Strictly descending.
    expect(results[0].score).toBeGreaterThan(results[1].score)
    expect(results[1].score).toBeGreaterThan(results[2].score)
  })

  it('search respects minScore', async () => {
    const { store } = await tmpStore()
    await store.upsertMany([
      makeRecord('a', [1, 0, 0]),
      makeRecord('b', [0, 1, 0]),
    ])
    const results = await store.search([1, 0, 0], 5, { minScore: 0.5 })
    expect(results.map((r) => r.id)).toEqual(['a'])
  })

  it('search applies filter predicate', async () => {
    const { store } = await tmpStore()
    await store.upsertMany([
      makeRecord('a', [1, 0, 0]),
      makeRecord('b', [0.9, 0.1, 0]),
    ])
    const results = await store.search([1, 0, 0], 5, {
      filter: (r) => r.id === 'b',
    })
    expect(results.map((r) => r.id)).toEqual(['b'])
  })

  it('search includes embedding when asked', async () => {
    const { store } = await tmpStore()
    await store.upsert(makeRecord('a', [1, 0, 0]))
    const [res] = await store.search([1, 0, 0], 1, { includeEmbedding: true })
    expect(res.embedding).toEqual([1, 0, 0])
  })

  it('delete removes the record', async () => {
    const { store } = await tmpStore()
    await store.upsert(makeRecord('a', [1, 0, 0]))
    await store.delete('a')
    expect(await store.get('a')).toBeNull()
    expect(await store.count()).toBe(0)
  })

  it('clear empties the store', async () => {
    const { store } = await tmpStore()
    await store.upsertMany([
      makeRecord('a', [1, 0, 0]),
      makeRecord('b', [0, 1, 0]),
    ])
    await store.clear()
    expect(await store.count()).toBe(0)
  })

  it('list returns every record', async () => {
    const { store } = await tmpStore()
    await store.upsertMany([
      makeRecord('a', [1, 0, 0]),
      makeRecord('b', [0, 1, 0]),
    ])
    const all = await store.list()
    expect(all.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('starts empty when the file does not exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intently-vstore-empty-'))
    const store = new LocalJsonVectorStore(path.join(dir, 'vectors.json'))
    expect(await store.count()).toBe(0)
  })
})
