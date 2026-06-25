/**
 * GET /api/agent-lifecycle — stats + agent list
 * POST /api/agent-lifecycle — register/suspend/resume/deprecate/upgrade
 */

import { NextResponse } from 'next/server'
import {
  registerAgent, getAgent, suspendAgent, resumeAgent, deprecateAgent,
  upgradeAgentVersion, listAgentVersions, checkPermission, agentLifecycleStats,
  agentLifecycleProvenance,
} from '@/lib/agent-lifecycle/manager'
import { db } from '@/lib/db'

export async function GET() {
  const [stats, agents] = await Promise.all([
    agentLifecycleStats(),
    db.graphNode.findMany({ where: { entityType: 'Agent' }, take: 50, orderBy: { createdAt: 'desc' } }),
  ])
  return NextResponse.json({ stats, agents })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || agentLifecycleProvenance()

    if (action === 'register') {
      const { name, description, version, roles, capabilities, skills, policies, parentAgent } = body
      if (!name || !description) {
        return NextResponse.json({ error: 'Missing name or description' }, { status: 400 })
      }
      const result = await registerAgent({
        name, description, version, roles, capabilities, skills, policies, parentAgent, provenance,
      })
      return NextResponse.json(result)
    }

    if (action === 'suspend') {
      const { agentUri, reason } = body
      if (!agentUri || !reason) return NextResponse.json({ error: 'Missing agentUri or reason' }, { status: 400 })
      await suspendAgent(agentUri, reason, provenance)
      return NextResponse.json({ suspended: true })
    }

    if (action === 'resume') {
      const { agentUri } = body
      if (!agentUri) return NextResponse.json({ error: 'Missing agentUri' }, { status: 400 })
      await resumeAgent(agentUri, provenance)
      return NextResponse.json({ resumed: true })
    }

    if (action === 'upgrade') {
      const { agentUri, newVersion, changes, evaluationScore } = body
      if (!agentUri || !newVersion || !changes) {
        return NextResponse.json({ error: 'Missing agentUri, newVersion, or changes' }, { status: 400 })
      }
      const result = await upgradeAgentVersion({ agentUri, newVersion, changes, evaluationScore, provenance })
      return NextResponse.json(result)
    }

    if (action === 'check-permission') {
      const { agentUri, permission } = body
      if (!agentUri || !permission) {
        return NextResponse.json({ error: 'Missing agentUri or permission' }, { status: 400 })
      }
      const result = await checkPermission({ agentUri, permission })
      return NextResponse.json(result)
    }

    if (action === 'list-versions') {
      const { agentUri } = body
      if (!agentUri) return NextResponse.json({ error: 'Missing agentUri' }, { status: 400 })
      const versions = await listAgentVersions(agentUri)
      return NextResponse.json({ versions })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
