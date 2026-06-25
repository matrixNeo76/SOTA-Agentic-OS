/**
 * API: /api/memory
 * GET  - elenca memorie (episodica, semantica, logica) + stats
 * POST - registra una nuova osservazione / entità / regola
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  recordEpisode, upsertEntity, addLogicalRule,
  recentEpisodes, semanticSearch, getLogicalDAG, memoryStats,
} from '@/lib/kernel/ns-mem'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth/require-auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'

  if (action === 'search') {
    const q = searchParams.get('q') || ''
    const k = Number(searchParams.get('k') || 5)
    const results = await semanticSearch(q, k)
    return NextResponse.json({ results })
  }

  if (action === 'dag') {
    const dag = await getLogicalDAG()
    return NextResponse.json({ dag })
  }

  // default: list
  const [episodes, stats, entities, rules] = await Promise.all([
    recentEpisodes(30),
    memoryStats(),
    db.semanticEntity.findMany({ take: 30, orderBy: { updatedAt: 'desc' } }),
    db.logicalRule.findMany({ where: { active: true }, orderBy: { priority: 'asc' } }),
  ])
  return NextResponse.json({ episodes, stats, entities, rules })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const body = await req.json()
  const { type } = body

  if (type === 'episode') {
    await recordEpisode(body.observation, body.source, body.agentId, body.tags)
    return NextResponse.json({ ok: true, message: 'Episodio registrato' })
  }
  if (type === 'entity') {
    await upsertEntity(body.name, body.type, body.description, body.attributes)
    return NextResponse.json({ ok: true, message: 'Entità upserted' })
  }
  if (type === 'rule') {
    await addLogicalRule(body.ruleId, body.expression, body.dependencies || [], body.priority || 0)
    return NextResponse.json({ ok: true, message: 'Regola logica aggiunta' })
  }

  return NextResponse.json({ ok: false, error: 'Tipo non riconosciuto' }, { status: 400 })
}
