import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Obras.com',
    short_name: 'Obras',
    description: 'Portal mobile para gestão de obras, presença e solicitações da equipe.',
    start_url: '/employee',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#020617',
    theme_color: '#0f172a',
    lang: 'pt-BR',
    categories: ['productivity', 'business'],
    icons: [
      {
        src: '/favicon.ico',
        sizes: '64x64 32x32 24x24 16x16',
        type: 'image/x-icon',
      },
    ],
  }
}
