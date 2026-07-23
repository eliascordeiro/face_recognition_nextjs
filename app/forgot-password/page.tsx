'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      setMessage(data.message ?? 'Se o e-mail existir, enviaremos instruções de redefinição.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <h1 className="text-xl font-bold text-white mb-1">Esqueci minha senha</h1>
        <p className="text-sm text-slate-400 mb-5">Informe seu e-mail para receber o link de redefinição.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
              placeholder="voce@empresa.com"
            />
          </div>

          {message && <p className="text-sm text-emerald-300 bg-emerald-900/30 border border-emerald-700 rounded-lg p-3">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 text-white font-semibold py-2 rounded-lg"
          >
            {loading ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-4 text-center">
          <Link href="/login" className="text-sky-400 hover:text-sky-300">Voltar para login</Link>
        </p>
      </div>
    </div>
  )
}
