import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { classifyExpenseOcrText } from '@/lib/expenseClassifier'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const body = await request.json().catch(() => null) as { ocrText?: unknown } | null
    const ocrText = typeof body?.ocrText === 'string' ? body.ocrText.trim() : ''

    if (ocrText.length < 12) {
      return NextResponse.json({ error: 'Texto OCR insuficiente para classificação' }, { status: 422 })
    }

    const result = await classifyExpenseOcrText(ocrText)

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Falha ao classificar o comprovante' }, { status: 500 })
  }
}
