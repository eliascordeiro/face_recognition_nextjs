'use client'

import { FormEvent, useState } from 'react'

export interface ObraFormData {
  id?: number
  name: string
  description: string
  status: string
  startDate: string
  address: string
  lat: string
  lng: string
}

export const OBRA_STATUS: Record<string, { label: string; classes: string; dot: string }> = {
  planning:    { label: 'Planejamento',  classes: 'bg-slate-700/60 border-slate-600 text-slate-300',   dot: 'bg-slate-400' },
  in_progress: { label: 'Em andamento',  classes: 'bg-sky-900/40 border-sky-700 text-sky-300',          dot: 'bg-sky-400' },
  paused:      { label: 'Pausada',       classes: 'bg-amber-900/40 border-amber-700 text-amber-300',    dot: 'bg-amber-400' },
  completed:   { label: 'Concluída',     classes: 'bg-emerald-900/40 border-emerald-700 text-emerald-300', dot: 'bg-emerald-400' },
}

interface Props {
  initial?: ObraFormData
  onClose: () => void
  onSaved: (obra: any) => void
}

export default function ObraFormModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState<ObraFormData>(
    initial ?? { name: '', description: '', status: 'planning', startDate: '', address: '', lat: '', lng: '' }
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [addressAutoFilled, setAddressAutoFilled] = useState(false)

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`)
      const data = await res.json()
      if (res.ok && data.address) {
        setForm((f) => ({ ...f, address: data.address }))
        setAddressAutoFilled(true)
      }
    } catch {
      // Falha silenciosa: usuário pode digitar o endereço manualmente
    }
  }

  function captureGPS() {
    if (!navigator.geolocation) {
      setError('GPS não disponível neste dispositivo.')
      return
    }
    setGpsLoading(true)
    setAddressAutoFilled(false)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setForm((f) => ({
          ...f,
          lat: lat.toFixed(8),
          lng: lng.toFixed(8),
        }))
        await reverseGeocode(lat, lng)
        setGpsLoading(false)
      },
      (err) => {
        setError(`GPS: ${err.message}`)
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.name.trim().length < 2) {
      setError('Informe o nome da obra.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        status: form.status,
        startDate: form.startDate,
        address: form.address,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
      }
      const res = await fetch(isEdit ? `/api/obras/${initial!.id}` : '/api/obras', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Erro ao salvar'); return }
      onSaved(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">
            {isEdit ? '✏️ Editar obra' : '🏗️ Nova obra'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nome da obra *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Residencial Parque Norte"
              required
              autoFocus
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Descrição</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Detalhes principais da obra…"
              rows={3}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              >
                {Object.entries(OBRA_STATUS).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Início previsto</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Endereço</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => { setForm((f) => ({ ...f, address: e.target.value })); setAddressAutoFilled(false) }}
              placeholder="Rua, número, bairro, cidade"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
            />
            {addressAutoFilled && (
              <p className="text-[11px] text-emerald-400 mt-1">📍 Endereço preenchido automaticamente pelo GPS — confira e ajuste se necessário.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-400">Localização GPS</label>
              <button
                type="button"
                onClick={captureGPS}
                disabled={gpsLoading}
                className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50"
              >
                {gpsLoading ? '⏳ Obtendo localização e endereço…' : '📡 Capturar GPS'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="any"
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                placeholder="Latitude"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-sky-500"
              />
              <input
                type="number"
                step="any"
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                placeholder="Longitude"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-sky-500"
              />
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

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg text-sm font-semibold"
            >
              {loading ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar obra'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
