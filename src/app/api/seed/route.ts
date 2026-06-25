/**
 * API: /api/seed
 * Inizializza il database con dati di esempio per tutte le 5 fasi.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordEpisode, upsertEntity, addLogicalRule } from '@/lib/kernel/ns-mem'
import { addLTLRule, DEFAULT_LTL_RULES } from '@/lib/kernel/ltl-monitor'
import { addAxiom, DEFAULT_AXIOMS } from '@/lib/kernel/normative'
import { reflectAndLearn } from '@/lib/kernel/erl'
import { BUILTIN_TEMPLATES } from '@/lib/kernel/compiled-ai'
import { STEERING_VOCABULARY } from '@/lib/kernel/acts'
import { requireAuth } from '@/lib/auth/require-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    // 1) Stato globale iniziale (PatchBoard) - bootstrap diretto
    // Il seed scrive direttamente nel DB per il setup iniziale,
    // perché le permission non permettono "add" sui prefissi di sistema.
    await db.globalState.upsert({
      where: { key: 'system' },
      create: { key: 'system', value: JSON.stringify({ status: 'running', version: '0.1.0' }) },
      update: { value: JSON.stringify({ status: 'running', version: '0.1.0' }) },
    })
    await db.globalState.upsert({
      where: { key: 'metrics' },
      create: { key: 'metrics', value: JSON.stringify({ cycles: 0, tokensUsed: 0 }) },
      update: { value: JSON.stringify({ cycles: 0, tokensUsed: 0 }) },
    })
    await db.globalState.upsert({
      where: { key: 'agents' },
      create: { key: 'agents', value: JSON.stringify([
        { id: 'orchestrator', role: 'coordination', status: 'idle' },
        { id: 'curator', role: 'sensorium', status: 'active' },
        { id: 'controller', role: 'steering', status: 'active' },
        { id: 'verifier', role: 'ltl_monitor', status: 'active' },
        { id: 'reflective', role: 'erl', status: 'idle' },
      ]) },
      update: { value: JSON.stringify([
        { id: 'orchestrator', role: 'coordination', status: 'idle' },
        { id: 'curator', role: 'sensorium', status: 'active' },
        { id: 'controller', role: 'steering', status: 'active' },
        { id: 'verifier', role: 'ltl_monitor', status: 'active' },
        { id: 'reflective', role: 'erl', status: 'idle' },
      ]) },
    })
    await db.globalState.upsert({
      where: { key: 'public' },
      create: { key: 'public', value: JSON.stringify({ note: 'hello' }) },
      update: { value: JSON.stringify({ note: 'hello' }) },
    })
    // Registra le transazioni iniziali come "bootstrap" per audit
    await db.patchTransaction.createMany({
      data: [
        { path: '/system', op: 'add', value: JSON.stringify({ status: 'running', version: '0.1.0' }), actor: 'kernel', authorized: true, status: 'accepted', reason: 'bootstrap' },
        { path: '/metrics', op: 'add', value: JSON.stringify({ cycles: 0, tokensUsed: 0 }), actor: 'curator', authorized: true, status: 'accepted', reason: 'bootstrap' },
        { path: '/agents', op: 'add', value: JSON.stringify([]), actor: 'orchestrator', authorized: true, status: 'accepted', reason: 'bootstrap' },
        { path: '/public', op: 'add', value: JSON.stringify({ note: 'hello' }), actor: 'kernel', authorized: true, status: 'accepted', reason: 'bootstrap' },
      ],
    })

    // 2) Memoria episodica di esempio
    await recordEpisode('Sistema avviato: kernel caricato, 5 agenti registrati', 'kernel', 'kernel', ['boot'])
    await recordEpisode('Curator ha compilato il primo Sensorium XML', 'curator', 'curator', ['sensorium'])
    await recordEpisode('Verificatore LTL inizializzato con 4 regole di default', 'verifier', 'verifier', ['ltl'])
    await recordEpisode('Pool di thread paralleli pronto (max 4)', 'orchestrator', 'orchestrator', ['scheduler'])

    // 3) Entità semantiche
    await upsertEntity('Sistema Operativo Agentico', 'system', 'OS distribuito per agenti LLM con memoria persistente')
    await upsertEntity('PatchBoard', 'module', 'Kernel transazionale per stato JSON condiviso')
    await upsertEntity('NS-Mem', 'module', 'Sistema memoria a 3 livelli: episodico, semantico, logico')
    await upsertEntity('Sensorium', 'module', 'Blocco XML con stato operativo per ogni ciclo cognitivo')
    await upsertEntity('DynAMO', 'module', 'Pianificatore vincolato da JSON-Schema con DAG topologico')
    await upsertEntity('CompiledAI', 'module', 'Pipeline di generazione e validazione codice 4-stadi')
    await upsertEntity('ACTS', 'module', 'Steering Controller per Chain-of-Thought guidato')
    await upsertEntity('AgentVerify', 'module', 'Monitor LTL/FSM per verifica formale runtime')
    await upsertEntity('TaintTracker', 'module', 'Tracciamento input tainted per prevenzione MitE')
    await upsertEntity('NormativeGate', 'module', 'Cancello di output basato su gerarchia assiomatica')
    await upsertEntity('ERL', 'module', 'Experiential Reflective Learning con estrazione euristiche')
    await upsertEntity('AutoSOTA', 'module', 'Supervisore Red Line per evoluzione controllata')

    // 4) Regole logiche (DAG)
    await addLogicalRule('R1', 'produce_sensorium()', [], 1)
    await addLogicalRule('R2', 'plan_task(goal)', [], 2)
    await addLogicalRule('R3', 'schedule_dag(plan)', ['R2'], 2)
    await addLogicalRule('R4', 'execute_task(t)', ['R3'], 3)
    await addLogicalRule('R5', 'verify_event(event)', ['R4'], 3)
    await addLogicalRule('R6', 'reflect(outcome)', ['R4', 'R5'], 4)

    // 5) Regole LTL
    for (const r of DEFAULT_LTL_RULES) {
      try { await addLTLRule(r) } catch {}
    }

    // 6) Assiomi normativi
    for (const a of DEFAULT_AXIOMS) {
      try { await addAxiom(a.axiom, a.priority) } catch {}
    }

    // 7) Template Compiled AI
    for (const t of BUILTIN_TEMPLATES) {
      await db.compiledTemplate.create({
        data: {
          templateId: t.templateId,
          name: t.name,
          description: t.description,
          skeleton: t.skeleton,
          schemaJson: JSON.stringify({ type: 'object' }),
        },
      })
    }

    // 8) Strategie steering
    for (const [name, info] of Object.entries(STEERING_VOCABULARY)) {
      await db.steeringStrategy.create({
        data: {
          name,
          triggerPhrase: info.phrase,
          description: info.description,
          budgetCost: info.budgetCost,
        },
      })
    }

    // 9) Euristica di esempio (via ERL)
    await reflectAndLearn({
      operationId: 'seed-001',
      goal: 'Inizializzare tutti i sottosistemi',
      outcome: 'success',
      steps: [
        { action: 'load_kernel', result: 'OK' },
        { action: 'init_memory', result: 'OK' },
        { action: 'init_verifier', result: 'OK' },
      ],
      context: 'bootstrap iniziale del sistema',
    })

    return NextResponse.json({ ok: true, message: 'Seed completato: stato, memoria, regole LTL, assiomi, template e euristiche inizializzati.' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
