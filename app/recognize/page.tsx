'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import FaceRecognitionPanel from '@/components/FaceRecognitionPanel'

interface AuthUser {
  id: string
  username: string
  role: string
  fullName?: string
}

export default function RecognizePage() {
  const router = useRouter()
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) { router.replace('/login'); return }
      const user = await res.json()
      if (user.role === 'admin') { router.replace('/admin'); return }
      setAuthUser(user)
      setLoading(false)
    })
  }, [router])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Carregando…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-sky-400">🧠 Reconhecimento Facial</span>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span>👤 {authUser?.username}</span>
          {authUser?.role === 'client' && (
            <button
              onClick={() => router.push('/client')}
              className="text-sky-400 hover:text-sky-300"
            >
              ← Menu
            </button>
          )}
          <button
            onClick={logout}
            className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg transition-colors"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="p-4 sm:p-6">
        <FaceRecognitionPanel allowRegister={false} />
      </main>
    </div>
  )
}
