import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { logExpenseAudit } from '@/lib/expenseAudit'

const VALID_CATEGORIES = ['material', 'alimentacao', 'transporte', 'equipamento', 'servico', 'outros']
const VALID_CLASSIFICATION_SOURCES = ['ai', 'heuristic'] as const
const VALID_CLASSIFICATION_REASONS = ['disabled', 'missing_api_key', 'timeout', 'invalid_api_key', 'insufficient_quota', 'rate_limited', 'provider_error', 'invalid_response', 'request_error', 'ok'] as const
const VALID_SORTS = {
  date_desc: 'e.expense_date DESC, e.id DESC',
  date_asc: 'e.expense_date ASC, e.id ASC',
  amount_desc: 'e.amount_cents DESC, e.id DESC',
  amount_asc: 'e.amount_cents ASC, e.id ASC',
  title_asc: 'e.title ASC, e.id DESC',
} as const

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.trunc(parsed)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function clampConfidence(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, parsed))
}

function toCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export async function GET(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const queryText = (searchParams.get('q') ?? '').trim()
    const category = (searchParams.get('category') ?? 'all').trim()
    const obra = (searchParams.get('obra') ?? 'all').trim()
    const classification = (searchParams.get('classification') ?? 'all').trim()
    const period = (searchParams.get('period') ?? 'all').trim()
    const sort = (searchParams.get('sort') ?? 'date_desc').trim() as keyof typeof VALID_SORTS
    const limit = clampInt(searchParams.get('limit'), 12, 1, 100)
    const offset = clampInt(searchParams.get('offset'), 0, 0, 50000)

    const whereClauses: string[] = ['e.client_id = $1']
    const params: Array<number | string> = [auth.sub]

    if (category !== 'all' && VALID_CATEGORIES.includes(category)) {
      params.push(category)
      whereClauses.push(`e.category = $${params.length}`)
    }

    if (obra !== 'all') {
      if (obra === 'none' || obra === '') {
        whereClauses.push('e.obra_id IS NULL')
      } else {
        const obraId = Number(obra)
        if (Number.isFinite(obraId) && obraId > 0) {
          params.push(obraId)
          whereClauses.push(`e.obra_id = $${params.length}`)
        }
      }
    }

    if (classification !== 'all') {
      if (classification === 'none') {
        whereClauses.push('e.receipt_classification_source IS NULL')
      } else if (classification === 'ai' || classification === 'heuristic') {
        params.push(classification)
        whereClauses.push(`e.receipt_classification_source = $${params.length}`)
      }
    }

    if (period === '7d') {
      whereClauses.push(`e.expense_date >= CURRENT_DATE - INTERVAL '6 day'`)
    } else if (period === '30d') {
      whereClauses.push(`e.expense_date >= CURRENT_DATE - INTERVAL '29 day'`)
    } else if (period === 'this_month') {
      whereClauses.push(`e.expense_date >= DATE_TRUNC('month', CURRENT_DATE)::date`)
    } else if (period === 'last_month') {
      whereClauses.push(`e.expense_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')::date`)
      whereClauses.push(`e.expense_date < DATE_TRUNC('month', CURRENT_DATE)::date`)
    }

    if (queryText) {
      params.push(`%${queryText}%`)
      whereClauses.push(`(
        e.title ILIKE $${params.length}
        OR COALESCE(e.vendor_name, '') ILIKE $${params.length}
        OR COALESCE(e.notes, '') ILIKE $${params.length}
        OR COALESCE(e.receipt_number, '') ILIKE $${params.length}
        OR COALESCE(o.name, '') ILIKE $${params.length}
      )`)
    }

    const whereSql = whereClauses.join(' AND ')
    const orderSql = VALID_SORTS[sort] ?? VALID_SORTS.date_desc
    const listParams = [...params, limit, offset]

    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.category, e.vendor_name, e.amount_cents,
              e.expense_date, e.notes, e.receipt_number, e.receipt_total_cents,
              e.receipt_ocr_text, e.ocr_status, e.receipt_classification_source,
              e.receipt_classification_reason, e.receipt_classification_confidence,
              e.created_at, e.obra_id,
              e.receipt_image_url, e.receipt_image_public_id, e.receipt_image_format,
              e.receipt_image_bytes, e.receipt_image_width, e.receipt_image_height,
              e.receipt_uploaded_at,
              o.name AS obra_name
       FROM construction_expenses e
       LEFT JOIN obras o ON o.id = e.obra_id
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      listParams
    )

    const summaryResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_count,
         COALESCE(SUM(e.amount_cents), 0)::bigint AS total_amount_cents,
         COUNT(*) FILTER (WHERE e.receipt_image_url IS NOT NULL)::int AS with_image_count,
         COUNT(*) FILTER (
           WHERE e.receipt_ocr_text IS NOT NULL
             AND BTRIM(e.receipt_ocr_text) <> ''
         )::int AS with_ocr_count
       FROM construction_expenses e
       LEFT JOIN obras o ON o.id = e.obra_id
       WHERE ${whereSql}`,
      params
    )

    const summary = summaryResult.rows[0] ?? {
      total_count: 0,
      total_amount_cents: 0,
      with_image_count: 0,
      with_ocr_count: 0,
    }

    const total = Number(summary.total_count) || 0

    return NextResponse.json({
      items: rows,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + rows.length < total,
      },
      summary: {
        totalAmountCents: Number(summary.total_amount_cents) || 0,
        withImageCount: Number(summary.with_image_count) || 0,
        withOcrCount: Number(summary.with_ocr_count) || 0,
      },
    })
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
    const receiptClassificationSource = typeof body.receiptClassificationSource === 'string' && VALID_CLASSIFICATION_SOURCES.includes(body.receiptClassificationSource)
      ? body.receiptClassificationSource
      : null
    const receiptClassificationReason = typeof body.receiptClassificationReason === 'string' && VALID_CLASSIFICATION_REASONS.includes(body.receiptClassificationReason as typeof VALID_CLASSIFICATION_REASONS[number])
      ? body.receiptClassificationReason
      : null
    const receiptClassificationConfidence = clampConfidence(body.receiptClassificationConfidence)
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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `INSERT INTO construction_expenses (
           client_id, obra_id, created_by_user_id, title, category,
           vendor_name, amount_cents, expense_date, notes,
           receipt_number, receipt_total_cents, receipt_ocr_text, ocr_status,
           receipt_classification_source, receipt_classification_reason, receipt_classification_confidence,
           receipt_image_url, receipt_image_public_id, receipt_image_format,
           receipt_image_bytes, receipt_image_width, receipt_image_height, receipt_uploaded_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         RETURNING id, title, category, vendor_name, amount_cents,
                   expense_date, notes, receipt_number, receipt_total_cents,
                   receipt_ocr_text, ocr_status, receipt_classification_source,
                   receipt_classification_reason, receipt_classification_confidence,
                   created_at, obra_id,
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
          receiptClassificationSource,
          receiptClassificationReason,
          receiptClassificationConfidence,
          receiptImageUrl,
          receiptImagePublicId,
          receiptImageFormat,
          receiptImageBytes,
          receiptImageWidth,
          receiptImageHeight,
          receiptImageUrl ? new Date().toISOString() : null,
        ]
      )

      await logExpenseAudit({
        client,
        expenseId: rows[0].id,
        clientId: Number(auth.sub),
        actorUserId: Number(auth.sub),
        action: 'create',
        afterState: rows[0],
      })

      await client.query('COMMIT')
      return NextResponse.json(rows[0], { status: 201 })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}