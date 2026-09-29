// ─────────────────────────────────────────────────────────────────
// Studio layout — every Studio page shows the PIM → Discovery pipeline
// status at the top, so the enrichment path (and the next action) is
// visible wherever a PM is working. Auth ran in the parent /admin layout.
// ─────────────────────────────────────────────────────────────────

import PipelineStatus from './PipelineStatus'

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PipelineStatus />
      {children}
    </>
  )
}
