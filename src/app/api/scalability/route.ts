import { NextResponse } from 'next/server'
import { scalabilityStats } from '@/lib/kernel/scalability'

export async function GET() {
  const stats = await scalabilityStats()
  return NextResponse.json(stats)
}
