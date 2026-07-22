'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useClientAuth } from '../layout'
import ObraFormModal, { ObraFormData, OBRA_STATUS } from '@/components/obras/ObraFormModal'
import ObraEmployeesModal from '@/components/obras/ObraEmployeesModal'

interface Obra {
  id: number
  name: string
  description: string | null
  status: string
  start_date: string | null
  cep: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  address: string | null
  lat: number | null
  lng: number | null
  employee_count: number
  created_at: string
}

type Modal =
  | { kind: 'form'; obra?: Obra }
  | { kind: 'employees'; obra: Obra }
  | null

export default function ObrasPage() {
  const auth = useClientAuth()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/obras')
    if (res.ok) setObras(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return obras
    return obras.filter((o) =>
      o.name.toLowerCase().includes(q) || (o.address ?? '').toLowerCase().includes(q)
    )
  }, [obras, search])

  function handleCreated(obra: Obra) {
    setObras((prev) => [obra, ...prev])
    setModal(null)
  }

  function handleUpdated(obra: Obra) {
    setObras((prev) => prev.map((o) => (o.id === obra.id ? { ...o, ...obra } : o)))
    setModal(null)
  }

  function handleEmployeeCountChange(obraId: number, delta: number) {
    setObras((prev) => prev.map((o) => (o.id === obraId ? { ...o, employee_count: Math.max(0, o.employee_count + delta) } : o)))
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Remover a obra "${name}"? Funcionários alocados serão desvinculados.`)) return
    const res = await fetch(`/api/obras/${id}`, { method: 'DELETE' })
    if (res.ok) setObras((prev) => prev.filter((o) => o.id !== id))
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">🏗️ Obras</h1>
          {auth && (
            <p className="text-slate-400 text-sm mt-0.5">
              {obras.length} obra{obras.length !== 1 ? 's' : ''} cadastrada{obras.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => setModal({ kind: 'form' })}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors shadow shadow-sky-900/40"
        >
          + Nova obra
        </button>
      </div>

      {/* Busca */}
      {obras.length > 0 && (
        <div className="mb-5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou endereço…"
            className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-sky-500"
          />
        </div>
      )}

      {/* Conteúdo */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-800 border border-slate-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : obras.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-dashed border-slate-700 rounded-xl">
          <p className="text-4xl mb-3">🏗️</p>
          <p className="text-slate-300 font-medium">Nenhuma obra cadastrada ainda</p>
          <p className="text-slate-500 text-sm mt-1 mb-5">
            Cadastre a obra com endereço e GPS, depois aloque os funcionários responsáveis.
          </p>
          <button
            onClick={() => setModal({ kind: 'form' })}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium"
          >
            + Cadastrar primeira obra
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Nenhuma obra encontrada para &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((o) => {
            const st = OBRA_STATUS[o.status] ?? OBRA_STATUS.planning
            return (
              <div
                key={o.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-100 text-lg">{o.name}</p>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${st.classes}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>

                {o.description && (
                  <p className="text-sm text-slate-400 mt-1.5 line-clamp-2">{o.description}</p>
                )}

                <div className="text-xs text-slate-500 mt-3 space-y-1">
                  {o.address && <p className="truncate">📍 {o.address}</p>}
                  {o.lat != null && o.lng != null && (
                    <p className="font-mono">
                      GPS: {Number(o.lat).toFixed(6)}, {Number(o.lng).toFixed(6)}{' '}
                      <a
                        href={`https://maps.google.com/?q=${o.lat},${o.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-500 hover:text-sky-400"
                      >
                        ver mapa ↗
                      </a>
                    </p>
                  )}
                  {o.start_date && (
                    <p>🗓️ Início: {new Date(o.start_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                  )}
                </div>

                <button
                  onClick={() => setModal({ kind: 'employees', obra: o })}
                  className="mt-4 flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-900 border border-slate-700 rounded-lg text-sm transition-colors"
                >
                  <span className="text-slate-300">👷 Funcionários alocados</span>
                  <span className="bg-sky-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                    {o.employee_count}
                  </span>
                </button>

                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700/70">
                  <button
                    onClick={() => setModal({ kind: 'form', obra: o })}
                    className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium"
                  >
                    ✏️ Editar
                  </button>
                  <button
                    onClick={() => handleDelete(o.id, o.name)}
                    className="flex-1 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-300 rounded-lg text-xs font-medium"
                  >
                    🗑️ Remover
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modais */}
      {modal?.kind === 'form' && (
        <ObraFormModal
          initial={modal.obra ? {
            id: modal.obra.id,
            name: modal.obra.name,
            description: modal.obra.description ?? '',
            status: modal.obra.status,
            startDate: modal.obra.start_date ?? '',
            cep: modal.obra.cep ?? '',
            street: modal.obra.street ?? '',
            number: modal.obra.number ?? '',
            neighborhood: modal.obra.neighborhood ?? '',
            city: modal.obra.city ?? '',
            state: modal.obra.state ?? '',
            lat: modal.obra.lat != null ? String(modal.obra.lat) : '',
            lng: modal.obra.lng != null ? String(modal.obra.lng) : '',
          } as ObraFormData : undefined}
          onClose={() => setModal(null)}
          onSaved={(data) => (modal.obra ? handleUpdated({ ...modal.obra, ...data }) : handleCreated({ ...data, employee_count: 0 }))}
        />
      )}
      {modal?.kind === 'employees' && (
        <ObraEmployeesModal
          obraId={modal.obra.id}
          obraName={modal.obra.name}
          onClose={() => setModal(null)}
          onChanged={(delta) => handleEmployeeCountChange(modal.obra.id, delta)}
        />
      )}
    </div>
  )
}

