'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao fazer login')
        return
      }
      router.push(data.role === 'admin' ? '/admin' : '/')
      router.refresh()
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="text-5xl mb-3">🔐</div>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold text-white">Acessar plataforma</h1>
          <p className="text-slate-300 text-sm mt-1">Entre com seu e-mail para continuar</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="auth-panel p-5 sm:p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-slate-300 mb-1" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                         text-white placeholder-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="voce@empresa.com"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                         text-white placeholder-slate-500 focus:outline-none
                         focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-600 text-red-300 text-sm rounded-lg p-3 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 soft-glow
                       text-white font-semibold py-2 rounded-lg transition-colors"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>

          <div className="text-right">
            <Link href="/forgot-password" className="text-xs text-sky-400 hover:text-sky-300">
              Esqueci minha senha
            </Link>
          </div>

          <p className="text-xs text-slate-400 text-center pt-2">
            Ainda não tem conta?{' '}
            <Link href="/signup" className="text-sky-400 hover:text-sky-300">Criar conta</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
