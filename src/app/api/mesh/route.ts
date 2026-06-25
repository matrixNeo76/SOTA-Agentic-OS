/**
 * GET /api/mesh — Event Mesh stats + health
 * POST /api/mesh/publish — publish an event manually (admin only)
 */

import { NextResponse } from 'next/server'
import { eventMeshHealth, publishEvent, _resetEventMeshForTests } from '@/lib/event-mesh/mesh'
import { createEvent } from '@/lib/governance'

export async function GET() {
  const health = await eventMeshHealth()
  return NextResponse.json(health)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { type, payload, provenance } = body

    if (!type || !payload || !provenance) {
      return NextResponse.json({ error: 'Missing type, payload, or provenance' }, { status: 400 })
    }

    const event = createEvent({ type, payload, provenance })
    await publishEvent(event)

    return NextResponse.json({ published: true, eventId: event.id, uri: event.uri })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
