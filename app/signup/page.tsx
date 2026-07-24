'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [verificationStage, setVerificationStage] = useState<'register' | 'verify'>('register')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendingCode, setResendingCode] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, companyName, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível criar sua conta')
        return
      }
      setPendingEmail(String(data.email ?? email).toLowerCase())
      setVerificationStage('verify')
      setSuccess(data.message ?? 'Código enviado para seu e-mail.')
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code: verificationCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível validar o código')
        return
      }
      router.push('/client')
      router.refresh()
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  async function handleResendCode() {
    if (!pendingEmail) return
    setError(null)
    setSuccess(null)
    setResendingCode(true)
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      })
      const data = await res.json()
      if (!res.ok) {
        const retryHint = data.retryAfter ? ` Aguarde ${data.retryAfter}s para tentar novamente.` : ''
        setError((data.error ?? 'Não foi possível reenviar o código') + retryHint)
        return
      }
      setSuccess(data.message ?? 'Código reenviado.')
    } catch {
      setError('Erro de conexão')
    } finally {
      setResendingCode(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div className="text-5xl mb-3">🏗️</div>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold text-white">
            {verificationStage === 'register' ? 'Criar conta' : 'Verificar e-mail'}
          </h1>
          <p className="text-slate-300 text-sm mt-1">
            {verificationStage === 'register'
              ? 'Comece agora no Obras.com'
              : 'Digite o código enviado para concluir o cadastro'}
          </p>
        </div>

        <form
          onSubmit={verificationStage === 'register' ? handleSubmit : handleVerifyCode}
          className="auth-panel p-5 sm:p-6 space-y-4"
        >
          {verificationStage === 'register' ? (
            <>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Seu nome *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="Nome do responsável"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">Empresa *</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="Nome da sua empresa"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">E-mail *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="voce@empresa.com"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">Senha *</label>
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
            </>
          ) : (
            <>
              <div className="text-sm text-slate-300">
                Código enviado para <strong className="text-slate-100">{pendingEmail}</strong>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Código de verificação</label>
                <input
                  type="text"
                  required
                  maxLength={4}
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white tracking-[0.3em] text-center font-semibold"
                  placeholder="0000"
                />
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-900/50 border border-red-600 text-red-300 text-sm rounded-lg p-3 text-center">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-900/40 border border-emerald-600 text-emerald-300 text-sm rounded-lg p-3 text-center">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 text-white font-semibold py-2 rounded-lg"
          >
            {loading
              ? verificationStage === 'register'
                ? 'Criando conta…'
                : 'Validando código…'
              : verificationStage === 'register'
              ? 'Criar conta'
              : 'Confirmar código'}
          </button>

          {verificationStage === 'verify' && (
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendingCode}
              className="w-full bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700/60 text-white font-medium py-2 rounded-lg"
            >
              {resendingCode ? 'Reenviando…' : 'Reenviar código'}
            </button>
          )}

          <p className="text-xs text-slate-400 text-center">
            Já tem conta? <Link href="/login" className="text-sky-400 hover:text-sky-300">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
