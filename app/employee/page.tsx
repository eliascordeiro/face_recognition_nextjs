'use client'

import { useCallback, useEffect, useState } from 'react'
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
  obra_name: string | null
  attachments: Array<{
    id: number
    url: string
    publicId: string
    originalFilename: string | null
    mimeType: string | null
    format: string | null
    bytes: number | null
    width: number | null
    height: number | null
    createdAt: string
  }>
  events: Array<{
    id: number
    eventType: string
    message: string
    actorRole: string | null
    createdAt: string
    metadata?: Record<string, unknown> | null
  }>
}

type EmployeeTab = 'services' | 'requests' | 'history'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
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
  const [activeTab, setActiveTab] = useState<EmployeeTab>('services')
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosInstallHint, setShowIosInstallHint] = useState(false)

  const [requestLoading, setRequestLoading] = useState(false)
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [requestUpdateNotice, setRequestUpdateNotice] = useState<string | null>(null)
  const [requestLastSync, setRequestLastSync] = useState<string | null>(null)
  const [requests, setRequests] = useState<EmployeeRequest[]>([])
  const [requestAttachments, setRequestAttachments] = useState<EmployeeRequest['attachments']>([])
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [requestForm, setRequestForm] = useState({
    type: 'advance' as EmployeeRequest['type'],
    title: '',
    amount: '',
    description: '',
  })

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
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase()
    const isIos = /iphone|ipad|ipod/.test(ua)
    const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
    const displayStandalone = window.matchMedia('(display-mode: standalone)').matches
    setShowIosInstallHint(isIos && !iosStandalone && !displayStandalone)
  }, [])

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

  useEffect(() => {
    if (!me) return
    loadRequests()
  }, [me?.id])

  async function ensureCameraOn() {
    if (stream) return true
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

  const loadRequests = useCallback(async () => {
    setRequestLoading(true)
    try {
      const res = await fetch('/api/employee/requests')
      const data = await res.json().catch(() => null) as EmployeeRequest[] | { error?: string } | null
      if (!res.ok || !Array.isArray(data)) {
        setRequestMessage((data && !Array.isArray(data) && typeof data.error === 'string') ? data.error : 'Falha ao carregar solicitações.')
        setRequests([])
        return
      }

      let statusTransitions: string[] = []
      setRequests((previous) => {
        const previousById = new Map(previous.map((item) => [item.id, item]))
        statusTransitions = data
          .map((item) => {
            const before = previousById.get(item.id)
            if (!before || before.status === item.status) return null
            return `${item.title} foi ${formatRequestStatus(item.status).toLowerCase()}`
          })
          .filter((value): value is string => Boolean(value))
        return data
      })

      if (statusTransitions.length > 0) {
        setRequestUpdateNotice(statusTransitions.slice(0, 2).join(' • '))
      }

      setRequestLastSync(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    } finally {
      setRequestLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me) return

    if (typeof EventSource === 'undefined') {
      const timer = globalThis.setInterval(() => {
        void loadRequests()
      }, 25000)
      return () => globalThis.clearInterval(timer)
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let eventSource: EventSource | null = null
    let closed = false

    const connect = () => {
      if (closed) return

      eventSource = new EventSource('/api/employee/requests/stream')
      eventSource.addEventListener('requests-updated', () => {
        void loadRequests()
      })
      eventSource.onerror = () => {
        eventSource?.close()
        if (!closed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connect()
          }, 5000)
        }
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      eventSource?.close()
    }
  }, [me?.id, loadRequests])

  async function uploadRequestAttachment(file: File) {
    const body = new FormData()
    body.append('file', file)

    const res = await fetch('/api/employee/requests/upload', {
      method: 'POST',
      body,
    })
    const data = await res.json().catch(() => null) as
      | { error?: string; url?: string; publicId?: string; format?: string | null; bytes?: number | null; width?: number | null; height?: number | null; originalFilename?: string | null; mimeType?: string | null }
      | null

    if (!res.ok || !data?.url || !data.publicId) {
      throw new Error((data && typeof data.error === 'string' ? data.error : null) ?? 'Falha ao enviar anexo')
    }

    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      url: data.url,
      publicId: data.publicId,
      originalFilename: data.originalFilename ?? file.name,
      mimeType: data.mimeType ?? file.type,
      format: data.format ?? null,
      bytes: typeof data.bytes === 'number' ? data.bytes : null,
      width: typeof data.width === 'number' ? data.width : null,
      height: typeof data.height === 'number' ? data.height : null,
      createdAt: new Date().toISOString(),
    }
  }

  async function handleRequestAttachmentsChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    setAttachmentUploading(true)
    setRequestMessage(null)
    try {
      const uploaded: EmployeeRequest['attachments'] = []
      for (const file of files.slice(0, 3 - requestAttachments.length)) {
        uploaded.push(await uploadRequestAttachment(file))
      }
      setRequestAttachments((prev) => [...prev, ...uploaded])
    } catch (error) {
      setRequestMessage(error instanceof Error ? error.message : 'Falha ao enviar anexo')
    } finally {
      setAttachmentUploading(false)
      event.target.value = ''
    }
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

  async function submitRequest() {
    setRequestSaving(true)
    setRequestMessage(null)
    setRequestUpdateNotice(null)
    try {
      const payload = {
        type: requestForm.type,
        title: requestForm.title,
        amount: requestForm.type === 'advance' ? requestForm.amount : null,
        description: requestForm.description,
        attachments: requestAttachments,
      }

      const res = await fetch('/api/employee/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null) as { error?: string } | EmployeeRequest | null
      if (!res.ok) {
        setRequestMessage((data && 'error' in data && typeof data.error === 'string') ? data.error : 'Falha ao enviar solicitação.')
        return
      }

      setRequestForm({ type: 'advance', title: '', amount: '', description: '' })
      setRequestAttachments([])
      setRequestMessage('Solicitação enviada para o gestor.')
      await loadRequests()
    } finally {
      setRequestSaving(false)
    }
  }

  async function cancelRequest(id: number) {
    setRequestSaving(true)
    setRequestMessage(null)
    setRequestUpdateNotice(null)
    try {
      const res = await fetch(`/api/employee/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setRequestMessage(data?.error ?? 'Não foi possível cancelar.')
        return
      }
      setRequestMessage('Solicitação cancelada com sucesso.')
      await loadRequests()
    } finally {
      setRequestSaving(false)
    }
  }

  async function requestInstallPrompt() {
    if (!installPromptEvent) return
    await installPromptEvent.prompt()
    await installPromptEvent.userChoice.catch(() => undefined)
    setInstallPromptEvent(null)
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

  function formatMoney(cents: number | null | undefined) {
    if (cents == null) return '—'
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  }

  function formatRequestType(type: EmployeeRequest['type']) {
    if (type === 'advance') return 'Adiantamento'
    if (type === 'occurrence') return 'Ocorrência'
    if (type === 'absence') return 'Ausência'
    return 'Material'
  }

  function formatRequestStatus(status: EmployeeRequest['status']) {
    if (status === 'pending') return 'Pendente'
    if (status === 'approved') return 'Aprovada'
    if (status === 'rejected') return 'Rejeitada'
    return 'Cancelada'
  }

  function requestStatusClass(status: EmployeeRequest['status']) {
    if (status === 'pending') return 'border-amber-700 bg-amber-900/20 text-amber-300'
    if (status === 'approved') return 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
    if (status === 'rejected') return 'border-rose-700 bg-rose-900/20 text-rose-300'
    return 'border-slate-600 bg-slate-900/40 text-slate-300'
  }

  function eventTypeLabel(eventType: string) {
    if (eventType === 'created') return 'Criação'
    if (eventType === 'attachment_added') return 'Anexo'
    if (eventType === 'status_changed') return 'Status'
    if (eventType === 'cancelled') return 'Cancelamento'
    return 'Evento'
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/employee/login')
    router.refresh()
  }

  const pendingRequests = requests.filter((item) => item.status === 'pending').length

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

          <div className="mt-4 flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('services')}
              className={`rounded-full px-3 py-1.5 text-xs border ${activeTab === 'services' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-900/70 border-slate-700 text-slate-300'}`}
            >
              Serviços
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`rounded-full px-3 py-1.5 text-xs border ${activeTab === 'requests' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-900/70 border-slate-700 text-slate-300'}`}
            >
              Solicitações {pendingRequests > 0 ? `(${pendingRequests})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`rounded-full px-3 py-1.5 text-xs border ${activeTab === 'history' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-900/70 border-slate-700 text-slate-300'}`}
            >
              Histórico
            </button>
          </div>

          {installPromptEvent && (
            <button
              type="button"
              onClick={requestInstallPrompt}
              className="mt-3 w-full rounded-lg bg-sky-600/90 hover:bg-sky-500 text-white py-2 text-sm font-semibold"
            >
              Instalar app no celular
            </button>
          )}

          {!installPromptEvent && showIosInstallHint && (
            <div className="mt-3 rounded-lg border border-sky-700/60 bg-sky-950/30 p-3">
              <p className="text-xs text-sky-200 font-semibold">Instalação no iPhone/iPad</p>
              <p className="text-xs text-slate-300 mt-1">
                Toque em <strong>Compartilhar</strong> no Safari e depois em <strong>Adicionar à Tela de Início</strong>.
              </p>
            </div>
          )}
        </div>

        {activeTab === 'services' && (
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
              onClick={() => setActiveTab('requests')}
              className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3 text-left"
            >
              <p className="text-slate-100 font-medium">📝 Solicitações e ocorrências</p>
              <p className="text-xs text-slate-400 mt-0.5">Abra adiantamentos e acompanhe a aprovação do gestor.</p>
            </button>

            <button
              type="button"
              className="w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3 text-left"
            >
              <p className="text-slate-100 font-medium">📎 Documentos da equipe</p>
              <p className="text-xs text-slate-400 mt-0.5">Em breve: holerite, ordens de serviço e anexos.</p>
            </button>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="auth-panel p-4 space-y-3">
            <h2 className="text-white font-semibold">Solicitações e ocorrências</h2>

            <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs text-slate-300 flex items-center justify-between gap-3">
              <span>Sincronização automática ativa</span>
              <span>{requestLastSync ? `Última verificação às ${requestLastSync}` : 'Ainda não sincronizado'}</span>
            </div>

            {requestUpdateNotice && (
              <div className="rounded-xl border border-emerald-700 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
                {requestUpdateNotice}
              </div>
            )}

            <div className="rounded-xl border border-slate-600 bg-slate-800/60 p-3 space-y-2">
              <label className="text-xs text-slate-400 block">Tipo de solicitação</label>
              <select
                value={requestForm.type}
                onChange={(e) => setRequestForm((prev) => ({ ...prev, type: e.target.value as EmployeeRequest['type'] }))}
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-slate-100"
              >
                <option value="advance">Adiantamento</option>
                <option value="occurrence">Ocorrência</option>
                <option value="absence">Justificativa de ausência</option>
                <option value="material_request">Solicitação de material</option>
              </select>

              <input
                type="text"
                value={requestForm.title}
                onChange={(e) => setRequestForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Título da solicitação"
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-slate-100"
              />

              {requestForm.type === 'advance' && (
                <input
                  type="text"
                  value={requestForm.amount}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Valor solicitado (ex.: 500,00)"
                  className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-slate-100"
                />
              )}

              <textarea
                rows={3}
                value={requestForm.description}
                onChange={(e) => setRequestForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Descreva o motivo e contexto"
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-slate-100"
              />

              <div className="space-y-2">
                <label className="block text-xs text-slate-400">Anexos</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleRequestAttachmentsChange}
                  disabled={attachmentUploading || requestAttachments.length >= 3}
                  className="w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100 hover:file:bg-slate-600"
                />
                <p className="text-[11px] text-slate-500">Até 3 anexos, imagens ou PDF.</p>
                {requestAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {requestAttachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-sky-700 bg-sky-950/20 px-3 py-1 text-xs text-sky-200"
                      >
                        📎 {attachment.originalFilename ?? 'Anexo'}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={submitRequest}
                disabled={requestSaving || attachmentUploading}
                className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white py-2 text-sm font-semibold"
              >
                {requestSaving ? 'Enviando...' : attachmentUploading ? 'Enviando anexo...' : 'Enviar para aprovação'}
              </button>
            </div>

            {requestMessage && (
              <p className="text-xs text-slate-300">{requestMessage}</p>
            )}

            <div className="space-y-2">
              <p className="text-xs text-slate-400">Minhas solicitações</p>
              {requestLoading ? (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-3 text-xs text-slate-400">Carregando solicitações...</div>
              ) : requests.length === 0 ? (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-3 text-xs text-slate-400">Nenhuma solicitação enviada.</div>
              ) : requests.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-100 font-medium">{item.title}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${requestStatusClass(item.status)}`}>
                      {formatRequestStatus(item.status)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{formatRequestType(item.type)} • {item.obra_name ?? 'Sem obra'}</p>
                  {item.description && <p className="text-xs text-slate-300 whitespace-pre-wrap">{item.description}</p>}
                  {item.attachments.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-slate-400">Anexos</p>
                      <div className="flex flex-wrap gap-2">
                        {item.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-sky-700 bg-sky-950/20 px-3 py-1 text-[11px] text-sky-200"
                          >
                            📎 {attachment.originalFilename ?? 'Anexo'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-slate-400 flex items-center justify-between gap-2">
                    <span>Valor: {formatMoney(item.amount_cents)}</span>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                  {item.manager_note && (
                    <div className="rounded-md border border-slate-600 bg-slate-800/70 px-2 py-1.5">
                      <p className="text-[11px] text-slate-400">Retorno do gestor</p>
                      <p className="text-xs text-slate-200 mt-0.5">{item.manager_note}</p>
                    </div>
                  )}
                  {item.events.length > 0 && (
                    <div className="rounded-md border border-slate-700 bg-slate-900/30 px-2 py-2 space-y-1">
                      <p className="text-[11px] text-slate-400">Linha do tempo</p>
                      {item.events.slice(-4).reverse().map((eventItem) => (
                        <div key={eventItem.id} className="text-[11px] text-slate-300 flex items-start justify-between gap-2">
                          <span>
                            <strong className="text-slate-200">{eventTypeLabel(eventItem.eventType)}:</strong> {eventItem.message}
                          </span>
                          <span className="text-slate-500 whitespace-nowrap">{formatDateTime(eventItem.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => cancelRequest(item.id)}
                      disabled={requestSaving}
                      className="mt-1 rounded-md px-2.5 py-1 text-xs bg-slate-700 hover:bg-rose-800 text-slate-200"
                    >
                      Cancelar solicitação
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="auth-panel p-4 space-y-2">
            <h2 className="text-white font-semibold">Últimas batidas</h2>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum registro ainda.</p>
            ) : (
              history.slice(0, 12).map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                  <p className="text-sm text-slate-200">Entrada: {formatDateTime(item.checkin_at)}</p>
                  <p className="text-xs text-slate-400">Saída: {formatDateTime(item.checkout_at)}</p>
                </div>
              ))
            )}
          </div>
        )}

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
