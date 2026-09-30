// ─────────────────────────────────────────────────────────────────
// Intently · GET, DELETE /api/enrichment/vectors/[id]
//
// GET    — return one vector record plus its similarity to every
//          other vector in the store. This is the data behind the
//          admin "vector inspector" view.
// DELETE — remove from the vector store. PIM record is untouched.
// ─────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

import { assertAdminApi } from '@/lib/auth/admin-guard'
import { blockInPublicDemo } from '@/lib/public-demo-guard'
import { cosine, getVectorStore } from '@/lib/enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await assertAdminApi()
  if (deny) return deny
  const { id } = await params
  try {
    const store = getVectorStore()
    const record = await store.get(id)
    if (!record) return new NextResponse(null, { status: 404 })

    const all = await store.list()
    const neighbours = all
      .filter((r) => r.id !== id)
      .map((r) => ({
        id: r.id,
        title: r.metadata.title,
        score: cosine(record.embedding, r.embedding),
      }))
      .sort((a, b) => b.score - a.score)

    return NextResponse.json({
      record: {
        id: record.id,
        embedText: record.embedText,
        embeddedAt: record.embeddedAt,
        model: record.model,
        dimension: record.dimension,
        metadata: record.metadata,
        embeddingPreview: record.embedding.slice(0, 16),
        embedding: record.embedding,
      },
      neighbours,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await assertAdminApi()
  if (deny) return deny
  const blocked = blockInPublicDemo('Deleting a vector')
  if (blocked) return blocked
  const { id } = await params
  try {
    await getVectorStore().delete(id)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }
}
