// ─────────────────────────────────────────────
// /next — preview of the new adaptive contextual-discovery UX.
//
// Lives alongside the existing river (untouched at /). Scripted data, no live
// AI. This is the artifact to click through in Preview and test the feel of
// the embeddable overlay: invitation → understood → explained shortlist →
// refine re-rank diff → add-to-cart → handoff.
// ─────────────────────────────────────────────

import type { Metadata } from 'next'
import './theme.css'
import { NextExperience } from './NextExperience'

export const metadata: Metadata = {
  title: 'Intently — new UX preview',
  description: 'Describe your situation, be understood, see a curated few with reasons.',
}

export default function NextPreviewPage() {
  return <NextExperience />
}
