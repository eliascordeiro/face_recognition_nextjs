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

interface FaceMetricsScenario {
  scenario: 'checkin' | 'checkout' | 'employee_login' | 'recognize'
  label: string
  envVar: string
  currentThreshold: number
  suggestedThreshold: number | null
  events: number
  accepted: number
  rejected: number
  acceptanceRate: number
  avgDistance: number | null
  medianDistance: number | null
  p90Distance: number | null
  p95Distance: number | null
  avgConfidence: number | null
  reasons: Array<{ reason: string; count: number }>
}

interface FaceMetricsResponse {
  windowDays: number
  totals: {
    events: number
    accepted: number
    acceptanceRate: number
  }
  scenarios: FaceMetricsScenario[]
  recentEvents: Array<{
    id: number
    scenario: string
    accepted: boolean
    distance: number | null
    threshold: number | null
    confidencePercent: number | null
    reason: string | null
    createdAt: string
  }>
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
  const [faceMetricsDays, setFaceMetricsDays] = useState(14)
  const [faceMetricsLoading, setFaceMetricsLoading] = useState(false)
  const [faceMetricsError, setFaceMetricsError] = useState<string | null>(null)
  const [faceMetrics, setFaceMetrics] = useState<FaceMetricsResponse | null>(null)

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

  useEffect(() => {
    if (authUser?.role !== 'admin') return
    let cancelled = false

    async function loadFaceMetrics() {
      setFaceMetricsLoading(true)
      setFaceMetricsError(null)

      try {
        const res = await fetch(`/api/admin/face-metrics?days=${faceMetricsDays}`)
        const data = await res.json().catch(() => null) as FaceMetricsResponse | { error?: string } | null

        if (cancelled) return
        if (!res.ok || !data || !('scenarios' in data)) {
          setFaceMetrics(null)
          setFaceMetricsError((data && 'error' in data && typeof data.error === 'string') ? data.error : 'Falha ao carregar métricas faciais')
          setFaceMetricsLoading(false)
          return
        }

        setFaceMetrics(data)
        setFaceMetricsLoading(false)
      } catch {
        if (cancelled) return
        setFaceMetrics(null)
        setFaceMetricsError('Falha ao carregar métricas faciais')
        setFaceMetricsLoading(false)
      }
    }

    loadFaceMetrics()
    return () => { cancelled = true }
  }, [authUser?.role, faceMetricsDays])

  function formatDistance(value: number | null) {
    if (value == null || !Number.isFinite(value)) return '—'
    return value.toFixed(4)
  }

  function formatReason(reason: string) {
    const labels: Record<string, string> = {
      ok: 'Aprovado',
      geo_out_of_range: 'Fora do raio da obra',
      face_not_enabled: 'Face não habilitada',
      face_distance_above_threshold: 'Distância acima do limiar',
      face_distance_invalid: 'Distância inválida',
    }
    return labels[reason] ?? reason
  }

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

        <section className="mt-10">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-xl font-semibold">Diagnóstico facial operacional</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Janela</label>
              <select
                value={String(faceMetricsDays)}
                onChange={(e) => setFaceMetricsDays(Number(e.target.value))}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              >
                <option value="7">7 dias</option>
                <option value="14">14 dias</option>
                <option value="30">30 dias</option>
                <option value="60">60 dias</option>
                <option value="90">90 dias</option>
              </select>
            </div>
          </div>

          {faceMetricsLoading && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 text-sm text-slate-400">
              Carregando métricas faciais...
            </div>
          )}

          {!faceMetricsLoading && faceMetricsError && (
            <div className="bg-red-950/30 border border-red-900 rounded-xl p-5 text-sm text-red-300">
              {faceMetricsError}
            </div>
          )}

          {!faceMetricsLoading && !faceMetricsError && faceMetrics && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-400">Eventos analisados</p>
                  <p className="text-2xl font-semibold mt-1">{faceMetrics.totals.events}</p>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-400">Aprovações</p>
                  <p className="text-2xl font-semibold mt-1">{faceMetrics.totals.accepted}</p>
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <p className="text-xs text-slate-400">Taxa de aprovação</p>
                  <p className="text-2xl font-semibold mt-1">{faceMetrics.totals.acceptanceRate.toFixed(1)}%</p>
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead className="bg-slate-700/50 text-slate-300">
                    <tr>
                      <th className="text-left px-4 py-3">Cenário</th>
                      <th className="text-right px-4 py-3">Eventos</th>
                      <th className="text-right px-4 py-3">Aprovação</th>
                      <th className="text-right px-4 py-3">Threshold atual</th>
                      <th className="text-right px-4 py-3">Threshold sugerido</th>
                      <th className="text-right px-4 py-3">Média dist.</th>
                      <th className="text-right px-4 py-3">P95 dist.</th>
                      <th className="text-right px-4 py-3">Conf. média</th>
                      <th className="text-left px-4 py-3">Principais motivos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {faceMetrics.scenarios.map((item) => (
                      <tr key={item.scenario} className="hover:bg-slate-700/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{item.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{item.envVar}</p>
                        </td>
                        <td className="px-4 py-3 text-right">{item.events}</td>
                        <td className="px-4 py-3 text-right">{item.acceptanceRate.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right">{item.currentThreshold.toFixed(4)}</td>
                        <td className="px-4 py-3 text-right">
                          {item.suggestedThreshold != null ? (
                            <span className="text-amber-300 font-medium">{item.suggestedThreshold.toFixed(4)}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">{formatDistance(item.avgDistance)}</td>
                        <td className="px-4 py-3 text-right">{formatDistance(item.p95Distance)}</td>
                        <td className="px-4 py-3 text-right">{item.avgConfidence != null ? `${item.avgConfidence.toFixed(1)}%` : '—'}</td>
                        <td className="px-4 py-3">
                          {item.reasons.length === 0 && <span className="text-slate-500">Sem dados</span>}
                          {item.reasons.map((reason) => (
                            <div key={`${item.scenario}-${reason.reason}`} className="text-xs text-slate-300">
                              {formatReason(reason.reason)}: {reason.count}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-3">Últimos eventos faciais</h3>
                {faceMetrics.recentEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum evento na janela selecionada.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {faceMetrics.recentEvents.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs"
                      >
                        <p className="text-slate-200">
                          {new Date(event.createdAt).toLocaleString('pt-BR')} | {event.scenario} | {event.accepted ? 'aprovado' : 'rejeitado'}
                        </p>
                        <p className="text-slate-400 mt-0.5">
                          distância={event.distance != null ? event.distance.toFixed(4) : '—'} | limiar={event.threshold != null ? event.threshold.toFixed(4) : '—'} | confiança={event.confidencePercent != null ? `${event.confidencePercent}%` : '—'} | motivo={formatReason(event.reason ?? 'unknown')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
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
