'use client'

import { useEffect, useMemo, useState } from 'react'

interface EmployeeRequest {
  id: number
  type: 'advance' | 'occurrence' | 'absence' | 'material_request'
  title: string
  description: string | null
  amount_cents: number | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  manager_note: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  employee_id: number
  employee_name: string
  obra_id: number | null
  obra_name: string | null
}

interface ManagerNotification {
  id: number
  request_id: number | null
  title: string
  message: string
  is_read: boolean
  created_at: string
}

interface ApiPayload {
  requests: EmployeeRequest[]
  notifications: ManagerNotification[]
  unreadCount: number
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'rejected', label: 'Rejeitadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
]

function typeLabel(type: EmployeeRequest['type']) {
  if (type === 'advance') return 'Adiantamento'
  if (type === 'occurrence') return 'Ocorrência'
  if (type === 'absence') return 'Ausência'
  return 'Material'
}

function statusLabel(status: EmployeeRequest['status']) {
  if (status === 'pending') return 'Pendente'
  if (status === 'approved') return 'Aprovada'
  if (status === 'rejected') return 'Rejeitada'
  return 'Cancelada'
}

function statusBadgeClass(status: EmployeeRequest['status']) {
  if (status === 'pending') return 'bg-amber-900/50 text-amber-300 border-amber-700'
  if (status === 'approved') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700'
  if (status === 'rejected') return 'bg-rose-900/40 text-rose-300 border-rose-700'
  return 'bg-slate-800 text-slate-300 border-slate-600'
}

function formatMoney(cents: number | null) {
  if (cents == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function ClientRequestsPage() {
  const [statusFilter, setStatusFilter] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<ApiPayload>({ requests: [], notifications: [], unreadCount: 0 })
  const [noteByRequest, setNoteByRequest] = useState<Record<number, string>>({})

  async function loadData() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/client/employee-requests?status=${statusFilter}`)
    const data = await res.json().catch(() => null) as ApiPayload | { error?: string } | null
    if (!res.ok || !data || !('requests' in data)) {
      setLoading(false)
      setError((data && 'error' in data && typeof data.error === 'string') ? data.error : 'Falha ao carregar solicitações')
      return
    }
    setPayload(data)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [statusFilter])

  const summary = useMemo(() => {
    const grouped = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
    for (const item of payload.requests) grouped[item.status] += 1
    return grouped
  }, [payload.requests])

  async function updateRequestStatus(requestId: number, status: 'approved' | 'rejected') {
    setSavingId(requestId)
    setError(null)
    const managerNote = (noteByRequest[requestId] ?? '').trim()
    const res = await fetch('/api/client/employee-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, status, managerNote: managerNote || null }),
    })
    const data = await res.json().catch(() => null) as { error?: string } | null
    if (!res.ok) {
      setError(data?.error ?? 'Falha ao atualizar solicitação')
      setSavingId(null)
      return
    }
    await loadData()
    setSavingId(null)
  }

  async function markAllNotificationsAsRead() {
    const unreadIds = payload.notifications.filter((item) => !item.is_read).map((item) => item.id)
    if (unreadIds.length === 0) return
    await fetch('/api/client/employee-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markNotificationReadIds: unreadIds }),
    })
    await loadData()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Solicitações da equipe</h1>
          <p className="text-slate-400 text-sm mt-1">Aprove adiantamentos e acompanhe ocorrências dos funcionários.</p>
        </div>
        <button
          type="button"
          onClick={markAllNotificationsAsRead}
          className="rounded-lg px-4 py-2 text-sm bg-slate-800 border border-slate-700 hover:bg-slate-700"
        >
          Marcar notificações como lidas ({payload.unreadCount})
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4"><p className="text-xs text-slate-400">Pendentes</p><p className="text-xl font-semibold text-amber-300 mt-1">{summary.pending}</p></div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4"><p className="text-xs text-slate-400">Aprovadas</p><p className="text-xl font-semibold text-emerald-300 mt-1">{summary.approved}</p></div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4"><p className="text-xs text-slate-400">Rejeitadas</p><p className="text-xl font-semibold text-rose-300 mt-1">{summary.rejected}</p></div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4"><p className="text-xs text-slate-400">Canceladas</p><p className="text-xl font-semibold text-slate-300 mt-1">{summary.cancelled}</p></div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <label className="block text-xs text-slate-400 mb-1">Filtro de status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="rounded-xl border border-rose-800 bg-rose-950/30 text-rose-200 p-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-3">
          {loading ? (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 text-sm text-slate-400">Carregando solicitações...</div>
          ) : payload.requests.length === 0 ? (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 text-sm text-slate-400">Nenhuma solicitação encontrada.</div>
          ) : payload.requests.map((item) => (
            <div key={item.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-slate-100 font-semibold">{item.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{typeLabel(item.type)} • {item.employee_name} • {item.obra_name ?? 'Sem obra'}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${statusBadgeClass(item.status)}`}>
                  {statusLabel(item.status)}
                </span>
              </div>

              {item.description && <p className="text-sm text-slate-300 whitespace-pre-wrap">{item.description}</p>}

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span>Valor: <strong className="text-slate-200">{formatMoney(item.amount_cents)}</strong></span>
                <span>Criada em {new Date(item.created_at).toLocaleString('pt-BR')}</span>
                {item.resolved_at && <span>Resolvida em {new Date(item.resolved_at).toLocaleString('pt-BR')}</span>}
              </div>

              {item.status === 'pending' && (
                <div className="space-y-2">
                  <textarea
                    value={noteByRequest[item.id] ?? ''}
                    onChange={(e) => setNoteByRequest((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    rows={2}
                    placeholder="Observação para o funcionário (opcional)"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={savingId === item.id}
                      onClick={() => updateRequestStatus(item.id, 'approved')}
                      className="rounded-lg px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      disabled={savingId === item.id}
                      onClick={() => updateRequestStatus(item.id, 'rejected')}
                      className="rounded-lg px-4 py-2 text-sm bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              )}

              {item.manager_note && (
                <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Retorno do gestor</p>
                  <p className="text-sm text-slate-200 mt-1 whitespace-pre-wrap">{item.manager_note}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 h-fit">
          <h2 className="text-slate-100 font-semibold mb-3">Notificações</h2>
          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {payload.notifications.length === 0 && (
              <p className="text-xs text-slate-500">Sem notificações recentes.</p>
            )}
            {payload.notifications.map((item) => (
              <div key={item.id} className={`rounded-lg border p-3 ${item.is_read ? 'border-slate-700 bg-slate-900/40' : 'border-sky-700 bg-sky-950/20'}`}>
                <p className="text-sm text-slate-100 font-medium">{item.title}</p>
                <p className="text-xs text-slate-300 mt-1">{item.message}</p>
                <p className="text-[11px] text-slate-500 mt-2">{new Date(item.created_at).toLocaleString('pt-BR')}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
