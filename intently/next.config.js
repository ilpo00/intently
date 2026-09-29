// Embedded (plugin) mode serves Intently under a basePath (e.g. /discovery)
// inside a host storefront via Multi-Zones. Standalone leaves it unset.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  // Vision enrichment reads product photos off the filesystem with a path
  // built at runtime (public/<image>). Next's tracing only bundles statically
  // analysable requires, so without this the read succeeds locally and ENOENTs
  // on serverless — the worst kind of difference. Declaring the directory puts
  // the ~3MB webp bank in the function.
  outputFileTracingIncludes: {
    '/api/admin/vision-enrich': ['./public/catalog/**/*.webp'],
  },
  // Next 16: turbopack is the default dev bundler.
  // Production builds are unaffected by this config block.
}

module.exports = nextConfig
