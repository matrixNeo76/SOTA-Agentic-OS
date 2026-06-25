import { NextRequest, NextResponse } from 'next/server'
import { scalabilityStats } from '@/lib/kernel/scalability'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const stats = await scalabilityStats()
  return NextResponse.json(stats)
}
