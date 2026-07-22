'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClientAuth } from '../layout'
import EmployeeFormModal, { EmployeeFormData } from '@/components/employees/EmployeeFormModal'
import FaceCaptureModal from '@/components/employees/FaceCaptureModal'
import RecognizeTestModal from '@/components/employees/RecognizeTestModal'

interface Employee {
  id: number
  name: string
  phone: string | null
  email: string | null
  document: string | null
  role: string | null
  active: boolean
  thumbnail: string | null
  has_face: boolean
  created_at: string
}

type Modal =
  | { kind: 'form'; employee?: Employee }
  | { kind: 'face'; employee: Employee }
  | { kind: 'recognize' }
  | null

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
}

export default function EmployeesPage() {
  const auth = useClientAuth()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  const loadEmployees = useCallback(async () => {
    const res = await fetch('/api/persons')
    if (res.ok) setEmployees(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.role ?? '').toLowerCase().includes(q) ||
      (e.email ?? '').toLowerCase().includes(q)
    )
  }, [employees, search])

  const facePendingCount = useMemo(() => employees.filter((e) => !e.has_face).length, [employees])

  async function deleteEmployee(id: number, name: string) {
    if (!confirm(`Remover "${name}" do cadastro? Essa ação não pode ser desfeita.`)) return
    const res = await fetch(`/api/persons/${id}`, { method: 'DELETE' })
    if (res.ok) setEmployees((prev) => prev.filter((e) => e.id !== id))
  }

  function handleCreated(employee: Employee) {
    setEmployees((prev) => [{ ...employee, has_face: false, thumbnail: null }, ...prev])
    setModal(null)
  }

  function handleUpdated(employee: Employee) {
    setEmployees((prev) => prev.map((e) => (e.id === employee.id ? { ...e, ...employee } : e)))
    setModal(null)
  }

  function handleFaceSaved(employeeId: number, patch: { has_face: boolean; thumbnail?: string | null }) {
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, ...patch } : e)))
    setModal(null)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">🧑‍💼 Funcionários</h1>
          {auth && (
            <p className="text-slate-400 text-sm mt-0.5">
              {employees.length} cadastrado{employees.length !== 1 ? 's' : ''}
              {facePendingCount > 0 && (
                <span className="text-amber-400"> · {facePendingCount} sem reconhecimento facial</span>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setModal({ kind: 'recognize' })}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-sm font-medium transition-colors"
          >
            🔍 Testar identificação
          </button>
          <button
            onClick={() => setModal({ kind: 'form' })}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium transition-colors shadow shadow-sky-900/40"
          >
            + Novo funcionário
          </button>
        </div>
      </div>

      {/* Busca */}
      {employees.length > 0 && (
        <div className="mb-5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, cargo ou e-mail…"
            className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-sky-500"
          />
        </div>
      )}

      {/* Conteúdo */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-slate-800 border border-slate-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/50 border border-dashed border-slate-700 rounded-xl">
          <p className="text-4xl mb-3">🧑‍💼</p>
          <p className="text-slate-300 font-medium">Nenhum funcionário cadastrado ainda</p>
          <p className="text-slate-500 text-sm mt-1 mb-5">
            Cadastre os dados do funcionário e, em seguida, vincule o reconhecimento facial.
          </p>
          <button
            onClick={() => setModal({ kind: 'form' })}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-medium"
          >
            + Cadastrar primeiro funcionário
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Nenhum funcionário encontrado para &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((emp) => (
            <div
              key={emp.id}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start gap-3">
                {emp.thumbnail ? (
                  <img
                    src={emp.thumbnail}
                    alt={emp.name}
                    className="w-14 h-14 rounded-full object-cover border-2 border-slate-700 flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 font-semibold flex-shrink-0">
                    {initials(emp.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-100 truncate">{emp.name}</p>
                  <p className="text-slate-400 text-xs truncate">{emp.role || 'Cargo não informado'}</p>
                  <span
                    className={`inline-flex items-center gap-1 mt-1.5 text-[11px] px-2 py-0.5 rounded-full border ${
                      emp.has_face
                        ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
                        : 'bg-amber-900/40 border-amber-700 text-amber-300'
                    }`}
                  >
                    {emp.has_face ? '✅ Reconhecimento ativo' : '⚠️ Facial pendente'}
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-500 mt-3 space-y-0.5">
                {emp.phone && <p>📞 {emp.phone}</p>}
                {emp.email && <p className="truncate">✉️ {emp.email}</p>}
              </div>

              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-700/70">
                <button
                  onClick={() => setModal({ kind: 'face', employee: emp })}
                  className="flex-1 min-w-[45%] py-1.5 bg-violet-600/90 hover:bg-violet-500 text-white rounded-lg text-xs font-medium"
                >
                  📸 {emp.has_face ? 'Atualizar rosto' : 'Cadastrar rosto'}
                </button>
                <button
                  onClick={() => setModal({ kind: 'form', employee: emp })}
                  className="flex-1 min-w-[45%] py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium"
                >
                  ✏️ Editar
                </button>
                <button
                  onClick={() => deleteEmployee(emp.id, emp.name)}
                  className="w-full py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-300 rounded-lg text-xs font-medium"
                >
                  🗑️ Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modais */}
      {modal?.kind === 'form' && (
        <EmployeeFormModal
          initial={modal.employee ? {
            id: modal.employee.id,
            name: modal.employee.name,
            phone: modal.employee.phone ?? '',
            email: modal.employee.email ?? '',
            document: modal.employee.document ?? '',
            role: modal.employee.role ?? '',
          } : undefined}
          onClose={() => setModal(null)}
          onSaved={(data) => (modal.employee ? handleUpdated(data) : handleCreated(data))}
        />
      )}
      {modal?.kind === 'face' && (
        <FaceCaptureModal
          personId={modal.employee.id}
          personName={modal.employee.name}
          onClose={() => setModal(null)}
          onSaved={(patch) => handleFaceSaved(modal.employee.id, patch)}
        />
      )}
      {modal?.kind === 'recognize' && (
        <RecognizeTestModal onClose={() => setModal(null)} />
      )}
    </div>
  )
}
