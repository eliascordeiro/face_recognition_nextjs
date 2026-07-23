'use client'

import { useEffect, useState, FormEvent, useCallback } from 'react'
import { useClientAuth } from '../layout'
import { OPERATOR_CAPABILITIES, CAPABILITY_LABELS, OperatorCapability } from '@/lib/permissions'

interface Operator {
  id: number
  username: string
  full_name: string | null
  role: string
  created_at: string
  permissions?: OperatorCapability[]
  obra_id?: number | null
  obra_name?: string | null
}

interface ObraOption {
  id: number
  name: string
}

type ModalMode = 'create' | 'password' | 'permissions' | null

export default function OperatorsPage() {
  const auth = useClientAuth()
  const [operators, setOperators] = useState<Operator[]>([])
  const [obras, setObras] = useState<ObraOption[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalMode>(null)
  const [selectedOp, setSelectedOp] = useState<Operator | null>(null)
  const [formData, setFormData] = useState({ username: '', password: '', fullName: '' })
  const [permForm, setPermForm] = useState<{ permissions: OperatorCapability[]; obraId: number | null }>({ permissions: [], obraId: null })
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)

  const loadOperators = useCallback(async () => {
    const res = await fetch('/api/users')
    if (res.ok) setOperators(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadOperators() }, [loadOperators])
  useEffect(() => {
    fetch('/api/obras').then(async (res) => { if (res.ok) setObras(await res.json()) })
  }, [])

  async function deleteOperator(id: number) {
    if (!confirm('Remover este operador?')) return
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
    if (res.ok) setOperators((prev) => prev.filter((o) => o.id !== id))
  }

  async function handleCreateOperator(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormLoading(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          fullName: formData.fullName,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error); return }
      setOperators((prev) => [...prev, data])
      setModal(null)
      setFormData({ username: '', password: '', fullName: '' })
    } finally {
      setFormLoading(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (!selectedOp) return
    setFormError(null)
    setFormLoading(true)
    try {
      const res = await fetch(`/api/users/${selectedOp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formData.password }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error); return }
      setModal(null)
      setFormData({ username: '', password: '', fullName: '' })
    } finally {
      setFormLoading(false)
    }
  }

  function openCreate() {
    setFormData({ username: '', password: '', fullName: '' })
    setFormError(null)
    setModal('create')
  }

  function openPassword(op: Operator) {
    setSelectedOp(op)
    setFormData({ username: op.username, password: '', fullName: op.full_name ?? '' })
    setFormError(null)
    setModal('password')
  }

  function openPermissions(op: Operator) {
    setSelectedOp(op)
    setPermForm({ permissions: op.permissions ?? [], obraId: op.obra_id ?? null })
    setFormError(null)
    setModal('permissions')
  }

  function toggleCapability(cap: OperatorCapability) {
    setPermForm((f) => ({
      ...f,
      permissions: f.permissions.includes(cap)
        ? f.permissions.filter((p) => p !== cap)
        : [...f.permissions, cap],
    }))
  }

  async function handleSavePermissions(e: FormEvent) {
    e.preventDefault()
    if (!selectedOp) return
    setFormError(null)
    setFormLoading(true)
    try {
      const res = await fetch(`/api/users/${selectedOp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permForm.permissions, obraId: permForm.obraId }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error); return }
      setOperators((prev) => prev.map((o) => (o.id === selectedOp.id ? { ...o, ...data } : o)))
      setModal(null)
    } finally {
      setFormLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">👥 Operadores</h1>
          {auth && (
            <p className="text-slate-400 text-sm mt-0.5">
              {auth.fullName || auth.username} · {operators.length} operador{operators.length !== 1 ? 'es' : ''}
            </p>
          )}
        </div>
        <button
          onClick={openCreate}
          className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Novo operador
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 animate-pulse">Carregando…</div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/50 text-slate-300">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">Login</th>
                <th className="text-left px-4 py-3">Acesso</th>
                <th className="text-left px-4 py-3">Criado em</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {operators.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500 py-6">
                    Nenhum operador cadastrado.
                  </td>
                </tr>
              )}
              {operators.map((op) => (
                <tr key={op.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{op.full_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{op.username}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {(op.permissions ?? []).length === 0 ? (
                        <span className="text-[11px] text-slate-500">Somente identificação</span>
                      ) : (
                        (op.permissions ?? []).map((p) => (
                          <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 border border-sky-700 text-sky-300">
                            {CAPABILITY_LABELS[p]}
                          </span>
                        ))
                      )}
                    </div>
                    {op.obra_name && (
                      <p className="text-[11px] text-amber-400 mt-1">🏗️ Restrito à obra: {op.obra_name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(op.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => openPermissions(op)}
                      className="text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 rounded hover:bg-emerald-900/30"
                    >
                      Permissões
                    </button>
                    <button
                      onClick={() => openPassword(op)}
                      className="text-sky-400 hover:text-sky-300 text-xs px-2 py-1 rounded hover:bg-sky-900/30"
                    >
                      Senha
                    </button>
                    <button
                      onClick={() => deleteOperator(op.id)}
                      className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-900/30"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Criar operador */}
      {modal === 'create' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-4">Novo operador</h3>
            <form onSubmit={handleCreateOperator} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome (opcional)</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData((d) => ({ ...d, fullName: e.target.value }))}
                  placeholder="Nome do operador"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Login *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData((d) => ({ ...d, username: e.target.value }))}
                  placeholder="usuario"
                  required
                  autoComplete="off"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Senha *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData((d) => ({ ...d, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              {formError && <p className="text-red-400 text-sm">{formError}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
                >
                  {formLoading ? 'Criando…' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Alterar senha */}
      {modal === 'password' && selectedOp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-1">Alterar senha</h3>
            <p className="text-slate-400 text-sm mb-4">{selectedOp.full_name || selectedOp.username}</p>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nova senha *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData((d) => ({ ...d, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              {formError && <p className="text-red-400 text-sm">{formError}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
                >
                  {formLoading ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Permissões e escopo de obra */}
      {modal === 'permissions' && selectedOp && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-1">🔑 Permissões</h3>
            <p className="text-slate-400 text-sm mb-4">{selectedOp.full_name || selectedOp.username}</p>
            <form onSubmit={handleSavePermissions} className="space-y-4">
              <div>
                <p className="text-xs text-slate-400 mb-2">
                  👁️ Identificar rosto (reconhecimento) sempre liberado. Marque abaixo o que mais
                  este operador pode fazer:
                </p>
                <div className="space-y-2">
                  {OPERATOR_CAPABILITIES.map((cap) => (
                    <label key={cap} className="flex items-center gap-2 text-sm bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:border-slate-600">
                      <input
                        type="checkbox"
                        checked={permForm.permissions.includes(cap)}
                        onChange={() => toggleCapability(cap)}
                        className="accent-sky-500"
                      />
                      {CAPABILITY_LABELS[cap]}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Restringir a uma obra (opcional)</label>
                <select
                  value={permForm.obraId ?? ''}
                  onChange={(e) => setPermForm((f) => ({ ...f, obraId: e.target.value ? Number(e.target.value) : null }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                >
                  <option value="">Todas as obras do cliente</option>
                  {obras.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Se definido, o operador só vê e atua nos funcionários alocados nessa obra.
                </p>
              </div>

              {formError && <p className="text-red-400 text-sm">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
                >
                  {formLoading ? 'Salvando…' : 'Salvar permissões'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
