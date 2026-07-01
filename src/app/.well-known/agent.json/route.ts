/**
 * /.well-known/agent.json — A2A Agent Card
 *
 * Pubblicata per discovery da parte di agenti esterni.
 * Segue la specifica A2A (Google/Linux Foundation).
 */

import { NextResponse } from 'next/server'
import { getAgentCard } from '@/lib/a2a/protocol'

export async function GET() {
  const card = await getAgentCard()
  return NextResponse.json(card, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
