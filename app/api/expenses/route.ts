import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

const VALID_CATEGORIES = ['material', 'alimentacao', 'transporte', 'equipamento', 'servico', 'outros']

function toCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.category, e.vendor_name, e.amount_cents,
              e.expense_date, e.notes, e.receipt_number, e.receipt_total_cents,
              e.receipt_ocr_text, e.ocr_status, e.created_at, e.obra_id,
              e.receipt_image_url, e.receipt_image_public_id, e.receipt_image_format,
              e.receipt_image_bytes, e.receipt_image_width, e.receipt_image_height,
              e.receipt_uploaded_at,
              o.name AS obra_name
       FROM construction_expenses e
       LEFT JOIN obras o ON o.id = e.obra_id
       WHERE e.client_id = $1
       ORDER BY e.expense_date DESC, e.id DESC`,
      [auth.sub]
    )

    return NextResponse.json(rows)
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const body = await request.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const category = typeof body.category === 'string' && VALID_CATEGORIES.includes(body.category)
      ? body.category
      : 'outros'
    const amountCents = toCents(body.amount)
    const receiptTotalCents = body.receiptTotal ? toCents(body.receiptTotal) : null
    const obraId = typeof body.obraId === 'number' && Number.isFinite(body.obraId) ? body.obraId : null
    const expenseDate = typeof body.expenseDate === 'string' && body.expenseDate ? body.expenseDate : null
    const vendorName = typeof body.vendorName === 'string' ? body.vendorName.trim() || null : null
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    const receiptNumber = typeof body.receiptNumber === 'string' ? body.receiptNumber.trim() || null : null
    const receiptOcrText = typeof body.receiptOcrText === 'string' ? body.receiptOcrText.trim() || null : null
    const receiptImageUrl = typeof body.receiptImageUrl === 'string' ? body.receiptImageUrl.trim() || null : null
    const receiptImagePublicId = typeof body.receiptImagePublicId === 'string' ? body.receiptImagePublicId.trim() || null : null
    const receiptImageFormat = typeof body.receiptImageFormat === 'string' ? body.receiptImageFormat.trim() || null : null
    const receiptImageBytes = typeof body.receiptImageBytes === 'number' && Number.isFinite(body.receiptImageBytes)
      ? Math.round(body.receiptImageBytes)
      : null
    const receiptImageWidth = typeof body.receiptImageWidth === 'number' && Number.isFinite(body.receiptImageWidth)
      ? Math.round(body.receiptImageWidth)
      : null
    const receiptImageHeight = typeof body.receiptImageHeight === 'number' && Number.isFinite(body.receiptImageHeight)
      ? Math.round(body.receiptImageHeight)
      : null
    const ocrStatus = receiptOcrText ? 'ready_for_review' : 'pending'

    if (title.length < 3) {
      return NextResponse.json({ error: 'Descrição do gasto é obrigatória' }, { status: 422 })
    }
    if (amountCents === null || amountCents <= 0) {
      return NextResponse.json({ error: 'Informe um valor válido maior que zero' }, { status: 422 })
    }

    if (obraId !== null) {
      const obraCheck = await pool.query(
        `SELECT id FROM obras WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [obraId, auth.sub]
      )
      if (obraCheck.rowCount === 0) {
        return NextResponse.json({ error: 'Obra inválida para este cliente' }, { status: 422 })
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO construction_expenses (
         client_id, obra_id, created_by_user_id, title, category,
         vendor_name, amount_cents, expense_date, notes,
         receipt_number, receipt_total_cents, receipt_ocr_text, ocr_status,
         receipt_image_url, receipt_image_public_id, receipt_image_format,
         receipt_image_bytes, receipt_image_width, receipt_image_height, receipt_uploaded_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id, title, category, vendor_name, amount_cents,
                 expense_date, notes, receipt_number, receipt_total_cents,
                 receipt_ocr_text, ocr_status, created_at, obra_id,
                 receipt_image_url, receipt_image_public_id, receipt_image_format,
                 receipt_image_bytes, receipt_image_width, receipt_image_height,
                 receipt_uploaded_at`,
      [
        auth.sub,
        obraId,
        auth.sub,
        title,
        category,
        vendorName,
        amountCents,
        expenseDate,
        notes,
        receiptNumber,
        receiptTotalCents,
        receiptOcrText,
        ocrStatus,
        receiptImageUrl,
        receiptImagePublicId,
        receiptImageFormat,
        receiptImageBytes,
        receiptImageWidth,
        receiptImageHeight,
        receiptImageUrl ? new Date().toISOString() : null,
      ]
    )

    return NextResponse.json(rows[0], { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}