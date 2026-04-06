'use client'

import { useEffect, useState, FormEvent, useCallback } from 'react'
import { useClientAuth } from '../layout'

interface Obra {
  id: number
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  created_at: string
}

type ModalMode = 'create' | 'edit' | null

const emptyForm = { name: '', address: '', lat: '', lng: '' }

export default function ObrasPage() {
  const auth = useClientAuth()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalMode>(null)
  const [selected, setSelected] = useState<Obra | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/obras')
    if (res.ok) setObras(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm(emptyForm)
    setFormError(null)
    setSelected(null)
    setModal('create')
  }

  function openEdit(o: Obra) {
    setSelected(o)
    setForm({
      name: o.name,
      address: o.address ?? '',
      lat: o.lat != null ? String(o.lat) : '',
      lng: o.lng != null ? String(o.lng) : '',
    })
    setFormError(null)
    setModal('edit')
  }

  async function captureGPS() {
    if (!navigator.geolocation) {
      setFormError('GPS não disponível neste dispositivo.')
      return
    }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          lat: String(pos.coords.latitude.toFixed(8)),
          lng: String(pos.coords.longitude.toFixed(8)),
        }))
        setGpsLoading(false)
      },
      (err) => {
        setFormError(`GPS: ${err.message}`)
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        address: form.address || null,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
      }

      const url = modal === 'edit' && selected ? `/api/obras/${selected.id}` : '/api/obras'
      const method = modal === 'edit' ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error); return }

      await load()
      setModal(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Remover a obra "${name}"?`)) return
    await fetch(`/api/obras/${id}`, { method: 'DELETE' })
    setObras((prev) => prev.filter((o) => o.id !== id))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Obras</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {auth?.fullName && <span className="text-slate-300">{auth.fullName} · </span>}
            {obras.length} obra{obras.length !== 1 ? 's' : ''} cadastrada{obras.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Nova obra
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 animate-pulse">Carregando…</div>
      ) : obras.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-slate-700 rounded-xl">
          <p className="text-4xl mb-3">🏗️</p>
          <p className="text-slate-400">Nenhuma obra cadastrada.</p>
          <button
            onClick={openCreate}
            className="mt-4 text-sky-400 hover:text-sky-300 text-sm underline underline-offset-2"
          >
            Cadastrar primeira obra
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {obras.map((o) => (
            <div
              key={o.id}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-100">{o.name}</p>
                {o.address && (
                  <p className="text-sm text-slate-400 mt-0.5 truncate">📍 {o.address}</p>
                )}
                {o.lat != null && o.lng != null && (
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    GPS: {Number(o.lat).toFixed(6)}, {Number(o.lng).toFixed(6)}
                    {' '}
                    <a
                      href={`https://maps.google.com/?q=${o.lat},${o.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-500 hover:text-sky-400 ml-1"
                    >
                      ver mapa ↗
                    </a>
                  </p>
                )}
                <p className="text-xs text-slate-600 mt-1">
                  Cadastrado em {new Date(o.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => openEdit(o)}
                  className="text-sky-400 hover:text-sky-300 text-xs px-2 py-1 rounded hover:bg-sky-900/30"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(o.id, o.name)}
                  className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-900/30"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criação / edição */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {modal === 'edit' ? 'Editar obra' : 'Nova obra'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nome da obra *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Residencial Parque Norte"
                  required
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500 text-slate-100"
                />
              </div>

              {/* Endereço */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Endereço</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Rua, número, bairro, cidade"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500 text-slate-100"
                />
              </div>

              {/* GPS */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Localização GPS</label>
                  <button
                    type="button"
                    onClick={captureGPS}
                    disabled={gpsLoading}
                    className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50"
                  >
                    {gpsLoading ? '⏳ Obtendo…' : '📡 Capturar GPS'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={form.lat}
                      onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                      placeholder="-23.5505"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs focus:outline-none focus:border-sky-500 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={form.lng}
                      onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                      placeholder="-46.6333"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs focus:outline-none focus:border-sky-500 text-slate-100 font-mono"
                    />
                  </div>
                </div>
                {form.lat && form.lng && (
                  <a
                    href={`https://maps.google.com/?q=${form.lat},${form.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-sky-500 hover:text-sky-400 mt-1 inline-block"
                  >
                    ↗ Verificar no Google Maps
                  </a>
                )}
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
                  disabled={saving}
                  className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
                >
                  {saving ? 'Salvando…' : modal === 'edit' ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
