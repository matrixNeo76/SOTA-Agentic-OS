/**
 * withTenant — Helper per impostare il tenant context nelle API routes.
 *
 * Legge il cookie di sessione, verifica la sessione nel DB,
 * estrae organizationId + userId, e avvolge l'handler in runWithTenant.
 *
 * Usage:
 *   export async function GET(req: NextRequest) {
 *     return withTenant(req, async (ctx) => {
 *       const plans = await db.agentPlan.findMany() // auto-scoped per org!
 *       return NextResponse.json({ plans })
 *     })
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runWithTenant, type TenantContext } from '@/lib/tenant-context'

type Handler<T = unknown> = (ctx: TenantContext) => Promise<T>

/**
 * Wrap un API route handler con tenant context.
 *
 * Se la sessione non è valida, ritorna 401.
 * Se la sessione è valida, avvolge l'handler in runWithTenant.
 */
export async function withTenant<T = NextResponse>(
  req: NextRequest,
  handler: Handler<T>
): Promise<T> {
  const token = req.cookies.get('sota_session')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) as unknown as T
  }

  // Verify session
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!session || !session.user.active || session.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }) as unknown as T
  }

  const ctx: TenantContext = {
    organizationId: session.user.organizationId,
    userId: session.user.id,
  }

  return runWithTenant(ctx, () => handler(ctx))
}

/**
 * Versione che non blocca se la sessione non è valida (per route pubbliche o seed).
 * Usa 'default' come organizationId se non autenticato.
 */
export async function withTenantOrDefault<T = NextResponse>(
  req: NextRequest,
  handler: Handler<T>
): Promise<T> {
  const token = req.cookies.get('sota_session')?.value

  if (!token) {
    // No session — use default org
    return runWithTenant({ organizationId: 'default' }, () => handler({ organizationId: 'default' }))
  }

  try {
    const session = await db.session.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!session || !session.user.active || session.expiresAt < new Date()) {
      return runWithTenant({ organizationId: 'default' }, () => handler({ organizationId: 'default' }))
    }

    const ctx: TenantContext = {
      organizationId: session.user.organizationId,
      userId: session.user.id,
    }

    return runWithTenant(ctx, () => handler(ctx))
  } catch {
    // DB error — use default
    return runWithTenant({ organizationId: 'default' }, () => handler({ organizationId: 'default' }))
  }
}
