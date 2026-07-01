/**
 * GET /api/knowledge-extraction — extraction stats
 * POST /api/knowledge-extraction — extract a document
 *
 * C6.11 — Added requireAuth (was missing — security vulnerability).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/require-auth'
import { extractDocument, extractionProvenance } from '@/lib/knowledge-extraction/extractor'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const [documents, claims] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Document' } }),
    db.graphNode.count({ where: { entityType: 'Claim' } }),
  ])
  return NextResponse.json({ documentNodes: documents, claimNodes: claims })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { uri, content, mimeType, source, chunking } = body

    if (!uri || !content || !mimeType || !source) {
      return NextResponse.json({ error: 'Missing uri, content, mimeType, or source' }, { status: 400 })
    }

    const provenance = body.provenance || extractionProvenance()
    const result = await extractDocument({
      uri,
      content: Buffer.from(content, 'base64'),
      mimeType,
      source,
      chunking,
      provenance,
    })

    return NextResponse.json({
      document: result.document,
      chunks: result.chunks.length,
      entities: result.entities.length,
      relations: result.relations.length,
      graphNodesCreated: result.graphNodesCreated,
      graphEdgesCreated: result.graphEdgesCreated,
      embeddingsStored: result.embeddingsStored,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
