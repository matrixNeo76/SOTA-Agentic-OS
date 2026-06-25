/**
 * GET /api/knowledge-extraction — extraction stats
 * POST /api/knowledge-extraction — extract a document
 */

import { NextResponse } from 'next/server'
import { extractDocument, extractionProvenance } from '@/lib/knowledge-extraction/extractor'
import { db } from '@/lib/db'

export async function GET() {
  const [documents, claims] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Document' } }),
    db.graphNode.count({ where: { entityType: 'Claim' } }),
  ])
  return NextResponse.json({ documentNodes: documents, claimNodes: claims })
}

export async function POST(req: Request) {
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
