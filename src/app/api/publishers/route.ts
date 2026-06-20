import { NextRequest, NextResponse } from 'next/server'
import { registerPublisher, listPublishers, revokePublisher, installSignedTool, verifyInstalledTool } from '@/lib/kernel/crypto-trust'
import { publishAgentEvent } from '@/lib/ws-publish'

export async function GET() {
  const publishers = await listPublishers()
  return NextResponse.json({ publishers })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'register') {
    const { publisher } = body
    const result = await registerPublisher(publisher)
    await publishAgentEvent({
      agentId: 'crypto', phase: '21',
      event: 'publisher_registered',
      payload: { publisher, fingerprint: result.fingerprint },
    })
    // Non ritornare la private key in produzione! Qui solo per demo
    return NextResponse.json({ ok: true, publisher: result.publisher, fingerprint: result.fingerprint })
  }

  if (action === 'revoke') {
    const { publisher, reason } = body
    await revokePublisher(publisher, reason || 'revoked by admin')
    return NextResponse.json({ ok: true })
  }

  if (action === 'install_signed') {
    const { toolId, name, version, description, publisher } = body
    const result = await installSignedTool({ toolId, name, version, description, publisher }, 'admin')
    await publishAgentEvent({
      agentId: 'crypto', phase: '21',
      event: 'signed_tool_installed',
      payload: { toolId, publisher, fingerprint: result.fingerprint },
    })
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === 'verify') {
    const { toolId } = body
    const result = await verifyInstalledTool(toolId)
    return NextResponse.json(result)
  }

  return NextResponse.json({ ok: false, error: 'Action non riconosciuta' }, { status: 400 })
}
