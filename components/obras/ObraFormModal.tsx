'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

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
  planning:    { label: 'Planejamento',  classes: 'bg-slate-700/60 border-slate-600 text-slate-300',   dot: 'bg-slate-400' },
  in_progress: { label: 'Em andamento',  classes: 'bg-sky-900/40 border-sky-700 text-sky-300',          dot: 'bg-sky-400' },
  paused:      { label: 'Pausada',       classes: 'bg-amber-900/40 border-amber-700 text-amber-300',    dot: 'bg-amber-400' },
  completed:   { label: 'Concluída',     classes: 'bg-emerald-900/40 border-emerald-700 text-emerald-300', dot: 'bg-emerald-400' },
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

function formatCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
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
  const [autoNote, setAutoNote] = useState<string | null>(null)
  const [geoPreviewLoading, setGeoPreviewLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<{ lat: string; lng: string; precision: 'cep' | 'free' } | null>(null)
  const skipNextAutoGeo = useRef(true)

  function applySuggestion() {
    if (!suggestion) return
    setForm((f) => ({ ...f, lat: suggestion.lat, lng: suggestion.lng }))
    setSuggestion(null)
  }

  // Enquanto o usuário completa rua/número/bairro/cidade/UF manualmente,
  // busca (com debounce) as coordenadas do endereço para dar um retorno
  // visual de onde a obra está localizada — sem precisar estar no local.
  //
  // Importante: só substitui a coordenada automaticamente quando o resultado
  // é de alta confiança (rua/número encontrados). Resultados aproximados
  // (nível de CEP/cidade) NUNCA sobrescrevem uma coordenada já definida
  // (ex.: capturada por GPS no local) — ficam disponíveis como sugestão,
  // que o usuário aplica manualmente se quiser.
  useEffect(() => {
    // Não dispara na primeira renderização (edição já vem com dados prontos)
    if (skipNextAutoGeo.current) {
      skipNextAutoGeo.current = false
      return
    }
    // Dispara assim que houver rua + (CEP ou cidade/UF) — não é preciso
    // esperar o campo Cidade ser confirmado quando o CEP já foi informado,
    // já que o CEP sozinho localiza bem a região. Isso permite buscar as
    // coordenadas logo após CEP + Número/Rua serem preenchidos.
    const cepDigits = form.cep.replace(/\D/g, '')
    const hasEnoughInfo =
      form.street.trim().length >= 3 &&
      (cepDigits.length === 8 || (form.city.trim().length >= 2 && form.state.length === 2))
    if (!hasEnoughInfo) {
      setSuggestion(null)
      return
    }

    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        street: form.street,
        number: form.number,
        city: form.city,
        state: form.state,
      })
      if (cepDigits.length === 8) params.set('cep', cepDigits)

      setGeoPreviewLoading(true)
      setSuggestion(null)
      try {
        const res = await fetch(`/api/geocode/forward?${params.toString()}`)
        const data = await res.json()
        if (!res.ok || !data.lat || !data.lng) return

        if (data.precision === 'street') {
          // Alta confiança: já encontrou a rua/número — aplica direto
          setForm((f) => ({ ...f, lat: String(data.lat), lng: String(data.lng) }))
        } else {
          // Baixa confiança (CEP/cidade): sugere, mas não sobrescreve sozinho
          setSuggestion({ lat: String(data.lat), lng: String(data.lng), precision: data.precision })
        }
      } catch {
        // Falha silenciosa — usuário pode capturar via GPS
      } finally {
        setGeoPreviewLoading(false)
      }
    }, 900)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.street, form.number, form.neighborhood, form.city, form.state, form.cep])

  async function lookupCep(rawCep: string) {
    const digits = rawCep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setCepLoading(true)
    setAutoNote(null)
    try {
      const res = await fetch(`/api/geocode/cep?cep=${digits}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'CEP não encontrado'); return }
      setForm((f) => ({
        ...f,
        street: data.street || f.street,
        neighborhood: data.neighborhood || f.neighborhood,
        city: data.city || f.city,
        state: data.state || f.state,
      }))
      setAutoNote('📮 Endereço preenchido a partir do CEP — confira o número e complemente se necessário.')
    } catch {
      setError('Falha ao consultar o CEP.')
    } finally {
      setCepLoading(false)
    }
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`)
      const data = await res.json()
      if (res.ok && data.raw) {
        setForm((f) => ({
          ...f,
          cep: data.raw.postcode ? formatCep(data.raw.postcode) : f.cep,
          street: data.raw.street || f.street,
          number: data.raw.houseNumber || f.number,
          neighborhood: data.raw.neighbourhood || f.neighborhood,
          city: data.raw.city || f.city,
          state: data.raw.state ? data.raw.state.slice(0, 2).toUpperCase() : f.state,
        }))
        setAutoNote('📍 Endereço preenchido automaticamente pelo GPS — confira e ajuste se necessário.')
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
    setAutoNote(null)
    setSuggestion(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        // Evita que o preview automático (debounce) sobrescreva com uma
        // coordenada menos precisa logo após o GPS preencher os campos.
        skipNextAutoGeo.current = true
        setForm((f) => ({ ...f, lat: lat.toFixed(8), lng: lng.toFixed(8) }))
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

          {/* ── Endereço estruturado ──────────────────────────────────── */}
          <div className="pt-1 border-t border-slate-700/70 mt-1">
            <div className="flex items-center justify-between mt-3 mb-1">
              <label className="text-xs text-slate-400">Endereço</label>
              <button
                type="button"
                onClick={captureGPS}
                disabled={gpsLoading}
                className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50"
              >
                {gpsLoading ? '⏳ Obtendo localização…' : '📡 Capturar GPS'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">CEP</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.cep}
                    onChange={(e) => setForm((f) => ({ ...f, cep: formatCep(e.target.value) }))}
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
                  onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
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
                  onChange={(e) => setForm((f) => ({ ...f, neighborhood: e.target.value }))}
                  placeholder="Centro"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">UF</label>
                <select
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
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
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="São Paulo"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-sky-500"
              />
            </div>

            {autoNote && (
              <p className="text-[11px] text-emerald-400 mt-2">{autoNote}</p>
            )}

            {/* Preview de coordenadas — atualiza conforme o endereço é preenchido */}
            <div className="mt-3 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded-lg flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span>🛰️</span>
                {geoPreviewLoading ? (
                  <span className="text-sky-400 animate-pulse">Localizando coordenadas…</span>
                ) : form.lat && form.lng ? (
                  <span className="font-mono text-slate-300">
                    {Number(form.lat).toFixed(6)}, {Number(form.lng).toFixed(6)}
                  </span>
                ) : (
                  <span>Complete o endereço ou capture o GPS para ver as coordenadas</span>
                )}
              </div>
              {form.lat && form.lng && !geoPreviewLoading && (
                <a
                  href={`https://maps.google.com/?q=${form.lat},${form.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sky-500 hover:text-sky-400 whitespace-nowrap"
                >
                  ↗ Ver no mapa
                </a>
              )}
            </div>

            {/* Sugestão de baixa confiança (não encontrou a rua exata) —
                não substitui a coordenada atual sozinha; usuário decide. */}
            {suggestion && !geoPreviewLoading && (
              <div className="mt-2 px-3 py-2 bg-amber-900/20 border border-amber-800/60 rounded-lg flex items-center justify-between gap-2">
                <div className="text-[11px] text-amber-300">
                  ⚠️ Rua não localizada com exatidão — encontrada apenas uma coordenada
                  aproximada {suggestion.precision === 'cep' ? 'da região do CEP/cidade' : 'da busca pelo endereço'}:{' '}
                  <span className="font-mono">{Number(suggestion.lat).toFixed(6)}, {Number(suggestion.lng).toFixed(6)}</span>.
                  {' '}Prefira capturar o GPS no local para maior precisão.
                </div>
                <button
                  type="button"
                  onClick={applySuggestion}
                  className="text-[11px] px-2 py-1 bg-amber-700/60 hover:bg-amber-700 rounded whitespace-nowrap"
                >
                  Usar assim mesmo
                </button>
              </div>
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
