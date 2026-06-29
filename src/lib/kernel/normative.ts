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
    // C7 fix: blocca solo se la regola violata ha priorità STRETTAMENTE SUPERIORE
    // (valore numerico MINORE) dell'intenzione dichiarata.
    // Prima era `<=` che bloccava anche a parità di priorità, impedendo
    // qualsiasi operazione di efficienza (priority 3) che violasse un assioma
    // di priority 3 (es. "ottimizza token usage" vs "ottimizza token quando possibile").
    if (ax.priority < intent.claimedPriority) {
      // La regola violata ha priorità superiore all'intenzione → BLOCK
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
 * B10 fix: valida priorità (deve essere 1, 2 o 3) e controlla duplicati
 * (testo assioma già esistente).
 */
export async function addAxiom(axiom: string, priority: number): Promise<void> {
  if (!axiom || !axiom.trim()) {
    throw new Error('Axiom text is required')
  }
  if (![1, 2, 3].includes(priority)) {
    throw new Error(`Invalid priority ${priority}: must be 1 (legal), 2 (operational), or 3 (efficiency)`)
  }
  // Check duplicates (case-insensitive via toLowerCase — SQLite non supporta mode: insensitive)
  const axioms = await db.normativeRule.findMany({
    where: { axiom: { contains: axiom.trim() } },
    select: { axiom: true },
  })
  const exists = axioms.some((a) => a.axiom.toLowerCase() === axiom.trim().toLowerCase())
  if (exists) {
    throw new AxiomConflictError(axiom.trim())
  }
  await db.normativeRule.create({ data: { axiom: axiom.trim(), priority } })
}

export class AxiomConflictError extends Error {
  constructor(public axiom: string) {
    super(`Axiom already exists: "${axiom.slice(0, 50)}${axiom.length > 50 ? '...' : ''}"`)
    this.name = 'AxiomConflictError'
  }
}

/**
 * G2b: toggle active su un assioma (soft delete / restore).
 */
export async function toggleAxiom(id: string, active: boolean): Promise<void> {
  const existing = await db.normativeRule.findUnique({ where: { id } })
  if (!existing) {
    throw new AxiomNotFoundError(id)
  }
  await db.normativeRule.update({
    where: { id },
    data: { active },
  })
}

/**
 * G2b: aggiorna testo e/o priorità di un assioma.
 */
export async function updateAxiom(
  id: string,
  updates: { axiom?: string; priority?: number }
): Promise<void> {
  const existing = await db.normativeRule.findUnique({ where: { id } })
  if (!existing) {
    throw new AxiomNotFoundError(id)
  }

  const data: { axiom?: string; priority?: number } = {}
  if (updates.axiom !== undefined && updates.axiom !== existing.axiom) {
    const trimmed = updates.axiom.trim()
    if (!trimmed) {
      throw new Error('Axiom text cannot be empty')
    }
    // Check duplicates case-insensitive (excludes self)
    const candidates = await db.normativeRule.findMany({
      where: { axiom: { contains: trimmed }, id: { not: id } },
      select: { axiom: true },
    })
    const dup = candidates.some((c) => c.axiom.toLowerCase() === trimmed.toLowerCase())
    if (dup) {
      throw new AxiomConflictError(trimmed)
    }
    data.axiom = trimmed
  }
  if (updates.priority !== undefined && updates.priority !== existing.priority) {
    if (![1, 2, 3].includes(updates.priority)) {
      throw new Error(`Invalid priority ${updates.priority}: must be 1 (legal), 2 (operational), or 3 (efficiency)`)
    }
    data.priority = updates.priority
  }

  if (Object.keys(data).length === 0) {
    return // no-op
  }

  await db.normativeRule.update({ where: { id }, data })
}

/**
 * B5 fix: usa update (non updateMany) + lancia errore se non trovata.
 * Prima updateMany con where: { id } nascondeva il caso "id non esistente".
 */
export async function deleteAxiom(id: string): Promise<void> {
  const existing = await db.normativeRule.findUnique({ where: { id } })
  if (!existing) {
    throw new AxiomNotFoundError(id)
  }
  await db.normativeRule.update({
    where: { id },
    data: { active: false },
  })
}

export class AxiomNotFoundError extends Error {
  constructor(public id: string) {
    super(`Axiom with id "${id}" not found`)
    this.name = 'AxiomNotFoundError'
  }
}

export async function listAxioms() {
  const rows = await db.normativeRule.findMany({ where: { active: true }, orderBy: { priority: 'asc' } })
  return rows.length ? rows : DEFAULT_AXIOMS.map((a, i) => ({ id: `default-${i}`, axiom: a.axiom, priority: a.priority, active: true }))
}
