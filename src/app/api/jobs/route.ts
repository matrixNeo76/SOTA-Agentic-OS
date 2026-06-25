import { NextRequest, NextResponse } from 'next/server'
import { enqueueJob, listJobs, jobStats, processNextJob, type JobType, type JobPriority } from '@/lib/kernel/scalability'
import { publishAgentEvent } from '@/lib/ws-publish'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  if (action === 'stats') {
    return NextResponse.json(await jobStats())
  }
  const jobs = await listJobs(30)
  return NextResponse.json({ jobs })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { action } = body

  if (action === 'enqueue') {
    const { jobType, payload, priority } = body
    const result = await enqueueJob(
      jobType as JobType,
      payload || {},
      (priority || 0) as JobPriority
    )
    await publishAgentEvent({
      agentId: 'scheduler', phase: '23',
      event: 'job_enqueued',
      payload: { jobId: result.jobId, jobType },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'process_next') {
    const result = await processNextJob()
    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
