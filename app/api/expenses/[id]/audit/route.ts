import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export async function GET(
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

    const expenseCheck = await pool.query(
      `SELECT id FROM construction_expenses WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [expenseId, auth.sub]
    )
    if (expenseCheck.rowCount === 0) {
      return NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 })
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.expense_id, a.action, a.before_state, a.after_state, a.created_at,
              u.id AS actor_user_id, u.username AS actor_username, u.full_name AS actor_full_name
       FROM construction_expense_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.expense_id = $1 AND a.client_id = $2
       ORDER BY a.created_at DESC, a.id DESC`,
      [expenseId, auth.sub]
    )

    return NextResponse.json(rows)
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}