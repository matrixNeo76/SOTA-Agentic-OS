/**
 * API: /api/compiled
 * Pipeline Compiled AI: genera codice via LLM dentro template, valida 4-stadi.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runPipeline, BUILTIN_TEMPLATES } from '@/lib/kernel/compiled-ai'
import { db } from '@/lib/db'
import ZAI from 'z-ai-web-dev-sdk'

export async function GET() {
  const [artifacts, templates] = await Promise.all([
    db.compiledArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    db.compiledTemplate.findMany(),
  ])
  return NextResponse.json({
    artifacts,
    templates: templates.length ? templates : BUILTIN_TEMPLATES,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { mode } = body

  if (mode === 'generate') {
    const { templateId, requirement } = body
    const template = await db.compiledTemplate.findUnique({ where: { templateId } })
      || BUILTIN_TEMPLATES.find((t) => t.templateId === templateId)
    if (!template) return NextResponse.json({ ok: false, error: 'Template non trovato' }, { status: 400 })

    try {
      const zai = await ZAI.create()
      const sysPrompt = `Sei un code generator in un pipeline Compiled AI.
Genera una funzione JavaScript che soddisfi il requisito. Regole OBBLIGATORIE:
- La funzione riceve un parametro 'input' e DEVE terminare con 'return ...'
- NO eval, NO require, NO fetch, NO process.exit, NO template literals (backtick)
- NO accessi a file system, network, o globals pericolose
- Massimo 5 righe di codice nel corpo
- Rispondi con SOLO il corpo della funzione (senza 'function' wrapper), nessuna spiegazione`

      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Template: ${templateId}\nSkeleton originale: ${'skeleton' in template ? template.skeleton : ''}\nRequisito: ${requirement}` },
        ],
      })
      let code = (completion.choices[0].message.content || '').trim()
      // Pulizia: rimuovi wrapper function se presente
      code = code.replace(/^function\s*\w*\s*\([^)]*\)\s*\{?/, '').replace(/\}$/, '').trim()
      // Validazione 4-stadi con fixture di test
      const fixture = { status: 'approved', signature: 'sig123', role: 'admin', scopes: ['write'], attempts: 1, geo: 'IT' }
      const expected = templateId === 'compliance_check' ? true
        : templateId === 'authz_decision' ? true
        : 10
      const result = await runPipeline(`LLM-${templateId}-${Date.now()}`, templateId, code, fixture, expected)
      return NextResponse.json({ ok: true, code, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
  }

  // mode 'validate' manuale
  const { name, templateId, code, fixture, expected } = body
  const result = await runPipeline(name, templateId, code, fixture, expected)
  return NextResponse.json({ ok: true, ...result })
}
