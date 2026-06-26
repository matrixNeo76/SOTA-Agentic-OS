/**
 * POST /api/admin/settings/reload — Force cache reload from DB.
 *
 * Use after manual DB edits, after restoring a backup, or to pick up settings
 * written by another process instance in a multi-instance deployment.
 *
 * Auth: admin or operator (same as /api/admin/settings).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { reloadCache, isCacheLoaded } from '@/lib/settings'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const startedAt = Date.now()
  await reloadCache()
  const durationMs = Date.now() - startedAt

  return NextResponse.json({
    reloaded: true,
    durationMs,
    cacheLoaded: isCacheLoaded(),
  })
}

export async function GET(req: NextRequest) {
  // Convenience alias: GET also reloads (idempotent).
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  await reloadCache()
  return NextResponse.json({ reloaded: true })
}
