'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

export interface ClientUser {
  id: string
  username: string
  role: string
  fullName?: string | null
  clientId?: string
  phone?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

const AuthContext = createContext<ClientUser | null>(null)

/** Hook para páginas filhas obterem o usuário autenticado sem re-fetch */
export function useClientAuth(): ClientUser | null {
  return useContext(AuthContext)
}

const NAV = [
  { href: '/client',           label: 'Painel',        icon: '🏠' },
  { href: '/client/obras',     label: 'Obras',         icon: '🏗️' },
  { href: '/client/employees', label: 'Funcionários',  icon: '🧑‍💼' },
  { href: '/client/operators', label: 'Operadores',    icon: '👥' },
  { href: '/client/profile',   label: 'Meu Perfil',    icon: '⚙️' },
]

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [auth, setAuth] = useState<ClientUser | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) { router.replace('/login'); return }
      const user = await res.json()
      if (user.role !== 'client') { router.replace('/'); return }
      setAuth(user)
    })
  }, [router])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400 animate-pulse">Carregando…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={auth}>
      <div className="min-h-screen bg-slate-900 text-white flex">

        {/* Overlay mobile */}
        {open && (
          <div
            className="fixed inset-0 bg-black/50 z-20 lg:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className={`
            fixed top-0 left-0 h-full w-64 bg-slate-800 border-r border-slate-700
            z-30 flex flex-col transition-transform duration-200
            ${open ? 'translate-x-0' : '-translate-x-full'}
            lg:translate-x-0 lg:static lg:flex-shrink-0
          `}
        >
          {/* Cabeçalho da sidebar */}
          <div className="px-5 py-4 border-b border-slate-700">
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest mb-1">
              Sistema de Controle
            </p>
            <p className="font-bold text-sky-400 truncate text-lg leading-tight">
              {auth.fullName || auth.username}
            </p>
          </div>

          {/* Navegação */}
          <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/client' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-sky-600 text-white shadow'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span className="text-base w-6 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Rodapé da sidebar */}
          <div className="px-4 py-4 border-t border-slate-700 space-y-2">
            <p className="text-xs text-slate-500 truncate">👤 {auth.username}</p>
            <button
              onClick={logout}
              className="w-full py-2 bg-slate-700 hover:bg-red-900/60 hover:text-red-300 rounded-lg text-sm transition-colors"
            >
              Sair
            </button>
          </div>
        </aside>

        {/* ── Conteúdo principal ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Header mobile */}
          <header className="lg:hidden sticky top-0 z-10 bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="text-slate-300 hover:text-white text-xl leading-none"
              aria-label="Abrir menu"
            >
              ☰
            </button>
            <span className="font-semibold text-sky-400 truncate">
              {auth.fullName || auth.username}
            </span>
          </header>

          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  )
}
