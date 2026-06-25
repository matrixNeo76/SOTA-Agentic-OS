/**
 * GET /api/code-intelligence — stats (function/file counts)
 * POST /api/code-intelligence — parse a file or analyze a git diff
 */

import { NextResponse } from 'next/server'
import {
  parseFile, syncToGraph, analyzeGitDiff, codeAnalysisProvenance,
} from '@/lib/code-intelligence/parser'
import { db } from '@/lib/db'

export async function GET() {
  const [files, functions] = await Promise.all([
    db.graphNode.count({ where: { entityType: 'Document' } }),
    db.graphEdge.count({ where: { relationType: { in: ['CONTAINS', 'CALLS', 'IMPORTS'] } } }),
  ])
  return NextResponse.json({ documentNodes: files, codeEdges: functions })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body
    const provenance = body.provenance || codeAnalysisProvenance()

    if (action === 'parse') {
      const { filePath, content } = body
      if (!filePath || !content) {
        return NextResponse.json({ error: 'Missing filePath or content' }, { status: 400 })
      }
      const ast = parseFile(filePath, content)
      if (!ast) {
        return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      }
      return NextResponse.json({ ast })
    }

    if (action === 'sync') {
      const { filePath, content, repo } = body
      if (!filePath || !content) {
        return NextResponse.json({ error: 'Missing filePath or content' }, { status: 400 })
      }
      const ast = parseFile(filePath, content)
      if (!ast) return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      const delta = await syncToGraph(ast, provenance, repo || 'local')
      return NextResponse.json({ delta })
    }

    if (action === 'analyze-diff') {
      const { repo, commitSha, files } = body
      if (!repo || !commitSha || !files) {
        return NextResponse.json({ error: 'Missing repo, commitSha, or files' }, { status: 400 })
      }
      const result = await analyzeGitDiff({ repo, commitSha, files, provenance })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
