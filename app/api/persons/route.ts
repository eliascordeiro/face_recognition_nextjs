import { NextRequest, NextResponse } from 'next/server'
import pool, { initDb } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { hasCapability } from '@/lib/permissions'
import bcrypt from 'bcryptjs'

function parseEmbedding(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 128) throw new Error('embedding deve ser um array de 128 números')
  if (!raw.every((v) => typeof v === 'number' && isFinite(v))) throw new Error('embedding contém valores não numéricos')
  return raw as number[]
}

// GET /api/persons — lista funcionários do cliente autenticado
// Operadores só veem a lista se tiverem a capacidade 'employees.view' — e,
// se estiverem vinculados a uma obra específica, só os funcionários dela.
export async function GET() {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    if (!hasCapability(auth, 'employees.view')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const params: (string | number)[] = [auth.clientId]
    let obraFilter = ''
    if (auth.role === 'operator' && auth.obraId) {
      params.push(Number(auth.obraId))
      obraFilter = ` AND obra_id = $${params.length}`
    }

    const { rows } = await pool.query(
      `SELECT id, name, phone, email, document, role, active, thumbnail, created_at, obra_id,
              (embedding IS NOT NULL) AS has_face,
              (access_password_hash IS NOT NULL) AS has_password_access,
              allow_face_login
       FROM persons WHERE client_id = $1${obraFilter} ORDER BY created_at DESC`,
      params
    )
    return NextResponse.json(rows)
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST /api/persons — cadastra funcionário vinculado ao cliente
// O reconhecimento facial (embedding) é opcional neste momento: pode ser
// cadastrado depois, através do botão "Reconhecimento facial" na listagem.
// Requer a capacidade 'employees.manage' quando o autor é um operador.
export async function POST(request: NextRequest) {
  try {
    await initDb()
    const auth = await getAuthUser()
    if (!auth || !auth.clientId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    if (!hasCapability(auth, 'employees.manage')) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const { name, phone, email, document, role, embedding, thumbnail, accessPassword } = await request.json()

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
      return NextResponse.json({ error: 'Nome inválido (2–255 caracteres)' }, { status: 422 })
    }

    const vectorStr = embedding != null ? `[${parseEmbedding(embedding).join(',')}]` : null
    if (accessPassword != null && (typeof accessPassword !== 'string' || accessPassword.length < 6)) {
      return NextResponse.json({ error: 'Senha de acesso deve ter no mínimo 6 caracteres' }, { status: 422 })
    }
    const accessPasswordHash = typeof accessPassword === 'string' && accessPassword.length >= 6
      ? await bcrypt.hash(accessPassword, 10)
      : null
    const cleanPhone = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(0, 11) || null : null
    const cleanDocument = typeof document === 'string' ? document.replace(/\D/g, '').slice(0, 14) || null : null
    const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().slice(0, 255) : null
    const cleanRole = typeof role === 'string' && role.trim() ? role.trim().slice(0, 100) : null
    if (accessPasswordHash && !cleanEmail) {
      return NextResponse.json({ error: 'Informe um e-mail para habilitar acesso com senha.' }, { status: 422 })
    }
    // Operador vinculado a uma obra: funcionário criado por ele já nasce
    // alocado nessa mesma obra (mantém o escopo consistente).
    const obraId = auth.role === 'operator' && auth.obraId ? Number(auth.obraId) : null

    const { rows } = await pool.query(
      `INSERT INTO persons (name, phone, email, document, role, embedding, thumbnail, client_id, obra_id, access_password_hash, allow_face_login)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11)
       RETURNING id, name, phone, email, document, role, active, created_at, obra_id,
                 (embedding IS NOT NULL) AS has_face,
                 (access_password_hash IS NOT NULL) AS has_password_access,
                 allow_face_login`,
      [
        name.trim(),
        cleanPhone,
        cleanEmail,
        cleanDocument,
        cleanRole,
        vectorStr,
        typeof thumbnail === 'string' ? thumbnail : null,
        auth.clientId,
        obraId,
        accessPasswordHash,
        Boolean(accessPasswordHash && vectorStr),
      ]
    )
    return NextResponse.json(rows[0], { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

