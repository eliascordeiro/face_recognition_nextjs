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

    if (result.source === 'heuristic') {
      const reason = result.diagnostics?.reason ?? 'request_error'
      const status = result.diagnostics?.statusCode ? ` status=${result.diagnostics.statusCode}` : ''
      console.warn(`[expenses.classify] fallback=heuristic reason=${reason}${status} client=${auth.sub}`)
    } else {
      console.info(`[expenses.classify] source=ai client=${auth.sub}`)
    }

    return NextResponse.json({
      ...result,
      fallbackReason: result.source === 'heuristic' ? result.diagnostics?.reason ?? 'request_error' : null,
    })
  } catch {
    return NextResponse.json({ error: 'Falha ao classificar o comprovante' }, { status: 500 })
  }
}
