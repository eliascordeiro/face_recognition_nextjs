'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type FaceApiType = typeof import('face-api.js')

interface EmployeeMe {
  id: number
  fullName: string
  email: string | null
  phone: string | null
  roleName: string | null
  obraId: string | null
  obraName: string | null
  clientId: string | null
}

interface CheckinRecord {
  id: number
  checkin_at: string
  checkout_at: string | null
  checkin_lat: number | null
  checkin_lng: number | null
  checkout_lat: number | null
  checkout_lng: number | null
  notes?: string | null
}

export default function EmployeeHomePage() {
  const router = useRouter()
  const [me, setMe] = useState<EmployeeMe | null>(null)
  const [openCheckin, setOpenCheckin] = useState<CheckinRecord | null>(null)
  const [history, setHistory] = useState<CheckinRecord[]>([])
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null)
  const [faceReady, setFaceReady] = useState(false)
  const [faceLoading, setFaceLoading] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [showFacePanel, setShowFacePanel] = useState(false)
  const [loading, setLoading] = useState(true)

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [faceapi, setFaceapi] = useState<FaceApiType | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/employee/auth/me'),
      fetch('/api/employee/checkins'),
    ])
      .then(async ([meRes, checkinRes]) => {
        if (!meRes.ok) {
          router.replace('/employee/login')
          return
        }
        setMe(await meRes.json())

        if (checkinRes.ok) {
          const data = await checkinRes.json()
          setOpenCheckin(data.openCheckin ?? null)
          setHistory(Array.isArray(data.history) ? data.history : [])
        }
      })
      .finally(() => setLoading(false))
  }, [router])

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [stream])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const faceApiModule = await import('face-api.js')
        await Promise.all([
          faceApiModule.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceApiModule.nets.faceLandmark68Net.loadFromUri('/models'),
          faceApiModule.nets.faceRecognitionNet.loadFromUri('/models'),
        ])
        if (!cancelled) {
          setFaceapi(faceApiModule)
          setFaceReady(true)
        }
      } catch {
        if (!cancelled) setFaceReady(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function ensureCameraOn() {
    if (stream) return true
    if (!navigator.geolocation) {
      // noop; handled elsewhere. Keep camera independent of geolocation support.
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (videoEl) videoEl.srcObject = media
      setStream(media)
      setCameraOn(true)
      return true
    } catch {
      setCheckinMessage('Não foi possível acessar a câmera para confirmar sua identidade.')
      return false
    }
  }

  async function captureFaceDescriptor(): Promise<number[] | null> {
    if (!faceapi || !videoEl || !canvasEl) return null
    const ok = await ensureCameraOn()
    if (!ok) return null

    setFaceLoading(true)
    try {
      const detection = await faceapi
        .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        setCheckinMessage('Nenhum rosto detectado. Centralize seu rosto e tente novamente.')
        return null
      }

      canvasEl.width = videoEl.videoWidth
      canvasEl.height = videoEl.videoHeight
      const ctx = canvasEl.getContext('2d')
      if (ctx) ctx.drawImage(videoEl, 0, 0)

      return Array.from(detection.descriptor)
    } finally {
      setFaceLoading(false)
    }
  }

  function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    if (!navigator.geolocation) return Promise.resolve(null)
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: Number(pos.coords.latitude.toFixed(8)),
            lng: Number(pos.coords.longitude.toFixed(8)),
          })
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 9000 }
      )
    })
  }

  async function refreshCheckins() {
    const res = await fetch('/api/employee/checkins')
    if (!res.ok) return
    const data = await res.json()
    setOpenCheckin(data.openCheckin ?? null)
    setHistory(Array.isArray(data.history) ? data.history : [])
  }

  async function registerCheckin() {
    setCheckinLoading(true)
    setCheckinMessage(null)
    const coords = await getCurrentPosition()
    const embedding = await captureFaceDescriptor()
    if (!embedding) {
      setCheckinLoading(false)
      return
    }
    try {
      const res = await fetch('/api/employee/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: me?.email,
          embedding,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCheckinMessage(data.error ?? 'Não foi possível registrar entrada')
        return
      }
      setCheckinMessage('Entrada registrada com sucesso.')
      await refreshCheckins()
    } catch {
      setCheckinMessage('Erro de conexão ao registrar entrada')
    } finally {
      setCheckinLoading(false)
    }
  }

  async function registerCheckout() {
    setCheckinLoading(true)
    setCheckinMessage(null)
    const coords = await getCurrentPosition()
    const embedding = await captureFaceDescriptor()
    if (!embedding) {
      setCheckinLoading(false)
      return
    }
    try {
      const res = await fetch('/api/employee/checkins/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: me?.email,
          embedding,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCheckinMessage(data.error ?? 'Não foi possível registrar saída')
        return
      }
      setCheckinMessage('Saída registrada com sucesso.')
      await refreshCheckins()
    } catch {
      setCheckinMessage('Erro de conexão ao registrar saída')
    } finally {
      setCheckinLoading(false)
    }
  }

  function formatDateTime(value: string | null) {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/employee/login')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        Carregando portal do funcionário…
      </div>
    )
  }

  return (
    <div className="min-h-screen app-shell px-4 py-5">
      <div className="max-w-md mx-auto space-y-4">
        <div className="auth-panel p-4">
          <p className="text-xs text-sky-300 uppercase tracking-[0.2em]">Portal do funcionário</p>
          <h1 className="text-2xl font-semibold text-white mt-1">Olá, {me?.fullName?.split(' ')[0] ?? 'Funcionário'}</h1>
          <p className="text-slate-300 text-sm mt-1">Serviços mobile para o dia a dia da obra.</p>

          <div className="mt-4 space-y-2 text-sm text-slate-300">
            <p>📧 {me?.email ?? 'E-mail não informado'}</p>
            <p>📞 {me?.phone ?? 'Telefone não informado'}</p>
            <p>🏗️ {me?.obraName ?? 'Sem obra vinculada'}</p>
            <p>🛠️ {me?.roleName ?? 'Função não informada'}</p>
          </div>
        </div>

        <div className="auth-panel p-4 space-y-3">
          <h2 className="text-white font-semibold">Serviços</h2>

          <button
            type="button"
            onClick={() => {
              setShowFacePanel((v) => {
                const next = !v
                if (!next && stream) {
                  stream.getTracks().forEach((t) => t.stop())
                  setStream(null)
                  setCameraOn(false)
                }
                return next
              })
            }}
            className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2 text-left"
          >
            <p className="text-slate-100 text-sm font-medium">🛡️ Confirmação facial para presença</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {faceReady ? (cameraOn ? 'Câmera pronta para validação' : 'Toque para preparar a câmera') : 'Carregando modelos de IA...'}
            </p>
          </button>

          {showFacePanel && (
            <div className="rounded-xl border border-slate-600 bg-slate-800/60 px-3 py-3 space-y-2">
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video
                  ref={(el) => setVideoEl(el)}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {!cameraOn && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
                    Câmera desligada
                  </div>
                )}
              </div>
              <canvas ref={(el) => setCanvasEl(el)} className="hidden" />
              <button
                type="button"
                onClick={ensureCameraOn}
                disabled={!faceReady || faceLoading}
                className="w-full rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 py-2 text-sm font-semibold"
              >
                {cameraOn ? 'Câmera pronta' : 'Ligar câmera'}
              </button>
            </div>
          )}

          <div className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3">
            <p className="text-slate-100 font-medium">📍 Presença na obra</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {openCheckin
                ? `Entrada ativa desde ${formatDateTime(openCheckin.checkin_at)}`
                : 'Nenhuma entrada ativa no momento'}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {!openCheckin ? (
                <button
                  type="button"
                  onClick={registerCheckin}
                  disabled={checkinLoading || faceLoading || !faceReady || !cameraOn || !me?.email}
                  className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-2 text-sm font-semibold"
                >
                  {checkinLoading ? 'Registrando…' : 'Registrar entrada'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={registerCheckout}
                  disabled={checkinLoading || faceLoading || !faceReady || !cameraOn || !me?.email}
                  className="w-full rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2 text-sm font-semibold"
                >
                  {checkinLoading ? 'Registrando…' : 'Registrar saída'}
                </button>
              )}
            </div>
            {checkinMessage && (
              <p className="text-xs text-slate-300 mt-2">{checkinMessage}</p>
            )}
          </div>

          <button
            type="button"
            className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3 text-left"
          >
            <p className="text-slate-100 font-medium">📝 Solicitações e ocorrências</p>
            <p className="text-xs text-slate-400 mt-0.5">Em breve</p>
          </button>

          <button
            type="button"
            className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3 text-left"
          >
            <p className="text-slate-100 font-medium">📎 Documentos da equipe</p>
            <p className="text-xs text-slate-400 mt-0.5">Em breve</p>
          </button>
        </div>

        <div className="auth-panel p-4 space-y-2">
          <h2 className="text-white font-semibold">Últimas batidas</h2>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">Nenhum registro ainda.</p>
          ) : (
            history.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                <p className="text-sm text-slate-200">Entrada: {formatDateTime(item.checkin_at)}</p>
                <p className="text-xs text-slate-400">Saída: {formatDateTime(item.checkout_at)}</p>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={logout}
          className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 py-2.5 rounded-lg font-semibold"
        >
          Sair
        </button>
      </div>
    </div>
  )
}
