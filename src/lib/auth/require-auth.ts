/**
 * require-auth.ts — Fase Alpha α3
 *
 * Helper per auth interna API routes.
 * Verifica cookie sota_session → estrae userId/tenantId → ritorna user o 401.
 *
 * Pattern di utilizzo:
 *   import { requireAuth } from '@/lib/auth/require-auth'
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await requireAuth(req)
 *     if (!auth.ok) return auth.response
 *     const { userId, tenantId } = auth
 *     // ... route logic
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from './session'

export type AuthResult =
  | { ok: true; userId: string; tenantId: string; email: string; name: string | null; role: string }
  | { ok: false; response: NextResponse }

/**
 * Verifica che la richiesta abbia una sessione valida.
 * Ritorna AuthResult: se ok=true contiene userId/tenantId, se ok=false contiene la risposta 401.
 */
export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const token = req.cookies.get('sota_session')?.value

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  const session = await verifySession(token)

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }),
    }
  }

  return {
    ok: true,
    userId: session.userId,
    tenantId: session.tenantId,
    email: session.email,
    name: session.name,
    role: session.role,
  }
}
