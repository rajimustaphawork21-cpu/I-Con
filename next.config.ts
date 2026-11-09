import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  basePath: process.env.BASEPATH,
  experimental: {
    // Enables `forbidden()` (HTTP 403 + app/forbidden.tsx) for server-side Client Role authorization.
    authInterrupts: true
  },
  redirects: async () => {
    return [
      {
        source: '/',
        destination: '/welcome',
        permanent: false,
        locale: false
      }
    ]
  }
}

export default nextConfig
