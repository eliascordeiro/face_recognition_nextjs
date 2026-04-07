'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

type FaceApiType = typeof import('face-api.js')

type Tab = 'recognize' | 'register' | 'list'

interface Person {
  id: number
  name: string
  phone?: string | null
  thumbnail?: string
  created_at: string
}

interface RecognizeResult {
  match: boolean
  person_id?: number
  name?: string
  distance?: number
  confidence?: number
}

type StatusType = 'idle' | 'ok' | 'error' | 'loading'

function StatusBox({ text, type }: { text: string; type: StatusType }) {
  const styles: Record<StatusType, string> = {
    idle: 'bg-slate-700/50 border-slate-600 text-slate-300',
    ok: 'bg-emerald-900/50 border-emerald-600 text-emerald-300',
    error: 'bg-red-900/50 border-red-600 text-red-300',
    loading: 'bg-sky-900/50 border-sky-700 text-sky-300',
  }
  return (
    <div className={`mt-3 p-3 rounded-lg text-sm text-center border ${styles[type]}`}>
      {text}
    </div>
  )
}

interface Props {
  /** Permite cadastrar e remover funcionários */
  allowRegister: boolean
}

export default function FaceRecognitionPanel({ allowRegister }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceapiRef = useRef<FaceApiType | null>(null)

  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')

  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [capturedDescriptor, setCapturedDescriptor] = useState<number[] | null>(null)
  const [captureStatus, setCaptureStatus] = useState<{ text: string; type: StatusType } | null>(null)

  const defaultTab: Tab = 'recognize'
  const [tab, setTab] = useState<Tab>(defaultTab)
  const [personName, setPersonName] = useState('')
  const [personPhone, setPersonPhone] = useState('')

  function formatPhone(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 11)
    if (d.length <= 2) return d
    if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2)}`
    return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`
  }

  const [recResult, setRecResult] = useState<RecognizeResult | null>(null)
  const [recStatus, setRecStatus] = useState<{ text: string; type: StatusType }>({
    text: 'Capture uma foto e clique em Identificar.',
    type: 'idle',
  })
  const [regStatus, setRegStatus] = useState<{ text: string; type: StatusType }>({
    text: 'Capture uma foto, informe o nome e cadastre.',
    type: 'idle',
  })

  const [persons, setPersons] = useState<Person[]>([])
  const [listLoading, setListLoading] = useState(false)

  // ── Carregar modelos face-api.js ────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const faceapi = await import('face-api.js')
        faceapiRef.current = faceapi
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ])
        setModelsLoaded(true)
      } catch {
        setModelsError(
          'Modelos não encontrados em /public/models/. Execute: npm run download-models'
        )
      }
    }
    load()
  }, [])

  // ── Câmera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async (facing: 'user' | 'environment' = facingMode) => {
    // Para o stream anterior antes de iniciar um novo
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setCameraOn(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      alert(`Erro ao acessar câmera: ${msg}`)
    }
  }, [facingMode])

  const flipCamera = useCallback(() => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    if (cameraOn) startCamera(next)
  }, [facingMode, cameraOn, startCamera])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  // Parar câmera ao desmontar
  useEffect(() => () => { stopCamera() }, [stopCamera])

  // ── Reconhecer (recebe descriptor diretamente para evitar dependência de estado assíncrono) ──
  const recognizeDescriptor = useCallback(async (descriptor: number[]) => {
    setRecStatus({ text: '⏳ Identificando…', type: 'loading' })
    setProcessing(true)
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding: descriptor }),
      })
      const data: RecognizeResult & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na API')
      setRecResult(data)
      if (data.match) {
        setRecStatus({
          text: `✅ Identificado: ${data.name} (${data.confidence}% de confiança)`,
          type: 'ok',
        })
      } else {
        setRecStatus({
          text: `❌ Rosto não reconhecido (distância: ${data.distance ?? 'N/A'})`,
          type: 'error',
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      setRecStatus({ text: `Erro: ${msg}`, type: 'error' })
    } finally {
      setProcessing(false)
    }
  }, [])

  const handleRecognize = useCallback(() => {
    if (!capturedDescriptor) return
    recognizeDescriptor(capturedDescriptor)
  }, [capturedDescriptor, recognizeDescriptor])

  // ── Capturar e detectar rosto ───────────────────────────────────────────────
  const captureAndDetect = useCallback(async () => {
    const faceapi = faceapiRef.current
    const video = videoRef.current
    if (!faceapi || !video || !modelsLoaded) return
    setProcessing(true)
    setCaptureStatus({ text: '⏳ Analisando imagem…', type: 'loading' })
    try {
      // ── 1. Desenhar frame no canvas para verificar brilho ─────────────────
      const canvas = canvasRef.current!
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)

      const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let lumSum = 0
      for (let i = 0; i < pixels.length; i += 4) {
        lumSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
      }
      const brightness = lumSum / (pixels.length / 4)

      if (brightness < 35) {
        setCaptureStatus({ text: '🌑 Imagem muito escura — aumente a iluminação do ambiente.', type: 'error' })
        return
      }
      if (brightness > 230) {
        setCaptureStatus({ text: '☀️ Imagem muito clara / reflexo — evite luz direta na câmera.', type: 'error' })
        return
      }

      // ── 2. Verificar quantos rostos estão visíveis ────────────────────────
      const allFaces = await faceapi.detectAllFaces(
        video,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 })
      )

      if (allFaces.length === 0) {
        setCaptureStatus({
          text: '🙅 Nenhum rosto detectado — centralize o rosto na câmera e melhore a iluminação.',
          type: 'error',
        })
        return
      }
      if (allFaces.length > 1) {
        setCaptureStatus({
          text: `👥 ${allFaces.length} rostos detectados — deixe apenas uma pessoa na câmera.`,
          type: 'error',
        })
        return
      }

      // ── 3. Detectar com landmarks + descriptor ────────────────────────────
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        setCaptureStatus({
          text: '🙅 Rosto não detectado — enquadre melhor o rosto e tente novamente.',
          type: 'error',
        })
        return
      }

      // ── 4. Rosto muito pequeno (longe da câmera)? ─────────────────────────
      const faceWidthRatio = detection.detection.box.width / video.videoWidth
      if (faceWidthRatio < 0.12) {
        setCaptureStatus({
          text: '📏 Rosto muito longe — aproxime-se mais da câmera.',
          type: 'error',
        })
        return
      }

      // ── 5. Confiança da detecção baixa (borrado / muito inclinado) ────────
      const score = detection.detection.score
      if (score < 0.6) {
        setCaptureStatus({
          text: '🌫️ Qualidade insuficiente — melhore a iluminação ou enquadramento do rosto.',
          type: 'error',
        })
        return
      }

      // ── Captura aprovada ──────────────────────────────────────────────────
      const imageData = canvas.toDataURL('image/jpeg', 0.8)
      const descriptor = Array.from(detection.descriptor)
      setCapturedImage(imageData)
      setCapturedDescriptor(descriptor)
      setRecResult(null)

      const qualityWarn = score < 0.8
      setCaptureStatus({
        text: qualityWarn
          ? '⚠️ Rosto capturado mas com qualidade mediana — se possível, capture novamente com melhor iluminação.'
          : '✅ Rosto capturado com boa qualidade!',
        type: qualityWarn ? 'idle' : 'ok',
      })
      setRecStatus({ text: '✅ Rosto capturado! Clique em Identificar.', type: 'ok' })
      setRegStatus({ text: '✅ Rosto capturado! Informe o nome e cadastre.', type: 'ok' })

      // Auto-identificar ao capturar na aba Identificar
      if (tab === 'recognize') {
        await recognizeDescriptor(descriptor)
      }
    } finally {
      setProcessing(false)
    }
  }, [modelsLoaded, tab, recognizeDescriptor])

  // ── Cadastrar ──────────────────────────────────────────────────────────────
  const handleRegister = useCallback(async () => {
    if (!capturedDescriptor || personName.trim().length < 2) return
    setRegStatus({ text: 'Salvando...', type: 'loading' })
    setProcessing(true)
    try {
      const res = await fetch('/api/persons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: personName.trim(),
          phone: personPhone ? personPhone.replace(/\D/g, '').slice(0, 11) : null,
          embedding: capturedDescriptor,
          thumbnail: capturedImage,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      setRegStatus({
        text: `✅ "${data.name}" cadastrado com sucesso! (ID: ${data.id})`,
        type: 'ok',
      })
      setPersonName('')
      setPersonPhone('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      setRegStatus({ text: `Erro: ${msg}`, type: 'error' })
    } finally {
      setProcessing(false)
    }
  }, [capturedDescriptor, personName, personPhone, capturedImage])

  // ── Lista de funcionários ──────────────────────────────────────────────────
  const loadPersons = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/persons')
      const data = await res.json()
      setPersons(Array.isArray(data) ? data : [])
    } finally {
      setListLoading(false)
    }
  }, [])

  const deletePerson = useCallback(
    async (id: number, name: string) => {
      if (!confirm(`Remover "${name}" do banco?`)) return
      await fetch(`/api/persons/${id}`, { method: 'DELETE' })
      loadPersons()
    },
    [loadPersons]
  )

  useEffect(() => {
    if (tab === 'list') loadPersons()
  }, [tab, loadPersons])

  // Tabs disponíveis
  const tabs: { key: Tab; label: string }[] = [
    { key: 'recognize', label: '🔍 Identificar' },
    ...(allowRegister ? [{ key: 'register' as Tab, label: '➕ Cadastrar' }] : []),
    { key: 'list', label: '👥 Funcionários' },
  ]

  return (
    <div className="flex flex-col items-center w-full">
      {/* Status dos modelos */}
      {!modelsLoaded && !modelsError && (
        <div className="w-full max-w-md mb-4 p-3 bg-sky-900/40 border border-sky-700 rounded-lg text-sky-300 text-sm text-center animate-pulse">
          ⏳ Carregando modelos de IA (primeira vez pode demorar ~5s)…
        </div>
      )}
      {modelsLoaded && (
        <div className="w-full max-w-md mb-4 p-2 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-400 text-xs text-center">
          ✅ Modelos carregados — detecção roda no seu dispositivo (sem envio de vídeo)
        </div>
      )}
      {modelsError && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          ❌ {modelsError}
        </div>
      )}

      {/* Câmera */}
      <div className="w-full max-w-md bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4">
        <h2 className="text-sky-300 font-semibold mb-3">📷 Câmera</h2>
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
              Câmera desligada
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
        {capturedImage && (
          <img
            src={capturedImage}
            alt="Captura"
            className="w-full rounded-lg mt-3 border border-slate-600 opacity-80"
          />
        )}
        <div className="flex gap-2 mt-3">
          {!cameraOn ? (
            <button
              onClick={() => startCamera()}
              disabled={!modelsLoaded}
              className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded-lg text-sm font-semibold transition-opacity"
            >
              ▶ Ligar câmera
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-semibold"
            >
              ■ Desligar
            </button>
          )}
          <button
            onClick={flipCamera}
            disabled={!modelsLoaded}
            title={facingMode === 'user' ? 'Usar câmera traseira' : 'Usar câmera frontal'}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-lg transition-opacity"
          >
            🔄
          </button>
          <button
            onClick={captureAndDetect}
            disabled={!cameraOn || processing || !modelsLoaded}
            className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-semibold transition-opacity"
          >
            {processing ? '⏳ Analisando…' : '📸 Capturar rosto'}
          </button>
        </div>
        {captureStatus && (
          <StatusBox text={captureStatus.text} type={captureStatus.type} />
        )}
      </div>

      {/* Tabs */}
      <div className="w-full max-w-md bg-slate-800 rounded-xl border border-slate-700 p-4">
        <div className="flex rounded-lg overflow-hidden border border-slate-700 mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Identificar */}
        {tab === 'recognize' && (
          <div>
            <button
              onClick={handleRecognize}
              disabled={!capturedDescriptor || processing}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg font-semibold transition-opacity"
            >
              🔍 Identificar agora
            </button>
            <StatusBox text={recStatus.text} type={recStatus.type} />
            {recResult?.match && (
              <div className="mt-3 text-center">
                <span className="text-4xl">👤</span>
                <p className="text-lg font-bold text-emerald-400 mt-1">{recResult.name}</p>
                <p className="text-slate-400 text-sm">
                  Distância L2: {recResult.distance} · Confiança: {recResult.confidence}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab: Cadastrar */}
        {tab === 'register' && allowRegister && (
          <div>
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Nome do funcionário…"
              maxLength={255}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm mb-2 focus:outline-none focus:border-sky-500 text-slate-100"
            />
            <input
              type="tel"
              value={personPhone}
              onChange={(e) => setPersonPhone(formatPhone(e.target.value))}
              placeholder="Telefone: 99 99999-9999"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm mb-3 focus:outline-none focus:border-sky-500 text-slate-100"
            />
            <button
              onClick={handleRegister}
              disabled={!capturedDescriptor || personName.trim().length < 2 || processing}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded-lg font-semibold transition-opacity"
            >
              ➕ Cadastrar funcionário
            </button>
            <StatusBox text={regStatus.text} type={regStatus.type} />
          </div>
        )}

        {/* Tab: Funcionários */}
        {tab === 'list' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-300 text-sm font-medium">
                {persons.length} funcionário{persons.length !== 1 ? 's' : ''} cadastrado{persons.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={loadPersons}
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                ↻ Atualizar
              </button>
            </div>
            {listLoading ? (
              <p className="text-slate-400 text-sm text-center py-4">Carregando…</p>
            ) : persons.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Nenhum funcionário cadastrado.</p>
            ) : (
              <ul className="space-y-2">
                {persons.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt={p.name} className="w-8 h-8 rounded-full object-cover border border-slate-600" />
                      ) : (
                        <span className="text-xl">👤</span>
                      )}
                      <div>
                        <p className="text-sm font-medium text-slate-200">{p.name}</p>
                        {p.phone && (
                          <p className="text-xs text-sky-400">
                            📱 {p.phone.length > 6
                              ? `${p.phone.slice(0,2)} ${p.phone.slice(2,7)}-${p.phone.slice(7)}`
                              : p.phone}
                          </p>
                        )}
                        <p className="text-xs text-slate-500">
                          {new Date(p.created_at).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    </div>
                    {allowRegister && (
                      <button
                        onClick={() => deletePerson(p.id, p.name)}
                        className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-900/30"
                      >
                        Remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
