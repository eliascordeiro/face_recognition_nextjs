'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useClientAuth } from '../layout'
function formatPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2)}`
  return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`
}

export default function ProfilePage() {
  const auth = useClientAuth()
  const [form, setForm] = useState({ fullName: '', phone: '', address: '' })
  const [lat, setLat] = useState<string>('')
  const [lng, setLng] = useState<string>('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  // Pre-fill from auth context once it's available
  useEffect(() => {
    if (auth && !initialized) {
      setForm({
        fullName: auth.fullName ?? '',
        phone: auth.phone ? formatPhone(auth.phone) : '',
        address: auth.address ?? '',
      })
      if (auth.lat != null) setLat(String(auth.lat))
      if (auth.lng != null) setLng(String(auth.lng))
      setInitialized(true)
    }
  }, [auth, initialized])

  async function captureGPS() {
    if (!navigator.geolocation) { setError('GPS não disponível.'); return }
    setGpsLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude.toFixed(8)))
        setLng(String(pos.coords.longitude.toFixed(8)))
        setGpsLoading(false)
      },
      (err) => { setError(`GPS: ${err.message}`); setGpsLoading(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!auth) return
    setError(null)
    setSuccess(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        fullName: form.fullName || null,
        phone: form.phone.replace(/\D/g, '').slice(0, 11) || null,
        address: form.address || null,
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
      }
      const res = await fetch(`/api/users/${auth.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSuccess('Perfil atualizado com sucesso!')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Meu Perfil</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Gerencie os dados da sua empresa
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-5">
        {/* Nome */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nome / Razão social</label>
          <input
            type="text"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            placeholder="Nome da empresa ou responsável"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500 text-slate-100"
          />
        </div>

        {/* Telefone */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Telefone celular</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
            placeholder="99 99999-9999"
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
          <div className="flex items-center justify-between mb-2">
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
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-23.5505"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs focus:outline-none focus:border-sky-500 text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-46.6333"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs focus:outline-none focus:border-sky-500 text-slate-100 font-mono"
              />
            </div>
          </div>
          {lat && lng && (
            <a
              href={`https://maps.google.com/?q=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-sky-500 hover:text-sky-400 mt-1 inline-block"
            >
              ↗ Verificar no Google Maps
            </a>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-emerald-400 text-sm">{success}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
        >
          {saving ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </form>

      {/* Usuário / login info */}
      {auth && (
        <div className="mt-4 bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-2">Informações da conta</p>
          <div className="space-y-1 text-sm">
            <p><span className="text-slate-400">Login:</span> <span className="text-slate-200 font-mono">{auth.username}</span></p>
            <p><span className="text-slate-400">Perfil:</span> <span className="text-slate-200">Cliente</span></p>
            {auth.id && <p><span className="text-slate-400">ID:</span> <span className="text-slate-500 font-mono text-xs">#{auth.id}</span></p>}
          </div>
        </div>
      )}
    </div>
  )
}
