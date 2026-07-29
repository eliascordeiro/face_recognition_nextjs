import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
    if (!auth || auth.role !== 'employee' || !auth.employeeId || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const employeeId = Number(auth.employeeId)
    const clientId = Number(auth.clientId)
    if (!Number.isFinite(employeeId) || !Number.isFinite(clientId)) {
      return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })
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
            const result = await pool.query(
              `SELECT
                 COALESCE(MAX(r.updated_at), to_timestamp(0)) AS last_request_update,
                 COALESCE(MAX(e.created_at), to_timestamp(0)) AS last_event_at,
                 COUNT(*) FILTER (WHERE r.status = 'pending') AS pending_count
               FROM employee_requests r
               LEFT JOIN employee_request_events e ON e.request_id = r.id
               WHERE r.employee_id = $1 AND r.client_id = $2`,
              [employeeId, clientId]
            )

            const row = result.rows[0] ?? {}
            const token = `${asIso(row.last_request_update)}|${asIso(row.last_event_at)}|${String(row.pending_count ?? 0)}`
            if (token !== lastToken) {
              lastToken = token
              write(sseEvent('requests-updated', {
                token,
                pendingCount: Number(row.pending_count ?? 0),
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
