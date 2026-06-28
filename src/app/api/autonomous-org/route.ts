/**
 * GET /api/autonomous-org — list pending proposals + stats
 * POST /api/autonomous-org — create or approve a proposal
 *   actions: create, approve, reject, generate-auto
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import {
  createProposal, approveProposal, rejectProposal,
  generateAutoProposals, listPendingProposals, getProposal,
  autonomousOrgStats, autonomousOrgProvenance,
  type ProposalType,
} from '@/lib/autonomous-org/governor'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const [pending, stats] = await Promise.all([
    listPendingProposals(50),
    autonomousOrgStats(),
  ])
  return NextResponse.json({ pending, stats })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || autonomousOrgProvenance()

    if (action === 'create') {
      const { type, description, rationale, expectedImpact, payload, expiresInHours } = body
      if (!type || !description || !rationale || !expectedImpact || !payload) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
      }
      const result = await createProposal({
        type: type as ProposalType,
        description, rationale, expectedImpact, payload, provenance,
        expiresInHours,
      })
      return NextResponse.json(result)
    }

    if (action === 'approve') {
      const { proposalUri, approvedBy } = body
      if (!proposalUri || !approvedBy) {
        return NextResponse.json({ error: 'Missing proposalUri or approvedBy' }, { status: 400 })
      }
      const result = await approveProposal({ proposalUri, approvedBy, provenance })
      return NextResponse.json(result)
    }

    if (action === 'reject') {
      const { proposalUri, rejectedBy, reason } = body
      if (!proposalUri || !rejectedBy || !reason) {
        return NextResponse.json({ error: 'Missing proposalUri, rejectedBy, or reason' }, { status: 400 })
      }
      await rejectProposal({ proposalUri, rejectedBy, reason, provenance })
      return NextResponse.json({ rejected: true })
    }

    if (action === 'generate-auto') {
      const { maxProposals } = body
      const proposals = await generateAutoProposals({ maxProposals, provenance })
      return NextResponse.json({ proposals })
    }

    return NextResponse.json({ error: 'Unknown action. Use "create", "approve", "reject", or "generate-auto".' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
