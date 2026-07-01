/**
 * Tests for Event Mesh (Fase 2.1)
 *
 * Verifica:
 *   1. Backend in-memory è selezionato di default in dev
 *   2. publishEvent valida gli eventi (event-taxonomy)
 *   3. subscribeEvent riceve gli eventi pubblicati
 *   4. Handler errors non bloccano il publisher
 *   5. unsubscribe ferma la ricezione
 *   6. Publishers helper costruiscono eventi validi
 *   7. health() ritorna stato backend
 *   8. Audit trail su AgentLog
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  getEventMeshBackend, publishEvent, subscribeEvent,
  eventMeshHealth, _resetEventMeshForTests,
} from '@/lib/event-mesh/mesh'
import {
  publishTaskCreated, publishTaskCompleted, publishClaimCreated,
  publishConflictDetected, publishApprovalRequested,
} from '@/lib/event-mesh/publishers'
import { createProvenance, createEvent, eventToSubject, type SystemEvent } from '@/lib/governance'
import { db } from '@/lib/db'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

// Helper: deriva il subject come farebbe publishEvent
function subjectFor(type: string): string {
  return eventToSubject({ type, payload: {}, provenance: VALID_PROV } as SystemEvent)
}

describe('Event Mesh — backend selection', () => {
  beforeAll(() => {
    delete process.env.NATS_URL
    delete process.env.REDIS_URL
    _resetEventMeshForTests()
  })

  it('seleziona backend memory in dev (no NATS_URL/REDIS_URL)', () => {
    const backend = getEventMeshBackend()
    expect(backend.name).toBe('memory')
  })

  it('health() ritorna stato healthy per memory backend', async () => {
    const status = await eventMeshHealth()
    expect(status.backend).toBe('memory')
    expect(status.healthy).toBe(true)
  })
})

describe('Event Mesh — publish + subscribe (memory)', () => {
  beforeEach(() => {
    _resetEventMeshForTests()
  })

  it('publishEvent consegna l\'evento al subscriber registrato', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('TaskCreated'), async (event) => {
      received.push(event)
    })

    const event = createEvent({
      type: 'TaskCreated',
      payload: { taskUri: 'task://test-1', goal: 'test', assignedAgent: 'agent://planner' },
      provenance: VALID_PROV,
    })

    await publishEvent(event, subjectFor('TaskCreated'))

    expect(received.length).toBe(1)
    expect(received[0].type).toBe('TaskCreated')
    expect(received[0].payload.taskUri).toBe('task://test-1')
  })

  it('publishEvent valida l\'evento contro event-taxonomy', async () => {
    await expect(
      publishEvent({ type: 'InvalidEventType', payload: {}, provenance: VALID_PROV } as any, 'test'),
    ).rejects.toThrow(/Invalid event/)
  })

  it('handler error non blocca il publisher', async () => {
    const goodHandler = vi.fn()
    const badHandler = vi.fn().mockRejectedValue(new Error('boom'))

    await subscribeEvent(subjectFor('TaskFailed'), badHandler)
    await subscribeEvent(subjectFor('TaskFailed'), goodHandler)

    const event = createEvent({
      type: 'TaskFailed',
      payload: { taskUri: 'task://1', error: 'oops', recoverable: false },
      provenance: VALID_PROV,
    })

    // Non deve throware nonostante badHandler
    await publishEvent(event, subjectFor('TaskFailed'))

    expect(badHandler).toHaveBeenCalledTimes(1)
    expect(goodHandler).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe ferma la ricezione', async () => {
    const received: any[] = []
    const sub = await subscribeEvent(subjectFor('TaskBlocked'), async (event) => {
      received.push(event)
    })

    const event = createEvent({
      type: 'TaskBlocked',
      payload: { taskUri: 'task://1', reason: 'awaiting approval', source: 'hitl_gate' },
      provenance: VALID_PROV,
    })

    await publishEvent(event, subjectFor('TaskBlocked'))
    expect(received.length).toBe(1)

    await sub.unsubscribe()

    await publishEvent(event, subjectFor('TaskBlocked'))
    expect(received.length).toBe(1) // non incrementato
  })
})

describe('Event Mesh — publishers helpers', () => {
  beforeEach(() => {
    _resetEventMeshForTests()
  })

  it('publishTaskCreated consegna evento TaskCreated (subject derivato)', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('TaskCreated'), async (e) => received.push(e))

    await publishTaskCreated('task://123', 'analisi dati', 'agent://planner', VALID_PROV)

    expect(received.length).toBe(1)
    expect(received[0].type).toBe('TaskCreated')
    expect(received[0].payload.taskUri).toBe('task://123')
    expect(received[0].payload.goal).toBe('analisi dati')
    expect(received[0].payload.assignedAgent).toBe('agent://planner')
  })

  it('publishTaskCompleted include durationMs e result', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('TaskCompleted'), async (e) => received.push(e))

    await publishTaskCompleted('task://1', 'OK', 1234, VALID_PROV)

    expect(received[0].payload.durationMs).toBe(1234)
    expect(received[0].payload.result).toBe('OK')
  })

  it('publishClaimCreated consegna evento ClaimCreated', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('ClaimCreated'), async (e) => received.push(e))

    await publishClaimCreated('claim://c1', 'p=0.9', 0.9, VALID_PROV)

    expect(received[0].type).toBe('ClaimCreated')
    expect(received[0].payload.confidence).toBe(0.9)
  })

  it('publishConflictDetected consegna evento ConflictDetected', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('ConflictDetected'), async (e) => received.push(e))

    await publishConflictDetected('conflict://1', 'claim://a', 'claim://b', VALID_PROV)

    expect(received[0].type).toBe('ConflictDetected')
    expect(received[0].payload.claimA).toBe('claim://a')
    expect(received[0].payload.claimB).toBe('claim://b')
  })

  it('publishApprovalRequested consegna evento ApprovalRequested', async () => {
    const received: any[] = []
    await subscribeEvent(subjectFor('ApprovalRequested'), async (e) => received.push(e))

    await publishApprovalRequested('blocked://1', 'deploy', 'hitl_gate', VALID_PROV)

    expect(received[0].type).toBe('ApprovalRequested')
    expect(received[0].payload.blockedActionUri).toBe('blocked://1')
  })
})

describe('Event Mesh — audit trail (AgentLog)', () => {
  beforeAll(async () => {
    await db.agentLog.deleteMany({ where: { phase: 'event-mesh' } })
    _resetEventMeshForTests()
  })

  it('publishEvent persiste su AgentLog per audit', async () => {
    await publishTaskCreated('task://audit-test', 'test audit', 'agent://test', VALID_PROV)

    const logs = await db.agentLog.findMany({
      where: { phase: 'event-mesh', event: 'TaskCreated' },
      orderBy: { timestamp: 'desc' },
      take: 5,
    })

    expect(logs.length).toBeGreaterThan(0)
    const last = logs[0]!
    expect(last.payload).toContain('task://audit-test')
  })
})
