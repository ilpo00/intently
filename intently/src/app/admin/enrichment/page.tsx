// /admin/enrichment → the Studio. The standalone "classic inspector" index was
// removed (the Studio is the merchandiser surface); the raw vector internals
// live per-product at /admin/enrichment/[id], linked from the Studio.
import { redirect } from 'next/navigation'

export default function EnrichmentIndex() {
  redirect('/admin/enrichment/studio')
}
