import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google'
import PwaRegister from './components/pwa-register'
import './globals.css'

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'Obras.com',
  description: 'Plataforma de gestão de obras, usuários e reconhecimento facial',
  manifest: '/manifest.webmanifest',
  applicationName: 'Obras.com',
  appleWebApp: {
    capable: true,
    title: 'Obras.com',
    statusBarStyle: 'black-translucent',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${plusJakarta.variable} ${spaceGrotesk.variable} font-[var(--font-body)]`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  )
}
