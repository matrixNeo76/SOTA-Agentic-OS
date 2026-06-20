import { NextRequest, NextResponse } from 'next/server'
import { createBackup, listBackups, backupStats } from '@/lib/kernel/observability'

export async function GET() {
  const [backups, stats] = await Promise.all([listBackups(), backupStats()])
  return NextResponse.json({ backups, stats })
}

export async function POST() {
  try {
    const result = await createBackup('manual')
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
