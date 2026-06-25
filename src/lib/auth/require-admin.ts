/**
 * requireAdmin.ts — WS2.1a
 *
 * Helper per API routes che richiedono ruolo admin o sovereign.
 * Estende requireAuth con check del ruolo.
 *
 * Usage:
 *   import { requireAdmin } from '@/lib/auth/require-admin'
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await requireAdmin(req)
 *     if (!auth.ok) return auth.response
 *     // ... admin-only logic
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, type AuthResult } from './require-auth'
import { hasRoleOrHigher, type Role } from './rbac'

export type AdminAuthResult =
  | { ok: true; userId: string; tenantId: string; email: string; name: string | null; role: string }
  | { ok: false; response: NextResponse }

/**
 * Verifica che la richiesta abbia una sessione valida E un ruolo admin o superiore.
 * Solo admin (4) e operator (3) possono accedere; sovereign (2) e viewer (1) no.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminAuthResult> {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth

  if (!hasRoleOrHigher(auth.role as Role, 'operator')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Insufficient permissions. Admin or Operator role required.' },
        { status: 403 },
      ),
    }
  }

  return auth
}
