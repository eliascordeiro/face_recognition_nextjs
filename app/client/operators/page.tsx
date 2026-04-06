'use client'

import { useEffect, useState, FormEvent, useCallback } from 'react'
import { useClientAuth } from '../layout'

interface Operator {
  id: number
  username: string
  full_name: string | null
  role: string
  created_at: string
}

type ModalMode = 'create' | 'password' | null

export default function OperatorsPage() {
  const auth = useClientAuth()
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalMode>(null)
  const [selectedOp, setSelectedOp] = useState<Operator | null>(null)
  const [formData, setFormData] = useState({ username: '', password: '', fullName: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)

  const loadOperators = useCallback(async () => {
    const res = await fetch('/api/users')
    if (res.ok) setOperators(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { loadOperators() }, [loadOperators])

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
                <th className="text-left px-4 py-3">Criado em</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {operators.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500 py-6">
                    Nenhum operador cadastrado.
                  </td>
                </tr>
              )}
              {operators.map((op) => (
                <tr key={op.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{op.full_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{op.username}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(op.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
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
    </div>
  )
}
