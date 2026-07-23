'use client'

import FaceRecognitionPanel from '@/components/FaceRecognitionPanel'

export default function RecognizePage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-slate-100 mb-6">🧠 Identificar</h1>
      <FaceRecognitionPanel allowRegister={false} />
    </div>
  )
}

