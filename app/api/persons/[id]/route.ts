import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

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
