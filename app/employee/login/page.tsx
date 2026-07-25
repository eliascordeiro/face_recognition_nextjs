'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type FaceApiType = typeof import('face-api.js')

type LoginMode = 'password' | 'face'

export default function EmployeeLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LoginMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceapiRef = useRef<FaceApiType | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)

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
        if (!cancelled) setModelsLoaded(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

  const startCamera = useCallback(async () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      streamRef.current = stream
      setCameraOn(true)
      setError(null)
    } catch {
      setError('Não foi possível acessar a câmera neste dispositivo.')
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  useEffect(() => () => { stopCamera() }, [stopCamera])

  async function loginWithPassword(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/employee/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível entrar')
        return
      }
      router.replace('/employee')
      router.refresh()
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  async function loginWithFace() {
    const faceapi = faceapiRef.current
    const video = videoRef.current
    if (!faceapi || !video || !modelsLoaded || !cameraOn) return

    setLoading(true)
    setError(null)
    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (!detection) {
        setError('Nenhum rosto detectado. Centralize seu rosto e tente novamente.')
        return
      }

      const res = await fetch('/api/employee/auth/face-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          embedding: Array.from(detection.descriptor),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível autenticar com reconhecimento facial')
        return
      }
      router.replace('/employee')
      router.refresh()
    } catch {
      setError('Erro ao autenticar por reconhecimento facial')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell min-h-screen px-4 py-8">
      <div className="w-full max-w-sm mx-auto">
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">👷</div>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold text-white">Portal do Funcionário</h1>
          <p className="text-slate-300 text-sm mt-1">Acesse seus serviços pelo celular</p>
        </div>

        <div className="auth-panel p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`py-2 rounded-lg text-sm font-medium ${mode === 'password' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              E-mail e senha
            </button>
            <button
              type="button"
              onClick={() => setMode('face')}
              className={`py-2 rounded-lg text-sm font-medium ${mode === 'face' ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              Reconhecimento facial
            </button>
          </div>

          {mode === 'password' ? (
            <form className="space-y-3" onSubmit={loginWithPassword}>
              <div>
                <label className="block text-xs text-slate-300 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="funcionario@empresa.com"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Senha</label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="Sua senha de acesso"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-600 text-white font-semibold py-2 rounded-lg"
              >
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">E-mail do funcionário</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
                  placeholder="funcionario@empresa.com"
                />
              </div>

              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!cameraOn && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                    Câmera desligada
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {!cameraOn ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-semibold"
                  >
                    ▶ Ligar câmera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold"
                  >
                    ■ Desligar
                  </button>
                )}

                <button
                  type="button"
                  disabled={!cameraOn || !modelsLoaded || loading}
                  onClick={loginWithFace}
                  className="py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-semibold"
                >
                  {loading ? 'Analisando…' : '🔍 Entrar com rosto'}
                </button>
              </div>

              {!modelsLoaded && (
                <p className="text-[11px] text-slate-500 text-center">Carregando modelos de IA…</p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-red-300 text-sm text-center">{error}</p>}

          <p className="text-xs text-slate-400 text-center mt-4">
            É gestor? <Link href="/login" className="text-sky-400 hover:text-sky-300">Acessar área administrativa</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
