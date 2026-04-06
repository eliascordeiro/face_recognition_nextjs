'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface Client {
  id: number
  username: string
  full_name: string | null
  role: string
  created_at: string
}

interface AuthUser {
  id: string
  username: string
  role: string
}

type ModalMode = 'create' | 'password' | null

export default function AdminPage() {
  const router = useRouter()
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalMode>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [formData, setFormData] = useState({ username: '', password: '', fullName: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)

  async function loadData() {
    const [meRes, usersRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/users'),
    ])
    if (!meRes.ok) { router.replace('/login'); return }
    setAuthUser(await meRes.json())
    if (usersRes.ok) setClients(await usersRes.json())
    setLoading(false)
  }

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  async function deleteClient(id: number) {
    if (!confirm('Remover este cliente e todos seus operadores e funcionários?')) return
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleCreateClient(e: FormEvent) {
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
      setClients((prev) => [...prev, data])
      setModal(null)
      setFormData({ username: '', password: '', fullName: '' })
    } finally {
      setFormLoading(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (!selectedClient) return
    setFormError(null)
    setFormLoading(true)
    try {
      const res = await fetch(`/api/users/${selectedClient.id}`, {
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

  function openPassword(client: Client) {
    setSelectedClient(client)
    setFormData({ username: client.username, password: '', fullName: client.full_name ?? '' })
    setFormError(null)
    setModal('password')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Carregando…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-lg">🛡️ Painel Admin</span>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span>👤 {authUser?.username}</span>
          <button
            onClick={logout}
            className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg transition-colors"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Clientes da plataforma</h2>
          <button
            onClick={openCreate}
            className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Novo cliente
          </button>
        </div>

        {/* Tabela de clientes */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/50 text-slate-300">
              <tr>
                <th className="text-left px-4 py-3">Empresa</th>
                <th className="text-left px-4 py-3">Login</th>
                <th className="text-left px-4 py-3">Criado em</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {clients.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500 py-6">
                    Nenhum cliente cadastrado.
                  </td>
                </tr>
              )}
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.full_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{c.username}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => openPassword(c)}
                      className="text-sky-400 hover:text-sky-300 text-xs px-2 py-1 rounded hover:bg-sky-900/30"
                    >
                      Senha
                    </button>
                    <button
                      onClick={() => deleteClient(c.id)}
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
      </main>

      {/* Modal: Criar cliente */}
      {modal === 'create' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-4">Novo cliente</h3>
            <form onSubmit={handleCreateClient} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome da empresa</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData((d) => ({ ...d, fullName: e.target.value }))}
                  placeholder="Ex: Empresa XYZ"
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
              {formError && (
                <p className="text-red-400 text-sm">{formError}</p>
              )}
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
      {modal === 'password' && selectedClient && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-1">Alterar senha</h3>
            <p className="text-slate-400 text-sm mb-4">{selectedClient.full_name || selectedClient.username}</p>
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
