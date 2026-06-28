/**
 * POST /api/memory/manage — Memory entry management (delete/archive/restore)
 *
 * C6.14 — New API for memory lifecycle management from the Memory view.
 *
 * Actions:
 *   - delete:    hard-delete a memory entry
 *   - archive:   soft-archive (set weight to 0, mark for GC)
 *   - restore:   restore an archived entry (reset weight to default)
 *   - delete-all-archived: bulk delete all entries with weight=0
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { db } from '@/lib/db'

const VALID_ACTIONS = ['delete', 'archive', 'restore', 'delete-all-archived'] as const

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { action } = body as { action: string }

  if (!action || !VALID_ACTIONS.includes(action as any)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  // === delete ===
  if (action === 'delete') {
    const { id } = body as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Try MemoryEntry first, then EpisodicMemory, then SemanticEntity
    const memEntry = await db.memoryEntry.findUnique({ where: { id }, select: { id: true } })
    if (memEntry) {
      await db.memoryEntry.delete({ where: { id } })
      return NextResponse.json({ deleted: true, id, source: 'MemoryEntry' })
    }

    const epEntry = await db.episodicMemory.findUnique({ where: { id }, select: { id: true } })
    if (epEntry) {
      await db.episodicMemory.delete({ where: { id } })
      return NextResponse.json({ deleted: true, id, source: 'EpisodicMemory' })
    }

    const semEntity = await db.semanticEntity.findUnique({ where: { id }, select: { id: true } })
    if (semEntity) {
      await db.semanticEntity.delete({ where: { id } })
      return NextResponse.json({ deleted: true, id, source: 'SemanticEntity' })
    }

    return NextResponse.json({ error: `Entry not found: ${id}` }, { status: 404 })
  }

  // === archive ===
  if (action === 'archive') {
    const { id } = body as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Archive = set weight to 0 (GC will pick it up)
    const mem = await db.memoryEntry.findUnique({ where: { id }, select: { id: true } })
    if (mem) {
      await db.memoryEntry.update({ where: { id }, data: { weight: 0, utilityScore: 0 } })
      return NextResponse.json({ archived: true, id })
    }
    return NextResponse.json({ error: `Memory entry not found: ${id}` }, { status: 404 })
  }

  // === restore ===
  if (action === 'restore') {
    const { id } = body as { id?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const mem = await db.memoryEntry.findUnique({ where: { id }, select: { id: true } })
    if (mem) {
      await db.memoryEntry.update({
        where: { id },
        data: { weight: 0.5, utilityScore: 0.5, recencyScore: 1.0 },
      })
      return NextResponse.json({ restored: true, id })
    }
    return NextResponse.json({ error: `Memory entry not found: ${id}` }, { status: 404 })
  }

  // === delete-all-archived ===
  if (action === 'delete-all-archived') {
    const result = await db.memoryEntry.deleteMany({
      where: { weight: 0 },
    })
    return NextResponse.json({
      deleted: true,
      count: result.count,
      message: `${result.count} archived entries deleted`,
    })
  }

  return NextResponse.json({ error: 'Unhandled action' }, { status: 500 })
}
