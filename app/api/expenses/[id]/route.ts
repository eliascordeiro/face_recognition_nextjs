import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { logExpenseAudit } from '@/lib/expenseAudit'
import { deleteReceiptImage } from '@/lib/cloudinary'

const VALID_CATEGORIES = ['material', 'alimentacao', 'transporte', 'equipamento', 'servico', 'outros']

function toCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    const expenseId = Number(id)
    if (!Number.isFinite(expenseId)) {
      return NextResponse.json({ error: 'Gasto inválido' }, { status: 422 })
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

    const client = await pool.connect()
    let oldReceiptPublicIdToDelete: string | null = null
    try {
      await client.query('BEGIN')

      const before = await client.query(
        `SELECT * FROM construction_expenses WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [expenseId, auth.sub]
      )
      if (before.rowCount === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 })
      }

      const { rows, rowCount } = await client.query(
        `UPDATE construction_expenses
         SET obra_id = $1,
             title = $2,
             category = $3,
             vendor_name = $4,
             amount_cents = $5,
             expense_date = COALESCE($6::date, CURRENT_DATE),
             notes = $7,
             receipt_number = $8,
             receipt_total_cents = $9,
             receipt_ocr_text = $10,
             ocr_status = $11,
             receipt_image_url = $12,
             receipt_image_public_id = $13,
             receipt_image_format = $14,
             receipt_image_bytes = $15,
             receipt_image_width = $16,
             receipt_image_height = $17,
             receipt_uploaded_at = CASE WHEN $12 IS NOT NULL THEN COALESCE(receipt_uploaded_at, NOW()) ELSE NULL END
         WHERE id = $18 AND client_id = $19
         RETURNING id, title, category, vendor_name, amount_cents,
                   expense_date, notes, receipt_number, receipt_total_cents,
                   receipt_ocr_text, ocr_status, created_at, obra_id,
                   receipt_image_url, receipt_image_public_id, receipt_image_format,
                   receipt_image_bytes, receipt_image_width, receipt_image_height,
                   receipt_uploaded_at`,
        [
          obraId,
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
          expenseId,
          auth.sub,
        ]
      )

      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 })
      }

      await logExpenseAudit({
        client,
        expenseId,
        clientId: Number(auth.sub),
        actorUserId: Number(auth.sub),
        action: 'update',
        beforeState: before.rows[0],
        afterState: rows[0],
      })

      const previousPublicId = typeof before.rows[0].receipt_image_public_id === 'string'
        ? before.rows[0].receipt_image_public_id
        : null
      const nextPublicId = typeof rows[0].receipt_image_public_id === 'string'
        ? rows[0].receipt_image_public_id
        : null
      if (previousPublicId && previousPublicId !== nextPublicId) {
        oldReceiptPublicIdToDelete = previousPublicId
      }

      await client.query('COMMIT')

      if (oldReceiptPublicIdToDelete) {
        await deleteReceiptImage(oldReceiptPublicIdToDelete)
      }

      return NextResponse.json(rows[0])
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { id } = await params
    const expenseId = Number(id)
    if (!Number.isFinite(expenseId)) {
      return NextResponse.json({ error: 'Gasto inválido' }, { status: 422 })
    }

    const client = await pool.connect()
    let oldReceiptPublicIdToDelete: string | null = null
    try {
      await client.query('BEGIN')

      const before = await client.query(
        `SELECT * FROM construction_expenses WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [expenseId, auth.sub]
      )
      if (before.rowCount === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 })
      }

      const { rowCount } = await client.query(
        `DELETE FROM construction_expenses WHERE id = $1 AND client_id = $2`,
        [expenseId, auth.sub]
      )

      if (rowCount === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 })
      }

      await logExpenseAudit({
        client,
        expenseId,
        clientId: Number(auth.sub),
        actorUserId: Number(auth.sub),
        action: 'delete',
        beforeState: before.rows[0],
      })

      oldReceiptPublicIdToDelete = typeof before.rows[0].receipt_image_public_id === 'string'
        ? before.rows[0].receipt_image_public_id
        : null

      await client.query('COMMIT')

      if (oldReceiptPublicIdToDelete) {
        await deleteReceiptImage(oldReceiptPublicIdToDelete)
      }

      return new NextResponse(null, { status: 204 })
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