import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

const VALID_ACTIONS = new Set(['create', 'update', 'delete'])

function buildPeriodClause(period: string, params: Array<string | number>) {
  if (period === '7d') {
    return ` AND a.created_at >= NOW() - INTERVAL '7 days'`
  }
  if (period === '30d') {
    return ` AND a.created_at >= NOW() - INTERVAL '30 days'`
  }
  if (period === 'this_month') {
    return ` AND date_trunc('month', a.created_at) = date_trunc('month', NOW())`
  }
  if (period === 'last_month') {
    return ` AND date_trunc('month', a.created_at) = date_trunc('month', NOW() - INTERVAL '1 month')`
  }
  return ''
}

export async function GET(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'client') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const action = searchParams.get('action')
    const actor = searchParams.get('actor')
    const period = searchParams.get('period') ?? '30d'
    const query = (searchParams.get('q') ?? '').trim()
    const limitRaw = Number(searchParams.get('limit') ?? '8')
    const offsetRaw = Number(searchParams.get('offset') ?? '0')
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 8
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0

    const params: Array<string | number> = [auth.sub]
    let whereClause = 'WHERE a.client_id = $1'

    if (action && VALID_ACTIONS.has(action)) {
      params.push(action)
      whereClause += ` AND a.action = $${params.length}`
    }

    if (actor && actor !== 'all') {
      const actorId = Number(actor)
      if (Number.isFinite(actorId)) {
        params.push(actorId)
        whereClause += ` AND a.actor_user_id = $${params.length}`
      } else {
        params.push(actor)
        whereClause += ` AND COALESCE(u.username, '') = $${params.length}`
      }
    }

    if (query) {
      params.push(`%${query}%`)
      const queryParam = `$${params.length}`
      whereClause += ` AND (
        COALESCE(e.title, '') ILIKE ${queryParam}
        OR COALESCE(u.username, '') ILIKE ${queryParam}
        OR COALESCE(u.full_name, '') ILIKE ${queryParam}
        OR COALESCE(a.action, '') ILIKE ${queryParam}
      )`
    }

    whereClause += buildPeriodClause(period, params)

    const totalQuery = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM construction_expense_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereClause}`,
      params
    )

    const summaryQuery = await pool.query(
      `SELECT a.action, COUNT(*)::int AS count
       FROM construction_expense_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereClause}
       GROUP BY a.action`,
      params
    )

    const entryParams = [...params, limit, offset]
    const { rows } = await pool.query(
      `SELECT a.id, a.expense_id, a.action, a.before_state, a.after_state, a.created_at,
              u.id AS actor_user_id, u.username AS actor_username, u.full_name AS actor_full_name,
              e.title AS expense_title
       FROM construction_expense_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN construction_expenses e ON e.id = a.expense_id
       ${whereClause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${entryParams.length - 1}
       OFFSET $${entryParams.length}`,
      entryParams
    )

    const usersResult = await pool.query(
      `SELECT DISTINCT
              COALESCE(u.id::text, u.username, 'unknown') AS value,
              COALESCE(u.full_name, u.username, 'Usuário não identificado') AS label
       FROM construction_expense_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.client_id = $1
       ORDER BY label ASC`,
      [auth.sub]
    )

    const summary = { create: 0, update: 0, delete: 0 }
    for (const row of summaryQuery.rows) {
      if (row.action === 'create' || row.action === 'update' || row.action === 'delete') {
        const actionKey = row.action as 'create' | 'update' | 'delete'
        summary[actionKey] = row.count
      }
    }

    return NextResponse.json({
      entries: rows,
      total: totalQuery.rows[0]?.total ?? 0,
      summary,
      users: usersResult.rows,
      limit,
      offset,
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}