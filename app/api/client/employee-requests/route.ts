import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const

function getClientScope(auth: { role: string; sub: string; clientId?: string | undefined }) {
  if (auth.role === 'client') return Number(auth.sub)
  if (auth.role === 'operator' && auth.clientId) return Number(auth.clientId)
  if (auth.role === 'admin') return null
  return NaN
}

export async function GET(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const scopeClientId = getClientScope(auth)
    if (!Number.isFinite(scopeClientId) && scopeClientId !== null) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = (searchParams.get('status') ?? 'pending').trim()

    const where: string[] = []
    const params: Array<number | string> = []

    if (scopeClientId != null) {
      params.push(scopeClientId)
      where.push(`r.client_id = $${params.length}`)
    }

    if (status !== 'all' && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      params.push(status)
      where.push(`r.status = $${params.length}`)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const requestsResult = await pool.query(
      `SELECT r.id, r.type, r.title, r.description, r.amount_cents, r.status,
              r.manager_note, r.created_at, r.updated_at, r.resolved_at,
              p.id AS employee_id, p.name AS employee_name,
              o.id AS obra_id, o.name AS obra_name,
              COALESCE(att.attachments, '[]'::json) AS attachments,
              COALESCE(evt.events, '[]'::json) AS events
       FROM employee_requests r
       INNER JOIN persons p ON p.id = r.employee_id
       LEFT JOIN obras o ON o.id = r.obra_id
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'id', a.id,
             'url', a.url,
             'publicId', a.public_id,
             'originalFilename', a.original_filename,
             'mimeType', a.mime_type,
             'format', a.format,
             'bytes', a.bytes,
             'width', a.width,
             'height', a.height,
             'createdAt', a.created_at
           )
           ORDER BY a.created_at ASC
         ) AS attachments
         FROM employee_request_attachments a
         WHERE a.request_id = r.id
       ) att ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'id', e.id,
             'eventType', e.event_type,
             'message', e.message,
             'actorRole', e.actor_role,
             'createdAt', e.created_at,
             'metadata', e.metadata
           )
           ORDER BY e.created_at ASC
         ) AS events
         FROM employee_request_events e
         WHERE e.request_id = r.id
       ) evt ON TRUE
       ${whereSql}
       ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 120`,
      params
    )

    const notificationsResult = await pool.query(
      `SELECT n.id, n.request_id, n.title, n.message, n.is_read, n.created_at
       FROM manager_notifications n
       ${scopeClientId != null ? 'WHERE n.client_id = $1' : ''}
       ORDER BY n.created_at DESC
       LIMIT 50`,
      scopeClientId != null ? [scopeClientId] : []
    )

    const unreadCount = notificationsResult.rows.reduce((sum, row) => sum + (row.is_read ? 0 : 1), 0)

    return NextResponse.json({
      requests: requestsResult.rows,
      notifications: notificationsResult.rows,
      unreadCount,
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || (auth.role !== 'client' && auth.role !== 'operator' && auth.role !== 'admin')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const scopeClientId = getClientScope(auth)
    if (!Number.isFinite(scopeClientId) && scopeClientId !== null) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const requestId = Number(body.requestId)
    const status = typeof body.status === 'string' ? body.status : ''
    const managerNote = typeof body.managerNote === 'string' ? body.managerNote.trim().slice(0, 1200) : null
    const markNotificationReadIds = Array.isArray(body.markNotificationReadIds)
      ? body.markNotificationReadIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : []

    if (markNotificationReadIds.length > 0) {
      const placeholders = markNotificationReadIds.map((_, index) => `$${index + 1}`).join(', ')
      const params = [...markNotificationReadIds]
      const scopeClause = scopeClientId != null ? ` AND client_id = $${params.length + 1}` : ''
      if (scopeClientId != null) params.push(scopeClientId)
      await pool.query(
        `UPDATE manager_notifications
         SET is_read = TRUE,
             read_at = NOW()
         WHERE id IN (${placeholders})${scopeClause}`,
        params
      )
    }

    if (!Number.isFinite(requestId) || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]) || status === 'pending') {
      return NextResponse.json({ ok: true })
    }

    const params: Array<number | string | null> = [status, managerNote, requestId]
    let scopeSql = ''
    if (scopeClientId != null) {
      params.push(scopeClientId)
      scopeSql = ` AND client_id = $${params.length}`
    }

    const updated = await pool.query(
      `UPDATE employee_requests
       SET status = $1,
           manager_note = $2,
           updated_at = NOW(),
           resolved_at = CASE WHEN $1 IN ('approved', 'rejected', 'cancelled') THEN NOW() ELSE resolved_at END
       WHERE id = $3${scopeSql}
       RETURNING id, status, manager_note, updated_at, resolved_at`,
      params
    )

    if (!updated.rowCount) {
      return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 })
    }

    const actorUserId = Number(auth.sub)
    await pool.query(
      `INSERT INTO employee_request_events (
         request_id, client_id, actor_role, actor_user_id, event_type, message, metadata
       )
       SELECT r.id, r.client_id, $2, $3, 'status_changed', $4, $5::jsonb
       FROM employee_requests r
       WHERE r.id = $1
       LIMIT 1`,
      [
        requestId,
        auth.role,
        Number.isFinite(actorUserId) ? actorUserId : null,
        managerNote
          ? `Status alterado para ${status} com observação do gestor`
          : `Status alterado para ${status}`,
        JSON.stringify({
          status,
          managerNote,
        }),
      ]
    )

    return NextResponse.json(updated.rows[0])
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
