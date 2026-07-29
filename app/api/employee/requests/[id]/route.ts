import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { id } = await params
    const requestId = Number(id)
    if (!Number.isFinite(requestId)) {
      return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 422 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    if (action !== 'cancel') {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 422 })
    }

    const updated = await pool.query(
      `UPDATE employee_requests
       SET status = 'cancelled',
           updated_at = NOW(),
           resolved_at = NOW()
       WHERE id = $1
         AND employee_id = $2
         AND status = 'pending'
       RETURNING id, status, updated_at, resolved_at`,
      [requestId, Number(auth.employeeId)]
    )

    if (!updated.rowCount) {
      return NextResponse.json({ error: 'Solicitação não pode ser cancelada.' }, { status: 409 })
    }

    return NextResponse.json(updated.rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
