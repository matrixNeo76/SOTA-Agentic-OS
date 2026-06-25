/**
 * GET /api/admin/api-keys — List all API keys
 * POST /api/admin/api-keys — Create a new API key (returns full key once)
 * DELETE /api/admin/api-keys — Revoke a key
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createApiKey, listApiKeys, revokeApiKey, type ApiScope } from '@/lib/auth/api-key'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const keys = await listApiKeys()
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const body = await req.json()

  if (body.action === 'revoke') {
    const { keyId, reason } = body
    if (!keyId) return NextResponse.json({ error: 'Missing keyId' }, { status: 400 })
    await revokeApiKey(keyId, reason || 'Revoked via admin')
    return NextResponse.json({ revoked: true })
  }

  // Create new key
  const { name, scopes, expiresAt } = body
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })

  const validScopes = (scopes || ['read']).filter((s: string) => ['read', 'exec', 'admin'].includes(s)) as ApiScope[]
  if (validScopes.length === 0) {
    return NextResponse.json({ error: 'Invalid scopes. Use: read, exec, admin' }, { status: 400 })
  }

  const result = await createApiKey({
    name,
    scopes: validScopes,
    createdBy: auth.email,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  })

  return NextResponse.json({
    keyId: result.keyId,
    fullKey: result.fullKey,
    warning: 'Save this key now — the full key cannot be retrieved again.',
  })
}
