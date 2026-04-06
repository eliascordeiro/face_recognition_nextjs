'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) { router.replace('/login'); return }
      const user = await res.json()
      if (user.role === 'admin') router.replace('/admin')
      else if (user.role === 'client') router.replace('/client')
      else router.replace('/recognize')
    })
  }, [router])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-slate-400 animate-pulse">Redirecionando…</p>
    </div>
  )
}
