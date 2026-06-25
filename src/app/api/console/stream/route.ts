/**
 * API: /api/console/stream — Console Agentica con SSE streaming
 *
 * WS1.1 — La route è ora un thin trigger che delega all'executor durevole.
 *
 * Il flusso:
 *   1. POST con { task, mode } → startExecution({ task, onEvent })
 *   2. L'executor genera il piano, lo persiste, esegue i task
 *   3. Gli eventi vengono trasmessi via SSE tramite onEvent callback
 *   4. Il client riceve: plan_start, plan_chunk, plan_complete,
 *      task_start, task_chunk, task_complete, reflection_start/complete, done
 *
 * L'esecutore è persistente: lo stato vive nel DB (PlanTask.status).
 * Se il processo muore a metà, il recovery al boot riprende i task running.
 */

import { NextRequest } from 'next/server'
import { startExecution } from '@/lib/runtime/executor'
import { requireAuth } from '@/lib/auth/require-auth'
import { safeParse, consoleTaskSchema } from '@/lib/validation/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function encodeSSE(event: string, data: Record<string, unknown>): string {
  const payload = JSON.stringify(data)
  return `event: ${event}\ndata: ${payload}\n\n`
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const parsed = safeParse(consoleTaskSchema, body)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { task, mode } = parsed.data
  const planOnly = mode === 'plan-only'

  if (!task || typeof task !== 'string') {
    return new Response('task required', { status: 400 })
  }

  const encoder = new TextEncoder()
  const abortController = new AbortController()

  // Detect client disconnect
  req.signal.addEventListener('abort', () => {
    abortController.abort()
  })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        if (abortController.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(encodeSSE(event, data)))
        } catch {
          // controller already closed
        }
      }

      try {
        const result = await startExecution({
          task,
          planOnly,
          signal: abortController.signal,
          onEvent: send,
        })

        if ('error' in result) {
          send('error', { error: { message: result.error, phase: 'unknown' } })
          send('done', { ok: false, error: result.error })
        } else if ('result' in result) {
          send('done', { ok: true, result: result.result })
        } else {
          // async mode: { planId, jobId, async: true }
          send('done', { ok: true, result })
        }
      } catch (e: any) {
        send('error', { error: { message: e.message, phase: 'unknown' } })
        send('done', { ok: false, error: e.message })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
