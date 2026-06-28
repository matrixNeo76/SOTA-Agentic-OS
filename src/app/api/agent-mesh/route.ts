/**
 * GET /api/agent-mesh — Mesh topology + stats
 * POST /api/agent-mesh/bootstrap — bootstrap default mesh
 * POST /api/agent-mesh/delegate — delegate a task
 * POST /api/agent-mesh/escalate — escalate an issue
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import {
  bootstrapDefaultMesh, getMeshTopology, meshStats,
  delegateTask, escalateIssue, requestPeerQuorum, meshProvenance,
} from '@/lib/agent-mesh/topology'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const [topology, stats] = await Promise.all([
    getMeshTopology(),
    meshStats(),
  ])
  return NextResponse.json({ topology, stats })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || meshProvenance()

    if (action === 'bootstrap') {
      const result = await bootstrapDefaultMesh(provenance)
      return NextResponse.json(result)
    }

    if (action === 'delegate') {
      const { fromAgentUri, toAgentUri, taskUri } = body
      if (!fromAgentUri || !toAgentUri || !taskUri) {
        return NextResponse.json({ error: 'Missing fromAgentUri, toAgentUri, or taskUri' }, { status: 400 })
      }
      const result = await delegateTask({ fromAgentUri, toAgentUri, taskUri, provenance })
      return NextResponse.json(result)
    }

    if (action === 'escalate') {
      const { fromAgentUri, toAgentUri, reason, severity } = body
      if (!fromAgentUri || !toAgentUri || !reason) {
        return NextResponse.json({ error: 'Missing fromAgentUri, toAgentUri, or reason' }, { status: 400 })
      }
      const result = await escalateIssue({
        fromAgentUri, toAgentUri, reason,
        severity: severity || 'medium',
        provenance,
      })
      return NextResponse.json(result)
    }

    if (action === 'quorum') {
      const { proposerAgentUri, proposal, requiredQuorum } = body
      if (!proposerAgentUri || !proposal || !requiredQuorum) {
        return NextResponse.json({ error: 'Missing proposerAgentUri, proposal, or requiredQuorum' }, { status: 400 })
      }
      const result = await requestPeerQuorum({ proposerAgentUri, proposal, requiredQuorum, provenance })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action. Use "bootstrap", "delegate", "escalate", or "quorum".' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
