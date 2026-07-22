'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type FaceApiType = typeof import('face-api.js')
type StatusType = 'idle' | 'ok' | 'error' | 'loading'

interface Props {
  personId: number
  personName: string
  onClose: () => void
  onSaved: (patch: { has_face: boolean; thumbnail?: string | null }) => void
}

/**
 * Modal dedicado à captura de reconhecimento facial de um funcionário já
 * cadastrado. Abre a câmera, valida qualidade do rosto e salva o embedding
 * via PATCH /api/persons/[id] — sem misturar com o formulário de dados.
 */
export default function FaceCaptureModal({ personId, personName, onClose, onSaved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceapiRef = useRef<FaceApiType | null>(null)

  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [capturedDescriptor, setCapturedDescriptor] = useState<number[] | null>(null)
  const [status, setStatus] = useState<{ text: string; type: StatusType }>({
    text: 'Ligue a câmera e centralize o rosto.',
    type: 'idle',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const faceapi = await import('face-api.js')
        faceapiRef.current = faceapi
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ])
        if (!cancelled) setModelsLoaded(true)
      } catch {
        if (!cancelled) {
          setModelsError('Modelos de IA não encontrados em /public/models/.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const startCamera = useCallback(async (facing: 'user' | 'environment' = facingMode) => {
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
      setStatus({ text: `Erro ao acessar câmera: ${msg}`, type: 'error' })
    }
  }, [facingMode])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  const flipCamera = useCallback(() => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    if (cameraOn) startCamera(next)
  }, [facingMode, cameraOn, startCamera])

  useEffect(() => () => { stopCamera() }, [stopCamera])

  const captureAndDetect = useCallback(async () => {
    const faceapi = faceapiRef.current
    const video = videoRef.current
    if (!faceapi || !video || !modelsLoaded) return
    setProcessing(true)
    setStatus({ text: '⏳ Analisando imagem…', type: 'loading' })
    try {
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
        setStatus({ text: '🌑 Imagem muito escura — aumente a iluminação.', type: 'error' })
        return
      }
      if (brightness > 230) {
        setStatus({ text: '☀️ Imagem muito clara — evite luz direta na câmera.', type: 'error' })
        return
      }

      const allFaces = await faceapi.detectAllFaces(
        video,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 })
      )
      if (allFaces.length === 0) {
        setStatus({ text: '🙅 Nenhum rosto detectado — centralize o rosto na câmera.', type: 'error' })
        return
      }
      if (allFaces.length > 1) {
        setStatus({ text: `👥 ${allFaces.length} rostos detectados — deixe apenas uma pessoa na câmera.`, type: 'error' })
        return
      }

      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        setStatus({ text: '🙅 Rosto não detectado — tente novamente.', type: 'error' })
        return
      }

      const faceWidthRatio = detection.detection.box.width / video.videoWidth
      if (faceWidthRatio < 0.12) {
        setStatus({ text: '📏 Rosto muito longe — aproxime-se da câmera.', type: 'error' })
        return
      }

      const score = detection.detection.score
      if (score < 0.6) {
        setStatus({ text: '🌫️ Qualidade insuficiente — melhore a iluminação/enquadramento.', type: 'error' })
        return
      }

      const imageData = canvas.toDataURL('image/jpeg', 0.8)
      setCapturedImage(imageData)
      setCapturedDescriptor(Array.from(detection.descriptor))
      setStatus({
        text: score < 0.8
          ? '⚠️ Capturado, mas com qualidade mediana. Você pode salvar ou capturar novamente.'
          : '✅ Rosto capturado com boa qualidade! Confira e salve.',
        type: score < 0.8 ? 'idle' : 'ok',
      })
    } finally {
      setProcessing(false)
    }
  }, [modelsLoaded])

  const handleSave = useCallback(async () => {
    if (!capturedDescriptor) return
    setSaving(true)
    setStatus({ text: 'Salvando reconhecimento facial…', type: 'loading' })
    try {
      const res = await fetch(`/api/persons/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding: capturedDescriptor, thumbnail: capturedImage }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      onSaved({ has_face: true, thumbnail: data.thumbnail })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      setStatus({ text: `Erro: ${msg}`, type: 'error' })
      setSaving(false)
    }
  }, [capturedDescriptor, capturedImage, personId, onSaved])

  const statusStyles: Record<StatusType, string> = {
    idle: 'bg-slate-700/50 border-slate-600 text-slate-300',
    ok: 'bg-emerald-900/50 border-emerald-600 text-emerald-300',
    error: 'bg-red-900/50 border-red-600 text-red-300',
    loading: 'bg-sky-900/50 border-sky-700 text-sky-300',
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">📸 Reconhecimento facial</h3>
            <p className="text-slate-400 text-xs mt-0.5">{personName}</p>
          </div>
          <button
            onClick={() => { stopCamera(); onClose() }}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {!modelsLoaded && !modelsError && (
            <div className="mb-4 p-3 bg-sky-900/40 border border-sky-700 rounded-lg text-sky-300 text-xs text-center animate-pulse">
              ⏳ Carregando modelos de IA…
            </div>
          )}
          {modelsError && (
            <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs">
              ❌ {modelsError}
            </div>
          )}

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
              alt="Rosto capturado"
              className="w-full rounded-lg mt-3 border border-slate-600 opacity-90"
            />
          )}

          <div className="flex gap-2 mt-3">
            {!cameraOn ? (
              <button
                onClick={() => startCamera()}
                disabled={!modelsLoaded}
                className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded-lg text-sm font-semibold"
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
              title="Trocar câmera"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-lg"
            >
              🔄
            </button>
            <button
              onClick={captureAndDetect}
              disabled={!cameraOn || processing || !modelsLoaded}
              className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-semibold"
            >
              {processing ? '⏳ Analisando…' : '📸 Capturar'}
            </button>
          </div>

          <div className={`mt-3 p-3 rounded-lg text-sm text-center border ${statusStyles[status.type]}`}>
            {status.text}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { stopCamera(); onClose() }}
              className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!capturedDescriptor || saving}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-sm font-semibold"
            >
              {saving ? 'Salvando…' : '✅ Salvar reconhecimento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
