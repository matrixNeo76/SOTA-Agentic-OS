/**
 * API: /api/conversation/branch
 *
 * POST - crea un nuovo branch forkando da un messaggio
 *   body: { action: 'create', messageId, messages, taskText, title? }
 *   returns: { ok, branchId }
 *
 * GET  - lista tutti i branch
 *   returns: { branches: [...] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'

export async function GET() {
  const branches = await db.conversationBranch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ branches })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const { messageId, messages, taskText, title, parentId } = body
    if (!messageId || !messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messageId e messages richiesti' }, { status: 400 })
    }

    const branchId = `branch_${Date.now()}_${randomBytes(4).toString('hex')}`
    const branch = await db.conversationBranch.create({
      data: {
        id: branchId,
        parentId: parentId || 'root',
        messageId,
        title: title || `Branch da ${messageId.slice(-8)}`,
        taskText: taskText || '',
        messagesJson: JSON.stringify(messages),
      },
    })

    return NextResponse.json({ ok: true, branchId: branch.id })
  }

  if (action === 'get') {
    const { branchId } = body
    const branch = await db.conversationBranch.findUnique({ where: { id: branchId } })
    if (!branch) return NextResponse.json({ error: 'Branch non trovato' }, { status: 404 })
    return NextResponse.json({ ok: true, branch: { ...branch, messages: JSON.parse(branch.messagesJson) } })
  }

  if (action === 'delete') {
    const { branchId } = body
    await db.conversationBranch.delete({ where: { id: branchId } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action non riconosciuta' }, { status: 400 })
}
