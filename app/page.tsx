'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) {
        setLoading(false)
        return
      }
      const user = await res.json()
      setIsAuthenticated(true)
      if (user.role === 'admin') router.replace('/admin')
      else if (user.role === 'client') router.replace('/client')
      else router.replace('/recognize')
    }).catch(() => {
      setLoading(false)
    })
  }, [router])

  if (loading || isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Carregando…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b_0%,_#0b1220_45%,_#020617_100%)] text-white">
      <main className="max-w-6xl mx-auto px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <section>
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-sky-300/90 border border-sky-400/20 px-3 py-1 rounded-full mb-5">
              Plataforma Obras.com
            </p>
            <h1 className="text-4xl sm:text-5xl font-black leading-tight">
              Controle de obras, equipes e acesso com biometria facial.
            </h1>
            <p className="text-slate-300 mt-5 text-lg max-w-xl">
              Cadastre sua empresa, organize funcionários e usuários de campo e acompanhe obras em uma única plataforma.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-center"
              >
                Criar conta
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 rounded-xl border border-slate-600 hover:border-slate-400 text-slate-100 text-center"
              >
                Já tenho acesso
              </Link>
            </div>
          </section>

          <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 backdrop-blur-sm">
            <h2 className="text-xl font-bold mb-4">O que você ganha</h2>
            <ul className="space-y-3 text-slate-300">
              <li>✅ Cadastro de cliente com acesso por e-mail</li>
              <li>✅ Login tradicional e login com Google</li>
              <li>✅ Recuperação de senha por e-mail</li>
              <li>✅ Gestão de usuários com permissões por obra</li>
              <li>✅ Reconhecimento facial integrado ao fluxo operacional</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
