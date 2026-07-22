'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type FaceApiType = typeof import('face-api.js')
type StatusType = 'idle' | 'ok' | 'error' | 'loading'

interface Props {
  onClose: () => void
}

/**
 * Modal rápido para testar o reconhecimento facial (sem precisar ir para a
 * tela pública /recognize). Útil para o cliente validar o cadastro de um
 * funcionário recém-capturado.
 */
export default function RecognizeTestModal({ onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const faceapiRef = useRef<FaceApiType | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState<{ text: string; type: StatusType }>({
    text: 'Ligue a câmera e capture o rosto para identificar.',
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
        if (!cancelled) setStatus({ text: '❌ Modelos de IA não encontrados.', type: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
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
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  useEffect(() => () => { stopCamera() }, [stopCamera])

  const captureAndIdentify = useCallback(async () => {
    const faceapi = faceapiRef.current
    const video = videoRef.current
    if (!faceapi || !video || !modelsLoaded) return
    setProcessing(true)
    setStatus({ text: '⏳ Identificando…', type: 'loading' })
    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        setStatus({ text: '🙅 Nenhum rosto detectado — centralize o rosto na câmera.', type: 'error' })
        return
      }

      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding: Array.from(detection.descriptor) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na API')

      setStatus(
        data.match
          ? { text: `✅ Identificado: ${data.name} (${data.confidence}% de confiança)`, type: 'ok' }
          : { text: `❌ Rosto não reconhecido (distância: ${data.distance ?? 'N/A'})`, type: 'error' }
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro'
      setStatus({ text: `Erro: ${msg}`, type: 'error' })
    } finally {
      setProcessing(false)
    }
  }, [modelsLoaded])

  const statusStyles: Record<StatusType, string> = {
    idle: 'bg-slate-700/50 border-slate-600 text-slate-300',
    ok: 'bg-emerald-900/50 border-emerald-600 text-emerald-300',
    error: 'bg-red-900/50 border-red-600 text-red-300',
    loading: 'bg-sky-900/50 border-sky-700 text-sky-300',
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-100">🔍 Testar identificação</h3>
          <button
            onClick={() => { stopCamera(); onClose() }}
            className="text-slate-400 hover:text-white text-xl leading-none px-2"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!cameraOn && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                Câmera desligada
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-3">
            {!cameraOn ? (
              <button
                onClick={startCamera}
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
              onClick={captureAndIdentify}
              disabled={!cameraOn || processing || !modelsLoaded}
              className="flex-1 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-semibold"
            >
              {processing ? '⏳ Analisando…' : '🔍 Identificar'}
            </button>
          </div>

          <div className={`mt-3 p-3 rounded-lg text-sm text-center border ${statusStyles[status.type]}`}>
            {status.text}
          </div>
        </div>
      </div>
    </div>
  )
}
