import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import './globals.css'
import { ClientShell } from '@/components/ui/ClientShell'

// Display font — editorial, warm, used for product names and headlines
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-display',
})

// UI font — screen-optimized neutral sans for all interface text.
// Swapped from DM Sans → Inter for finer letterforms at small sizes and
// a more restrained character. Cormorant stays for editorial display
// moments (product names, headlines).
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: "Intently — don't search it, discover it",
  description:
    'Describe your situation and get a curated few, each with the reason it fits. A discovery layer for how people actually shop — not another search box.',
  openGraph: {
    title: "Intently — don't search it, discover it",
    description:
      'Describe your situation and get a curated few, each with the reason it fits.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable}`}>
      <body className="bg-intently-cream text-intently-slate font-sans antialiased">
        {/* Persistent overlays — client components wrapped to keep layout as Server Component */}
        <ClientShell />
        {children}
      </body>
    </html>
  )
}
