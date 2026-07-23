'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { OperatorCapability, hasCapability } from '@/lib/permissions'

export interface OperatorUser {
  id: string
  username: string
  role: string
  fullName?: string | null
  clientId?: string
  permissions?: OperatorCapability[]
  obraId?: string
  obraName?: string | null
}

const AuthContext = createContext<OperatorUser | null>(null)

/** Hook para páginas filhas obterem o operador autenticado e suas permissões. */
export function useOperatorAuth(): OperatorUser | null {
  return useContext(AuthContext)
}

export function hasPerm(auth: OperatorUser | null, cap: OperatorCapability): boolean {
  if (!auth) return false
  return hasCapability(auth, cap)
}

export default function RecognizeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [auth, setAuth] = useState<OperatorUser | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(async (res) => {
      if (!res.ok) { router.replace('/login'); return }
      const user = await res.json()
      if (user.role === 'admin') { router.replace('/admin'); return }
      if (user.role === 'client') { router.replace('/client'); return }
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

  const nav = [
    { href: '/recognize', label: 'Identificar', icon: '🧠', show: true },
    { href: '/recognize/employees', label: 'Funcionários', icon: '🧑‍💼', show: hasPerm(auth, 'employees.view') },
    { href: '/recognize/obras', label: 'Obras', icon: '🏗️', show: hasPerm(auth, 'obras.view') },
  ].filter((i) => i.show)

  return (
    <AuthContext.Provider value={auth}>
      <div className="min-h-screen bg-slate-900 text-white flex">
        {open && (
          <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setOpen(false)} />
        )}

        <aside
          className={`
            fixed top-0 left-0 h-full w-64 bg-slate-800 border-r border-slate-700
            z-30 flex flex-col transition-transform duration-200
            ${open ? 'translate-x-0' : '-translate-x-full'}
            lg:translate-x-0 lg:static lg:flex-shrink-0
          `}
        >
          <div className="px-5 py-4 border-b border-slate-700">
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-widest mb-1">
              Operador
            </p>
            <p className="font-bold text-sky-400 truncate text-lg leading-tight">
              {auth.fullName || auth.username}
            </p>
            {auth.obraName && (
              <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1">
                🏗️ <span className="truncate">{auth.obraName}</span>
              </p>
            )}
          </div>

          <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
            {nav.map((item) => {
              const active = pathname === item.href || (item.href !== '/recognize' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-sky-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span className="text-base w-6 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              )
            })}
          </nav>

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

        <div className="flex-1 flex flex-col min-w-0">
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

          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </AuthContext.Provider>
  )
}
