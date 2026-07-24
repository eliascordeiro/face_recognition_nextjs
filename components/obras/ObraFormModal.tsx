'use client'

import { FormEvent, useState } from 'react'

export interface ObraFormData {
  id?: number
  name: string
  description: string
  status: string
  startDate: string
  cep: string
  street: string
  number: string
  neighborhood: string
  city: string
  state: string
  lat: string
  lng: string
}

export const OBRA_STATUS: Record<string, { label: string; classes: string; dot: string }> = {
  planning: { label: 'Planejamento', classes: 'bg-slate-700/60 border-slate-600 text-slate-300', dot: 'bg-slate-400' },
  in_progress: { label: 'Em andamento', classes: 'bg-sky-900/40 border-sky-700 text-sky-300', dot: 'bg-sky-400' },
  paused: { label: 'Pausada', classes: 'bg-amber-900/40 border-amber-700 text-amber-300', dot: 'bg-amber-400' },
  completed: { label: 'Concluída', classes: 'bg-emerald-900/40 border-emerald-700 text-emerald-300', dot: 'bg-emerald-400' },
}

const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const emptyForm: ObraFormData = {
  name: '', description: '', status: 'planning', startDate: '',
  cep: '', street: '', number: '', neighborhood: '', city: '', state: '',
  lat: '', lng: '',
}

function formatCep(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

interface Props {
  initial?: ObraFormData
  onClose: () => void
  onSaved: (obra: any) => void
}

export default function ObraFormModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState<ObraFormData>(initial ?? emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)

  async function lookupCep(rawCep: string) {
    const digits = rawCep.replace(/\D/g, '')
    if (digits.length !== 8) return

    setCepLoading(true)
    try {
      const res = await fetch(`/api/geocode/cep?cep=${digits}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'CEP não encontrado')
        return
      }

      setForm((current) => ({
        ...current,
        street: data.street || current.street,
        neighborhood: data.neighborhood || current.neighborhood,
        city: data.city || current.city,
        state: data.state || current.state,
      }))
    } catch {
      setError('Falha ao consultar o CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  function captureGPS() {
    if (!navigator.geolocation) {
      setError('GPS não disponível neste dispositivo.')
      return
    }

    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setForm((current) => ({ ...current, lat: lat.toFixed(8), lng: lng.toFixed(8) }))
        setGpsLoading(false)
      },
      (geoError) => {
        setError(`GPS: ${geoError.message}`)
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
        cep: form.cep,
        street: form.street,
        number: form.number,
        neighborhood: form.neighborhood,
        city: form.city,
        state: form.state,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
      }

      const res = await fetch(isEdit ? `/api/obras/${initial!.id}` : '/api/obras', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erro ao salvar')
        return
      }
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
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
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
              onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
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
                onChange={(e) => setForm((current) => ({ ...current, status: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              >
                {Object.entries(OBRA_STATUS).map(([key, status]) => (
                  <option key={key} value={key}>{status.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Início previsto</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((current) => ({ ...current, startDate: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="pt-1 border-t border-slate-700/70 mt-1">
            <div className="mt-3 mb-3">
              <label className="text-xs text-slate-400">Endereço</label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">CEP</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.cep}
                    onChange={(e) => setForm((current) => ({ ...current, cep: formatCep(e.target.value) }))}
                    onBlur={(e) => lookupCep(e.target.value)}
                    placeholder="00000-000"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm font-mono focus:outline-none focus:border-sky-500"
                  />
                  {cepLoading && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-sky-400 animate-pulse">⏳</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Número</label>
                <input
                  type="text"
                  value={form.number}
                  onChange={(e) => setForm((current) => ({ ...current, number: e.target.value }))}
                  placeholder="123"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-[11px] text-slate-500 mb-1">Rua / Avenida</label>
              <input
                type="text"
                value={form.street}
                onChange={(e) => setForm((current) => ({ ...current, street: e.target.value }))}
                placeholder="Rua das Flores"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1">Bairro</label>
                <input
                  type="text"
                  value={form.neighborhood}
                  onChange={(e) => setForm((current) => ({ ...current, neighborhood: e.target.value }))}
                  placeholder="Centro"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">UF</label>
                <select
                  value={form.state}
                  onChange={(e) => setForm((current) => ({ ...current, state: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                >
                  <option value="">--</option>
                  {UF_LIST.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-[11px] text-slate-500 mb-1">Cidade</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))}
                placeholder="São Paulo"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="pt-1 border-t border-slate-700/70 mt-1">
            <div className="flex items-center justify-between mt-3 mb-2 gap-3">
              <label className="text-xs text-slate-400">Localização GPS</label>
              <button
                type="button"
                onClick={captureGPS}
                disabled={gpsLoading}
                className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50 whitespace-nowrap"
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
                  onChange={(e) => setForm((current) => ({ ...current, lat: e.target.value }))}
                  placeholder="-23.5505"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={form.lng}
                  onChange={(e) => setForm((current) => ({ ...current, lng: e.target.value }))}
                  placeholder="-46.6333"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-sky-500"
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
