/**
 * Tests for E2E Integration (Fase 4.2)
 *
 * Nota: NON usiamo _resetEventMeshForTests nei singoli describe perché
 * questo invaliderebbe le subscriptions create da startIntegrationLayer.
 * Usiamo un singolo beforeAll a livello di file per il setup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  startIntegrationLayer, stopIntegrationLayer,
  integrationLayerStatus, syncAgentLogToEventMesh, runFullSync,
} from '@/lib/integration/bridges'
import { publishTaskCreated, publishAgentSpawned, publishTaskFailed, publishApprovalRequested } from '@/lib/event-mesh/publishers'
import { createProvenance } from '@/lib/governance'
import { db } from '@/lib/db'
import { _resetEventMeshForTests } from '@/lib/event-mesh/mesh'

const VALID_PROV = createProvenance({
  agent: 'agent://test',
  source: 'system-event',
  confidence: 1.0,
})

// Setup globale: pulisce DB e resetta mesh una volta sola, poi avvia integration
beforeAll(async () => {
  await db.graphEdge.deleteMany({})
  await db.graphNode.deleteMany({})
  await db.agentLog.deleteMany({})
  await db.blockedAction.deleteMany({})
  _resetEventMeshForTests()
  await startIntegrationLayer()
})

afterAll(async () => {
  await stopIntegrationLayer()
})

describe('Integration Layer — start/stop', () => {
  it('start avvia i bridge di integrazione', async () => {
    // Verifica che è già stato avviato dal beforeAll globale
    const status = integrationLayerStatus()
    expect(status.started).toBe(true)
    expect(status.activeSubscriptions).toBeGreaterThan(0)
  })

  it('start è idempotente (second call ritorna started=false)', async () => {
    const result = await startIntegrationLayer()
    expect(result.started).toBe(false)
  })
})

describe('Integration Layer — Events → Context Graph', () => {
  it('TaskCreated event crea un GraphNode Task', async () => {
    const initialCount = await db.graphNode.count({ where: { entityType: 'Task' } })

    await publishTaskCreated(
      `task://integration-test-${Date.now()}`,
      'Integration test task',
      'agent://test',
      VALID_PROV,
    )

    // Attendi che il subscriber processi
    await new Promise((r) => setTimeout(r, 200))

    const afterCount = await db.graphNode.count({ where: { entityType: 'Task' } })
    expect(afterCount).toBeGreaterThan(initialCount)
  })

  it('AgentSpawned event crea un GraphNode Agent', async () => {
    const initialCount = await db.graphNode.count({ where: { entityType: 'Agent' } })

    await publishAgentSpawned(
      `agent://integration-test-${Date.now()}`,
      'test-role',
      ['test-capability'],
      VALID_PROV,
    )

    await new Promise((r) => setTimeout(r, 200))

    const afterCount = await db.graphNode.count({ where: { entityType: 'Agent' } })
    expect(afterCount).toBeGreaterThan(initialCount)
  })

  it('TaskFailed event crea un GraphNode Experience', async () => {
    const initialCount = await db.graphNode.count({ where: { entityType: 'Experience' } })

    await publishTaskFailed(
      `task://integration-fail-${Date.now()}`,
      'Integration test failure',
      false,
      VALID_PROV,
    )

    await new Promise((r) => setTimeout(r, 200))

    const afterCount = await db.graphNode.count({ where: { entityType: 'Experience' } })
    expect(afterCount).toBeGreaterThan(initialCount)
  })
})

describe('Integration Layer — AgentLog sync', () => {
  it('syncAgentLogToEventMesh processa AgentLog entries', async () => {
    // Inserisci un AgentLog con event=TaskCompleted
    await db.agentLog.create({
      data: {
        agentId: 'agent://test',
        phase: 'test',
        event: 'TaskCompleted',
        payload: JSON.stringify({
          taskUri: 'task://sync-test',
          result: 'success',
          durationMs: 1000,
        }),
        level: 'info',
      },
    })

    const result = await syncAgentLogToEventMesh({
      batchSize: 50,
      sinceMinutes: 5,
    })

    expect(result.processed).toBeGreaterThanOrEqual(0)
    expect(result.published + result.skipped).toBe(result.processed)
  })
})

describe('Integration Layer — runFullSync', () => {
  it('esegue sync completa e ritorna before/after stats', async () => {
    const result = await runFullSync()

    expect(result).toHaveProperty('agentLogSync')
    expect(result).toHaveProperty('contextGraphBefore')
    expect(result).toHaveProperty('contextGraphAfter')
    expect(result.contextGraphBefore).toHaveProperty('nodes')
    expect(result.contextGraphBefore).toHaveProperty('edges')
    expect(result.contextGraphAfter).toHaveProperty('nodes')
    expect(result.contextGraphAfter).toHaveProperty('edges')
  })
})

describe('Integration Layer — Autonomous Org → Sovereign Bridge', () => {
  it('ApprovalRequested event crea una BlockedAction', async () => {
    const initialCount = await db.blockedAction.count()

    await publishApprovalRequested(
      `proposal://test-${Date.now()}`,
      'Test approval request',
      'hitl_gate',
      VALID_PROV,
    )

    await new Promise((r) => setTimeout(r, 200))

    const afterCount = await db.blockedAction.count()
    expect(afterCount).toBeGreaterThan(initialCount)
  })
})

describe('Integration Layer — stop', () => {
  it('stopIntegrationLayer pulisce tutte le subscriptions', async () => {
    const before = integrationLayerStatus()
    expect(before.activeSubscriptions).toBeGreaterThan(0)

    await stopIntegrationLayer()

    const after = integrationLayerStatus()
    expect(after.started).toBe(false)
    expect(after.activeSubscriptions).toBe(0)
  })
})
