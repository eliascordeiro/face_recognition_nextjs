import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

// PATCH /api/obras/[id] — atualiza obra
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
    const { name, address, lat, lng } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome da obra é obrigatório' }, { status: 422 })
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE obras SET name = $1, address = $2, lat = $3, lng = $4
       WHERE id = $5 AND client_id = $6
       RETURNING id, name, address, lat, lng, created_at`,
      [
        name.trim(),
        typeof address === 'string' ? address.trim() || null : null,
        typeof lat === 'number' && isFinite(lat) ? lat : null,
        typeof lng === 'number' && isFinite(lng) ? lng : null,
        Number(id),
        auth.sub,
      ]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
    return NextResponse.json(rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE /api/obras/[id] — remove obra
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
    const { rowCount } = await pool.query(
      `DELETE FROM obras WHERE id = $1 AND client_id = $2`,
      [Number(id), auth.sub]
    )
    if (rowCount === 0) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
