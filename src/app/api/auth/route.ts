/**
 * Fase 20: Auth API routes — login, logout, me
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, createSession, verifySession, revokeSession } from '@/lib/auth/session'
import { ensureDefaultAdmin } from '@/lib/auth/session'
import { safeParse, loginSchema } from '@/lib/validation/schemas'

// Auto-create default admin on first load
let adminEnsured = false

export async function POST(req: NextRequest) {
  if (!adminEnsured) {
    await ensureDefaultAdmin()
    adminEnsured = true
  }

  const body = await req.json()
  const { action } = body
  if (action === 'login') {
    const parsed = safeParse(loginSchema, body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    }
  }

  if (action === 'login') {
    const { email, password } = body
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: 'Email e password obbligatori' }, { status: 400 })
    }
    const user = await authenticateUser(email, password)
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Credenziali non valide' }, { status: 401 })
    }
    const token = await createSession(user.userId)
    const res = NextResponse.json({
      ok: true,
      user: { email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
    })
    res.cookies.set('sota_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60, // 7 giorni
      path: '/',
    })
    return res
  }

  if (action === 'logout') {
    const token = req.cookies.get('sota_session')?.value
    if (token) await revokeSession(token)
    const res = NextResponse.json({ ok: true })
    res.cookies.delete('sota_session')
    return res
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('sota_session')?.value
  if (!token) {
    return NextResponse.json({ authenticated: false })
  }
  const user = await verifySession(token)
  if (!user) {
    return NextResponse.json({ authenticated: false })
  }
  return NextResponse.json({
    authenticated: true,
    user: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
  })
}
