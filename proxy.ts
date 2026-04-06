import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'change-this-secret-in-production'
)

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Deixa passar rotas públicas e assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/models') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get('auth_token')?.value

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    const role = payload.role as string
    const clientId = payload.clientId as string | undefined

    // ── Redirecionamento raiz por papel ────────────────────────────────
    if (pathname === '/') {
      if (role === 'admin') return NextResponse.redirect(new URL('/admin', request.url))
      if (role === 'client') return NextResponse.redirect(new URL('/client', request.url))
      if (role === 'operator') return NextResponse.redirect(new URL('/recognize', request.url))
    }

    // ── Área do Admin ──────────────────────────────────────────────────
    if (pathname.startsWith('/admin')) {
      if (role !== 'admin') {
        if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
        return NextResponse.redirect(new URL('/login', request.url))
      }
    }

    // ── Área do Cliente ────────────────────────────────────────────────
    if (pathname.startsWith('/client')) {
      if (role === 'admin') return NextResponse.redirect(new URL('/admin', request.url))
      if (role === 'operator') return NextResponse.redirect(new URL('/recognize', request.url))
      // Only 'client' reaches here
    }

    // ── Página de reconhecimento (operador/cliente) ────────────────────
    if (pathname === '/recognize') {
      if (role === 'admin') return NextResponse.redirect(new URL('/admin', request.url))
      if (role === 'client') return NextResponse.redirect(new URL('/client', request.url))
    }

    // ── API /api/users — admin + client, not operator ──────────────────
    if (pathname.startsWith('/api/users')) {
      if (role === 'operator') {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
      }
    }

    // ── API /api/persons e /api/recognize — client + operator only ──────
    if (pathname.startsWith('/api/persons') || pathname.startsWith('/api/recognize')) {
      if (role === 'admin') {
        return NextResponse.json({ error: 'Acesso negado — use um cliente ou operador' }, { status: 403 })
      }
      if (!clientId) {
        return NextResponse.json({ error: 'client_id não definido no token' }, { status: 403 })
      }
    }

    return NextResponse.next()
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.delete('auth_token')
    return response
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
