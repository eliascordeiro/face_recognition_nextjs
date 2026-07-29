import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'

type RequestType = 'advance' | 'occurrence' | 'absence' | 'material_request'

const VALID_TYPES: RequestType[] = ['advance', 'occurrence', 'absence', 'material_request']

function toCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/[^0-9,.-]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}\.\d{3}$/.test(cleaned)) {
    normalized = cleaned.replace('.', '')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100)
}

function getTypeLabel(type: RequestType) {
  if (type === 'advance') return 'Adiantamento'
  if (type === 'occurrence') return 'Ocorrência'
  if (type === 'absence') return 'Justificativa de ausência'
  return 'Solicitação de material'
}

export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const result = await pool.query(
      `SELECT r.id, r.type, r.title, r.description, r.amount_cents, r.status,
              r.manager_note, r.created_at, r.updated_at, r.resolved_at,
              o.name AS obra_name
       FROM employee_requests r
       LEFT JOIN obras o ON o.id = r.obra_id
       WHERE r.employee_id = $1
       ORDER BY r.created_at DESC
       LIMIT 40`,
      [Number(auth.employeeId)]
    )

    return NextResponse.json(result.rows)
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || auth.role !== 'employee' || !auth.employeeId || !auth.clientId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const type = typeof body.type === 'string' && VALID_TYPES.includes(body.type as RequestType)
      ? (body.type as RequestType)
      : 'occurrence'
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : ''
    const amountCents = toCents(body.amount)

    if (title.length < 3) {
      return NextResponse.json({ error: 'Informe um título com pelo menos 3 caracteres.' }, { status: 422 })
    }

    if (type === 'advance' && (amountCents == null || amountCents <= 0)) {
      return NextResponse.json({ error: 'Informe um valor válido para o adiantamento.' }, { status: 422 })
    }

    const personResult = await pool.query(
      `SELECT id, name, obra_id FROM persons WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [Number(auth.employeeId), Number(auth.clientId)]
    )
    if (!personResult.rowCount) {
      return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 })
    }

    const person = personResult.rows[0]
    const created = await pool.query(
      `INSERT INTO employee_requests (
         client_id, employee_id, obra_id, type, title, description, amount_cents, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id, type, title, description, amount_cents, status,
                 manager_note, created_at, updated_at, resolved_at`,
      [
        Number(auth.clientId),
        Number(auth.employeeId),
        person.obra_id != null ? Number(person.obra_id) : null,
        type,
        title,
        description || null,
        type === 'advance' ? amountCents : null,
      ]
    )

    const requestRow = created.rows[0]
    const amountLabel = requestRow.amount_cents != null
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(requestRow.amount_cents) / 100)
      : null

    await pool.query(
      `INSERT INTO manager_notifications (client_id, request_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        Number(auth.clientId),
        Number(requestRow.id),
        `Nova solicitação: ${getTypeLabel(type)}`,
        `${person.name} abriu ${getTypeLabel(type).toLowerCase()}${amountLabel ? ` no valor de ${amountLabel}` : ''}.`,
      ]
    )

    return NextResponse.json(requestRow, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
