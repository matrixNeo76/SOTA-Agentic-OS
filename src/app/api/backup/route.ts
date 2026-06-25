import { NextRequest, NextResponse } from 'next/server'
import { createBackup, listBackups, backupStats } from '@/lib/kernel/observability'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const [backups, stats] = await Promise.all([listBackups(), backupStats()])
  return NextResponse.json({ backups, stats })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const result = await createBackup('manual')
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
