// ─────────────────────────────────────────────────────────────────
// Intently · POST /api/enrichment/search
//
// Semantic search. The discovery layer's entry point.
//
// Body:
//   {
//     query: string,
//     k?: number              (default 5)
//     minScore?: number       (drop results below this cosine score)
//     includeEmbedding?: boolean  (true → returns query + result vectors,
//                                  for the admin inspector)
//   }
//
// Response:
//   {
//     query, model,
//     queryEmbeddingPreview: number[]  (first 16 dims),
//     queryEmbeddingDim: number,
//     results: SearchResult[]
//   }
//
// Not admin-gated by design — search is the contract the discovery
// layer is meant to call. If/when this needs throttling we plug it
// in here.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { searchByText } from '@/lib/enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PREVIEW_DIMS = 16

interface SearchRequestBody {
  query?: string
  k?: number
  minScore?: number
  includeEmbedding?: boolean
}

export async function POST(req: Request) {
  let body: SearchRequestBody
  try {
    body = (await req.json()) as SearchRequestBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const query = body.query?.trim()
  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }
  const k = Math.max(1, Math.min(50, body.k ?? 5))

  try {
    const result = await searchByText(query, k, {
      minScore: body.minScore,
      includeEmbedding: !!body.includeEmbedding,
    })
    return NextResponse.json({
      query: result.query,
      model: result.model,
      queryEmbeddingDim: result.queryEmbedding.length,
      queryEmbeddingPreview: result.queryEmbedding.slice(0, PREVIEW_DIMS),
      ...(body.includeEmbedding
        ? { queryEmbedding: result.queryEmbedding }
        : {}),
      results: result.results,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}
