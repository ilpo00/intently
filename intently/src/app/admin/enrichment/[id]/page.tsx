// ─────────────────────────────────────────────────────────────────
// Intently · /admin/enrichment/[id] — Vector inspector
//
// Bookmarkable per-product deep view:
//   - product metadata (the PIM record we embedded)
//   - the exact `embedText` we fed the model
//   - the first 16 dimensions of the embedding (preview)
//   - distribution histogram across 16 buckets (so users can *see*
//     that real embeddings aren't uniform)
//   - cosine similarity to every other embedded product, ranked
//
// This is the "focus on hard how the vector database works" surface
// — the bit usually hidden behind an API.
//
// Auth gate runs in the parent layout.
// ─────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { cosine, getVectorStore } from '@/lib/enrichment'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vector — Intently admin' }

const PREVIEW_DIMS = 16
const HISTOGRAM_BUCKETS = 16

function bucket(v: number[]): number[] {
  const buckets = new Array(HISTOGRAM_BUCKETS).fill(0)
  // Normalised embeddings live roughly in [-0.3, 0.3] for 384-dim.
  // Stretch to [-1, 1] safely with clamp.
  for (const x of v) {
    const t = Math.max(-1, Math.min(1, x))
    const idx = Math.min(
      HISTOGRAM_BUCKETS - 1,
      Math.floor(((t + 1) / 2) * HISTOGRAM_BUCKETS),
    )
    buckets[idx] += 1
  }
  return buckets
}

export default async function InspectorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const store = getVectorStore()
  const record = await store.get(id)
  if (!record) notFound()
  const all = await store.list()

  const neighbours = all
    .filter((r) => r.id !== id)
    .map((r) => ({
      id: r.id,
      title: r.metadata.title,
      imageUrl: r.metadata.imageUrl,
      score: cosine(record.embedding, r.embedding),
    }))
    .sort((a, b) => b.score - a.score)

  const preview = record.embedding.slice(0, PREVIEW_DIMS)
  const buckets = bucket(record.embedding)
  const maxBucket = Math.max(1, ...buckets)

  const min = record.embedding.reduce((a, b) => Math.min(a, b), Infinity)
  const max = record.embedding.reduce((a, b) => Math.max(a, b), -Infinity)
  const mean =
    record.embedding.reduce((a, b) => a + b, 0) / record.embedding.length

  return (
    <div className="max-w-6xl">
      <Link
        href="/admin/enrichment/studio"
        className="text-xs text-intently-pebble hover:text-intently-ink font-sans underline underline-offset-4"
      >
        ← Studio
      </Link>

      <header className="mt-6 mb-10 flex items-start gap-6">
        {record.metadata.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={record.metadata.imageUrl}
            alt=""
            className="w-24 h-24 object-cover rounded bg-intently-paper"
          />
        ) : null}
        <div>
          <h1 className="font-sans text-2xl font-light text-intently-ink mb-1">
            {record.metadata.title}
          </h1>
          <p className="text-intently-pebble text-sm">
            <span className="font-mono">{record.id}</span> ·{' '}
            {record.metadata.category}
            {record.metadata.subcategory
              ? ` > ${record.metadata.subcategory}`
              : ''}
            {record.metadata.color ? ` · ${record.metadata.color}` : ''}
          </p>
          <p className="text-xs text-intently-pebble mt-1 font-mono">
            embedded {new Date(record.embeddedAt).toLocaleString()} ·{' '}
            {record.model} · dim {record.dimension}
          </p>
        </div>
      </header>

      <section className="mb-12">
        <h2 className="text-sm tracking-[0.2em] text-intently-pebble uppercase mb-3">
          Embed text
        </h2>
        <pre className="bg-intently-paper text-intently-ink text-sm font-mono p-4 rounded whitespace-pre-wrap leading-relaxed">
          {record.embedText}
        </pre>
        <p className="text-xs text-intently-pebble mt-2">
          This is the exact string fed to the model. Tweak{' '}
          <code className="font-mono">src/lib/enrichment/enrich-text.ts</code>{' '}
          and re-embed to see how rankings shift.
        </p>
      </section>

      <section className="mb-12 grid sm:grid-cols-2 gap-10">
        <div>
          <h2 className="text-sm tracking-[0.2em] text-intently-pebble uppercase mb-3">
            Vector preview · first {PREVIEW_DIMS} of {record.dimension} dims
          </h2>
          <div className="font-mono text-xs text-intently-slate bg-intently-paper p-3 rounded">
            [{preview.map((n) => n.toFixed(4)).join(', ')}, …]
          </div>
          <dl className="text-xs text-intently-pebble font-mono mt-3 space-y-1">
            <div className="flex gap-3">
              <dt className="w-12">min</dt>
              <dd>{min.toFixed(4)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-12">max</dt>
              <dd>{max.toFixed(4)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-12">mean</dt>
              <dd>{mean.toFixed(4)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="text-sm tracking-[0.2em] text-intently-pebble uppercase mb-3">
            Distribution · {HISTOGRAM_BUCKETS} buckets across [-1, 1]
          </h2>
          <div className="flex items-end gap-1 h-32">
            {buckets.map((count, i) => (
              <div
                key={i}
                className="flex-1 bg-intently-moss rounded-t"
                style={{ height: `${(count / maxBucket) * 100}%` }}
                title={`bucket ${i}: ${count}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-intently-pebble font-mono mt-1">
            <span>-1</span>
            <span>0</span>
            <span>+1</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm tracking-[0.2em] text-intently-pebble uppercase mb-3">
          Neighbours · cosine similarity
        </h2>
        <p className="text-xs text-intently-pebble mb-4 max-w-2xl">
          Every other embedded product, ranked by how similar its vector is to
          this one. This is the same math (
          <code className="font-mono">a·b / (‖a‖·‖b‖)</code>) that the search
          endpoint runs against a query vector.
        </p>
        <div className="border border-intently-cloud rounded overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead className="bg-intently-paper">
              <tr className="text-left text-xs text-intently-pebble uppercase tracking-wider">
                <th className="px-3 py-2 w-14">img</th>
                <th className="px-3 py-2">product</th>
                <th className="px-3 py-2 w-40">cosine</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {neighbours.map((n) => (
                <tr key={n.id} className="border-t border-intently-cloud">
                  <td className="px-3 py-2">
                    {n.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={n.imageUrl}
                        alt=""
                        className="w-10 h-10 object-cover rounded bg-intently-paper"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-intently-paper" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-intently-ink">{n.title}</div>
                    <div className="text-xs text-intently-pebble font-mono">
                      {n.id}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-intently-paper rounded">
                        <div
                          className="h-1 bg-intently-moss rounded"
                          style={{
                            width: `${Math.max(0, Math.min(1, n.score)) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs text-intently-slate">
                        {(n.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/enrichment/${encodeURIComponent(n.id)}`}
                      className="text-xs text-intently-slate hover:text-intently-ink underline underline-offset-4"
                    >
                      open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
