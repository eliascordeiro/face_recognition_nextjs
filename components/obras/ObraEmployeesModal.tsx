'use client'

import { useEffect, useMemo, useState } from 'react'

interface Person {
  id: number
  name: string
  role: string | null
  phone: string | null
  thumbnail: string | null
  has_face: boolean
  obra_id: number | null
}

interface Props {
  obraId: number
  obraName: string
  onClose: () => void
  /** Notifica a página pai para atualizar o contador de funcionários da obra */
  onChanged: (delta: number) => void
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

/**
 * Modal para alocar/desalocar funcionários já cadastrados a uma obra
 * específica. Não recadastra funcionário — reaproveita o cadastro existente
 * (dados + reconhecimento facial) feito na tela de Funcionários.
 */
export default function ObraEmployeesModal({ obraId, obraName, onClose, onChanged }: Props) {
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/persons')
      .then((res) => (res.ok ? res.json() : []))
      .then(setPersons)
      .finally(() => setLoading(false))
  }, [])

  const { assigned, available } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (p: Person) => !q || p.name.toLowerCase().includes(q) || (p.role ?? '').toLowerCase().includes(q)
    return {
      assigned: persons.filter((p) => p.obra_id === obraId && match(p)),
      available: persons.filter((p) => p.obra_id !== obraId && match(p)),
    }
  }, [persons, search, obraId])

  async function toggle(person: Person, assign: boolean) {
    setBusyId(person.id)
    try {
      const res = await fetch(`/api/persons/${person.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obraId: assign ? obraId : null }),
      })
      if (!res.ok) return
      setPersons((prev) => prev.map((p) => (p.id === person.id ? { ...p, obra_id: assign ? obraId : null } : p)))
      onChanged(assign ? 1 : -1)
    } finally {
      setBusyId(null)
    }
  }

  function Row({ person, assigned }: { person: Person; assigned: boolean }) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-slate-700/40 transition-colors">
        {person.thumbnail ? (
          <img src={person.thumbnail} alt={person.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-300 font-semibold flex-shrink-0">
            {initials(person.name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-100 truncate">{person.name}</p>
          <p className="text-xs text-slate-500 truncate">{person.role || 'Cargo não informado'}</p>
        </div>
        {!person.has_face && (
          <span className="text-[10px] text-amber-400 whitespace-nowrap">⚠️ sem facial</span>
        )}
        <button
          onClick={() => toggle(person, !assigned)}
          disabled={busyId === person.id}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap disabled:opacity-50 ${
            assigned
              ? 'bg-red-900/40 hover:bg-red-900/70 text-red-300'
              : 'bg-sky-600 hover:bg-sky-500 text-white'
          }`}
        >
          {busyId === person.id ? '…' : assigned ? 'Remover' : 'Alocar'}
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">👷 Funcionários alocados</h3>
            <p className="text-slate-400 text-xs mt-0.5">{obraName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="p-5 pb-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar funcionário por nome ou cargo…"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-5">
          {loading ? (
            <p className="text-center text-slate-500 text-sm py-8 animate-pulse">Carregando…</p>
          ) : persons.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">
              Nenhum funcionário cadastrado ainda. Cadastre em &ldquo;Funcionários&rdquo; primeiro.
            </p>
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 pt-2 pb-1">
                Alocados nesta obra ({assigned.length})
              </p>
              {assigned.length === 0 ? (
                <p className="text-xs text-slate-600 px-3 pb-3">Nenhum funcionário alocado ainda.</p>
              ) : (
                assigned.map((p) => <Row key={p.id} person={p} assigned />)
              )}

              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-3 pt-4 pb-1">
                Disponíveis ({available.length})
              </p>
              {available.length === 0 ? (
                <p className="text-xs text-slate-600 px-3 pb-3">Nenhum funcionário disponível.</p>
              ) : (
                available.map((p) => <Row key={p.id} person={p} assigned={false} />)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
