import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  basePath: process.env.BASEPATH,

  // The Admin SDK is Node-only infrastructure and must not enter browser or
  // Turbopack client bundles.
  serverExternalPackages: ['@keycloak/keycloak-admin-client'],

  // Keep build typechecking in-process through the installed compiler API.
  experimental: {
    useTypeScriptCli: false
  },
  turbopack: {
    root: process.cwd()
  },
  redirects: async () => {
    return [
      {
        source: '/',
        destination: '/home',
        permanent: true,
        locale: false
      }
    ]
  }
}

export default nextConfig
