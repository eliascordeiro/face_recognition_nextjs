import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getClientScope(auth: { role: string; sub: string; clientId?: string | undefined }) {
  if (auth.role === 'client') return Number(auth.sub)
  if (auth.role === 'operator' && auth.clientId) return Number(auth.clientId)
  if (auth.role === 'admin') return null
  return NaN
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date(0).toISOString()
}

function sseEvent(name: string, payload: Record<string, unknown>) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}

export async function GET(request: NextRequest) {
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

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let pollTimer: ReturnType<typeof setInterval> | null = null
        let pingTimer: ReturnType<typeof setInterval> | null = null
        let lastToken = ''

        const write = (chunk: string) => {
          if (closed) return
          controller.enqueue(encoder.encode(chunk))
        }

        const cleanup = () => {
          if (closed) return
          closed = true
          if (pollTimer) clearInterval(pollTimer)
          if (pingTimer) clearInterval(pingTimer)
          request.signal.removeEventListener('abort', onAbort)
          controller.close()
        }

        const onAbort = () => {
          cleanup()
        }

        const poll = async () => {
          if (closed) return
          try {
            const requestQuery = scopeClientId == null
              ? `SELECT
                   COALESCE(MAX(updated_at), to_timestamp(0)) AS last_update,
                   COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
                 FROM employee_requests`
              : `SELECT
                   COALESCE(MAX(updated_at), to_timestamp(0)) AS last_update,
                   COUNT(*) FILTER (WHERE status = 'pending') AS pending_count
                 FROM employee_requests
                 WHERE client_id = $1`

            const requestResult = await pool.query(
              requestQuery,
              scopeClientId == null ? [] : [scopeClientId]
            )

            const notificationQuery = scopeClientId == null
              ? `SELECT
                   COALESCE(MAX(GREATEST(created_at, COALESCE(read_at, created_at))), to_timestamp(0)) AS last_notification_update,
                   COUNT(*) FILTER (WHERE is_read = FALSE) AS unread_count
                 FROM manager_notifications`
              : `SELECT
                   COALESCE(MAX(GREATEST(created_at, COALESCE(read_at, created_at))), to_timestamp(0)) AS last_notification_update,
                   COUNT(*) FILTER (WHERE is_read = FALSE) AS unread_count
                 FROM manager_notifications
                 WHERE client_id = $1`

            const notificationResult = await pool.query(
              notificationQuery,
              scopeClientId == null ? [] : [scopeClientId]
            )

            const requestRow = requestResult.rows[0] ?? {}
            const notificationRow = notificationResult.rows[0] ?? {}

            const token = [
              asIso(requestRow.last_update),
              String(requestRow.pending_count ?? 0),
              asIso(notificationRow.last_notification_update),
              String(notificationRow.unread_count ?? 0),
            ].join('|')

            if (token !== lastToken) {
              lastToken = token
              write(sseEvent('requests-updated', {
                token,
                pendingCount: Number(requestRow.pending_count ?? 0),
                unreadCount: Number(notificationRow.unread_count ?? 0),
                at: new Date().toISOString(),
              }))
            }
          } catch {
            write(sseEvent('stream-warning', {
              code: 'poll_failed',
              at: new Date().toISOString(),
            }))
          }
        }

        write(sseEvent('connected', { at: new Date().toISOString() }))
        void poll()

        pollTimer = setInterval(() => {
          void poll()
        }, 6000)

        pingTimer = setInterval(() => {
          write(sseEvent('ping', { at: new Date().toISOString() }))
        }, 15000)

        request.signal.addEventListener('abort', onAbort)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
