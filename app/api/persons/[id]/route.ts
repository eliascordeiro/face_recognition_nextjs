import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) throw new Error('embedding deve ser um array de 128 números')
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) throw new Error('embedding contém valores não numéricos')
  return raw as number[]
}

// ── PATCH /api/persons/[id] ───────────────────────────────────────────────────
// Atualiza dados cadastrais e/ou vincula o reconhecimento facial (embedding)
// depois do cadastro inicial — usado pelo modal "Reconhecimento facial".
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json()
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (typeof body.name === 'string') {
      if (body.name.trim().length < 2 || body.name.trim().length > 255) {
        return NextResponse.json({ error: 'Nome inválido (2–255 caracteres)' }, { status: 422 })
      }
      fields.push(`name = $${i++}`); values.push(body.name.trim())
    }
    if (typeof body.phone === 'string' || body.phone === null) {
      fields.push(`phone = $${i++}`); values.push(typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(0, 11) || null : null)
    }
    if (typeof body.email === 'string' || body.email === null) {
      fields.push(`email = $${i++}`); values.push(typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 255) : null)
    }
    if (typeof body.document === 'string' || body.document === null) {
      fields.push(`document = $${i++}`); values.push(typeof body.document === 'string' ? body.document.replace(/\D/g, '').slice(0, 14) || null : null)
    }
    if (typeof body.role === 'string' || body.role === null) {
      fields.push(`role = $${i++}`); values.push(typeof body.role === 'string' && body.role.trim() ? body.role.trim().slice(0, 100) : null)
    }
    if (typeof body.active === 'boolean') {
      fields.push(`active = $${i++}`); values.push(body.active)
    }
    if ('obraId' in body) {
      const obraId = body.obraId
      if (obraId !== null && (typeof obraId !== 'number' || !Number.isFinite(obraId))) {
        return NextResponse.json({ error: 'obraId inválido' }, { status: 422 })
      }
      fields.push(`obra_id = $${i++}`); values.push(obraId)
    }
    if (body.embedding != null) {
      const emb = parseEmbedding(body.embedding)
      fields.push(`embedding = $${i++}::vector`); values.push(`[${emb.join(',')}]`)
      if (typeof body.thumbnail === 'string') {
        fields.push(`thumbnail = $${i++}`); values.push(body.thumbnail)
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 422 })
    }

    values.push(id, auth.clientId)
    const { rows } = await pool.query(
      `UPDATE persons SET ${fields.join(', ')}
       WHERE id = $${i++} AND client_id = $${i++}
       RETURNING id, name, phone, email, document, role, active, thumbnail, created_at, obra_id, (embedding IS NOT NULL) AS has_face`,
      values
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })
    }
    return NextResponse.json(rows[0])
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE /api/persons/[id] ──────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr, 10)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Only delete persons belonging to this client
    const result = await pool.query(
      'DELETE FROM persons WHERE id = $1 AND client_id = $2 RETURNING id',
      [id, auth.clientId]
    )
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })
    }

    return new NextResponse(null, { status: 204 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
