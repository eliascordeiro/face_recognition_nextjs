'use client'

import { useEffect, useState } from 'react'
import { OBRA_STATUS } from '@/components/obras/ObraFormModal'

interface Obra {
  id: number
  name: string
  description: string | null
  status: string
  start_date: string | null
  address: string | null
  lat: number | null
  lng: number | null
  employee_count: number
  created_at: string
}

/** Visualização somente leitura das obras — operadores nunca podem criar,
 *  editar ou remover obras (capacidade 'obras.manage' não é liberável). */
export default function OperatorObrasPage() {
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/obras').then(async (res) => {
      if (res.ok) setObras(await res.json())
      setLoading(false)
    })
  }, [])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">🏗️ Obras</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {obras.length} obra{obras.length !== 1 ? 's' : ''} · somente leitura
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 bg-slate-800 border border-slate-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : obras.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-dashed border-slate-700 rounded-xl">
          <p className="text-4xl mb-3">🏗️</p>
          <p className="text-slate-300 font-medium">Nenhuma obra disponível para você.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {obras.map((o) => {
            const st = OBRA_STATUS[o.status] ?? OBRA_STATUS.planning
            return (
              <div key={o.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-100 text-lg">{o.name}</p>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${st.classes}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>
                {o.description && <p className="text-sm text-slate-400 mt-1.5 line-clamp-2">{o.description}</p>}
                <div className="text-xs text-slate-500 mt-3 space-y-1">
                  {o.address && <p className="truncate">📍 {o.address}</p>}
                  {o.lat != null && o.lng != null && (
                    <p className="font-mono">
                      GPS: {Number(o.lat).toFixed(6)}, {Number(o.lng).toFixed(6)}{' '}
                      <a href={`https://maps.google.com/?q=${o.lat},${o.lng}`} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-400">
                        ver mapa ↗
                      </a>
                    </p>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-slate-700/70 text-xs text-slate-400">
                  👷 {o.employee_count} funcionário{o.employee_count !== 1 ? 's' : ''} alocado{o.employee_count !== 1 ? 's' : ''}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
