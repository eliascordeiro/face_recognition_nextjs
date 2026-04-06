'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useClientAuth } from './layout'

interface Stats {
  obras: number
  employees: number
  operators: number
}

export default function ClientDashboard() {
  const router = useRouter()
  const auth = useClientAuth()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/obras').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/persons').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/users').then((r) => (r.ok ? r.json() : [])),
    ]).then(([obras, persons, users]) => {
      setStats({
        obras: Array.isArray(obras) ? obras.length : 0,
        employees: Array.isArray(persons) ? persons.length : 0,
        operators: Array.isArray(users) ? users.length : 0,
      })
    })
  }, [])

  const cards = [
    { icon: '🏗️', label: 'Obras',        value: stats?.obras,     href: '/client/obras',     color: 'sky' },
    { icon: '🧑‍💼', label: 'Funcionários', value: stats?.employees, href: '/client/employees', color: 'emerald' },
    { icon: '👥', label: 'Operadores',    value: stats?.operators, href: '/client/operators', color: 'violet' },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-100 mb-1">
        Painel de controle
      </h1>
      <p className="text-slate-400 text-sm mb-8">
        Bem-vindo, <span className="text-slate-300 font-medium">{auth?.fullName || auth?.username}</span>
      </p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <button
            key={c.href}
            onClick={() => router.push(c.href)}
            className={`bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-5 text-left transition-all group hover:border-${c.color}-600`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-3xl">{c.icon}</span>
              <span className={`text-3xl font-bold text-${c.color}-400`}>
                {stats === null ? '…' : c.value}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
              {c.label}
            </p>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">
        Ações rápidas
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => router.push('/client/obras')}
          className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 text-left transition-all"
        >
          <span className="text-2xl">🏗️</span>
          <div>
            <p className="font-medium text-slate-200 text-sm">Gerenciar Obras</p>
            <p className="text-xs text-slate-500">Cadastre e acompanhe suas obras</p>
          </div>
        </button>
        <button
          onClick={() => router.push('/client/employees')}
          className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 text-left transition-all"
        >
          <span className="text-2xl">🧑‍💼</span>
          <div>
            <p className="font-medium text-slate-200 text-sm">Reconhecimento Facial</p>
            <p className="text-xs text-slate-500">Cadastre funcionários por biometria</p>
          </div>
        </button>
        <button
          onClick={() => router.push('/client/operators')}
          className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 text-left transition-all"
        >
          <span className="text-2xl">👥</span>
          <div>
            <p className="font-medium text-slate-200 text-sm">Gerenciar Operadores</p>
            <p className="text-xs text-slate-500">Crie e gerencie usuários operadores</p>
          </div>
        </button>
        <button
          onClick={() => router.push('/client/profile')}
          className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 text-left transition-all"
        >
          <span className="text-2xl">⚙️</span>
          <div>
            <p className="font-medium text-slate-200 text-sm">Meu Perfil</p>
            <p className="text-xs text-slate-500">Endereço, telefone e localização GPS</p>
          </div>
        </button>
      </div>
    </div>
  )
}
