/**
 * Normative Computing (Stoic) (Fase 4)
 *
 * Cancello di Output deterministico basato su regole di priorità rigorose.
 * Ogni intenzione di agire viene valutata contro impegni assiomatici.
 *
 * Gerarchia:
 *   Priorità 1 (legal)      → obblighi legali, non negoziabili
 *   Priorità 2 (operational)→ obiettivi operativi
 *   Priorità 3 (efficiency) → ottimizzazioni
 *
 * Se c'è conflitto, vince la priorità più alta.
 */
import { db } from '@/lib/db'

export const DEFAULT_AXIOMS = [
  {
    axiom: 'Non divulgare mai dati personali senza consenso esplicito',
    priority: 1,
  },
  {
    axiom: 'Non eseguire tool ad alto rischio senza approvazione umana',
    priority: 1,
  },
  {
    axiom: 'Non bypassare i controlli di sicurezza per guadagno di efficienza',
    priority: 1,
  },
  {
    axiom: 'Rispetta i limiti di quota definiti per ogni agente',
    priority: 2,
  },
  {
    axiom: 'Mantieni l\'audit trail completo per ogni azione',
    priority: 2,
  },
  {
    axiom: 'Ottimizza l\'uso dei token quando possibile',
    priority: 3,
  },
]

export type Intent = {
  agentId: string
  action: string
  rationale: string
  affectedAxioms: { axiom: string; impact: 'comply' | 'violate' }[]
  claimedPriority: number
}

export type NormativeVerdict = {
  allowed: boolean
  blockingAxiom?: string
  blockingPriority?: number
  auditTrace: string
}

/**
 * Valuta un'intenzione contro la gerarchia assiomatica.
 * - Se l'intenzione viola un assioma di priorità 1 → BLOCK
 * - Se viola priorità 2 ma l'intenzione è priority 3 → BLOCK
 * - Altrimenti ALLOW
 */
export async function evaluateIntent(intent: Intent): Promise<NormativeVerdict> {
  // Carica gli assiomi attivi
  const dbAxioms = await db.normativeRule.findMany({ where: { active: true } })
  const axioms = dbAxioms.length
    ? dbAxioms.map((a) => ({ axiom: a.axiom, priority: a.priority }))
    : DEFAULT_AXIOMS

  const violated = intent.affectedAxioms.filter((a) => a.impact === 'violate')
  const auditLines: string[] = []
  auditLines.push(`Intent: ${intent.action} (claimed priority ${intent.claimedPriority})`)

  for (const v of violated) {
    const ax = axioms.find((a) => a.axiom === v.axiom)
    if (!ax) continue
    auditLines.push(`Violazione rilevata: "${ax.axiom}" (priorità ${ax.priority})`)
    if (ax.priority <= intent.claimedPriority) {
      // La regola violata ha priorità >= dell'intenzione → BLOCK
      return {
        allowed: false,
        blockingAxiom: ax.axiom,
        blockingPriority: ax.priority,
        auditTrace: auditLines.join('\n'),
      }
    }
  }

  auditLines.push('Nessuna violazione bloccante.')
  return {
    allowed: true,
    auditTrace: auditLines.join('\n'),
  }
}

/**
 * Aggiunge un nuovo assioma normativo.
 */
export async function addAxiom(axiom: string, priority: number): Promise<void> {
  await db.normativeRule.create({ data: { axiom, priority } })
}

export async function deleteAxiom(id: string): Promise<void> {
  await db.normativeRule.updateMany({
    where: { id },
    data: { active: false },
  })
}

export async function listAxioms() {
  const rows = await db.normativeRule.findMany({ where: { active: true }, orderBy: { priority: 'asc' } })
  return rows.length ? rows : DEFAULT_AXIOMS.map((a, i) => ({ id: `default-${i}`, axiom: a.axiom, priority: a.priority, active: true }))
}
