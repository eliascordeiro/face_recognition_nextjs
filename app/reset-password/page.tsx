'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [token, setToken] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search)
    setToken(qs.get('token') ?? '')
  }, [])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Token inválido')
      return
    }
    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres')
      return
    }
    if (password !== confirm) {
      setError('A confirmação de senha não confere')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível redefinir a senha')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 1000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white mb-1">Nova senha</h1>
        <p className="text-sm text-slate-400 mb-5">Defina sua nova senha para continuar.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Nova senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
              placeholder="Digite novamente"
            />
          </div>

          {error && <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-3">{error}</p>}
          {done && <p className="text-sm text-emerald-300 bg-emerald-900/30 border border-emerald-700 rounded-lg p-3">Senha redefinida com sucesso. Redirecionando…</p>}

          <button
            type="submit"
            disabled={loading || done}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 text-white font-semibold py-2 rounded-lg"
          >
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-4 text-center">
          <Link href="/login" className="text-sky-400 hover:text-sky-300">Voltar para login</Link>
        </p>
      </div>
    </div>
  )
}
