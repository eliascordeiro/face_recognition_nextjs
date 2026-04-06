/** @type {import('next').NextConfig} */
const nextConfig = {
  // face-api.js é usado apenas no browser via dynamic import ('use client')
  // Turbopack (padrão no Next.js 16) não precisa de config extra para isso
  turbopack: {},
}

export default nextConfig
