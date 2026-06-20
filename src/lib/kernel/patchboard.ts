/**
 * PatchBoard Kernel (Fase 1)
 * Stato globale = albero JSON. Tutte le mutazioni passano da JSON Patch
 * validati da un kernel deterministico con scoping dei permessi.
 *
 * RFC 6902 subset: add | remove | replace | move | copy | test
 */
import { db } from '@/lib/db'

// Schemi di autorizzazione per percorso
type Permission = {
  pathPrefix: string
  actors: string[] // agenti autorizzati
  ops: string[]    // operazioni permesse
}

const DEFAULT_PERMISSIONS: Permission[] = [
  { pathPrefix: '/system', actors: ['kernel', 'curator'], ops: ['replace', 'test'] },
  { pathPrefix: '/agents', actors: ['kernel', 'orchestrator'], ops: ['add', 'replace', 'remove'] },
  { pathPrefix: '/tasks', actors: ['orchestrator', 'scheduler'], ops: ['add', 'replace', 'remove'] },
  { pathPrefix: '/memory', actors: ['kernel', 'curator', 'reflective'], ops: ['add', 'replace'] },
  { pathPrefix: '/metrics', actors: ['curator'], ops: ['replace'] },
  { pathPrefix: '/public', actors: ['*'], ops: ['add', 'replace'] },
]

export type PatchOp = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

export type PatchResult = {
  accepted: boolean
  reason: string
  snapshot?: unknown
}

/**
 * Verifica che l'operazione sia autorizzata per l'attore.
 */
function authorize(op: PatchOp, actor: string): Permission | null {
  for (const p of DEFAULT_PERMISSIONS) {
    if (op.path.startsWith(p.pathPrefix)) {
      if (p.actors.includes('*') || p.actors.includes(actor)) {
        if (p.ops.includes(op.op)) return p
      }
    }
  }
  return null
}

/**
 * Risolve un path JSON Pointer all'interno dell'albero.
 */
function resolvePath(root: any, path: string): { parent: any; key: string | number; exists: boolean } {
  const parts = path.split('/').filter(Boolean)
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i].replace(/~1/g, '/').replace(/~0/g, '~')
    if (typeof cur !== 'object' || cur === null) return { parent: null, key: '', exists: false }
    cur = cur[k]
  }
  const last = parts[parts.length - 1]
  if (!last) return { parent: cur, key: '', exists: true }
  const key = last.replace(/~1/g, '/').replace(/~0/g, '~')
  const exists = typeof cur === 'object' && cur !== null && key in cur
  return { parent: cur, key, exists }
}

/**
 * Applica una singola operazione JSON Patch all'albero (mutazione in-place).
 * Lancia eccezione su operazione invalida.
 */
function applyOp(root: any, op: PatchOp): void {
  const { parent, key, exists } = resolvePath(root, op.path)
  if (op.op === 'add' || op.op === 'replace') {
    if (parent === null || parent === undefined) throw new Error(`Path invalido: ${op.path}`)
    if (Array.isArray(parent) && key === '') parent.push(op.value)
    else parent[key] = op.value
  } else if (op.op === 'remove') {
    if (!exists) throw new Error(`Path inesistente: ${op.path}`)
    if (Array.isArray(parent)) parent.splice(Number(key), 1)
    else delete parent[key]
  } else if (op.op === 'move') {
    if (!op.from) throw new Error('move richiede from')
    const src = resolvePath(root, op.from)
    if (!src.exists) throw new Error(`from inesistente: ${op.from}`)
    const val = src.parent[src.key]
    if (Array.isArray(src.parent)) src.parent.splice(Number(src.key), 1)
    else delete src.parent[src.key]
    applyOp(root, { op: 'add', path: op.path, value: val })
  } else if (op.op === 'copy') {
    if (!op.from) throw new Error('copy richiede from')
    const src = resolvePath(root, op.from)
    if (!src.exists) throw new Error(`from inesistente: ${op.from}`)
    applyOp(root, { op: 'add', path: op.path, value: src.parent[src.key] })
  } else if (op.op === 'test') {
    if (!exists) throw new Error(`test fallito: ${op.path} non esiste`)
    if (JSON.stringify(parent[key]) !== JSON.stringify(op.value)) {
      throw new Error(`test fallito: valore non corrisponde`)
    }
  }
}

/**
 * Carica lo stato globale corrente dal DB.
 */
export async function loadGlobalState(): Promise<Record<string, unknown>> {
  const rows = await db.globalState.findMany()
  const state: Record<string, unknown> = {}
  for (const r of rows) {
    try { state[r.key] = JSON.parse(r.value) } catch { state[r.key] = r.value }
  }
  return state
}

/**
 * Persiste lo stato globale (snapshot full-replace).
 */
async function persistGlobalState(state: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(state)) {
    const val = JSON.stringify(v)
    await db.globalState.upsert({
      where: { key: k },
      create: { key: k, value: val },
      update: { value: val },
    })
  }
}

/**
 * Applica una transazione PatchBoard: validate → apply → persist → log.
 * Transazionale: se una qualunque op fallisce, l'intera transazione è scartata.
 */
export async function applyTransaction(
  actor: string,
  ops: PatchOp[]
): Promise<PatchResult> {
  // 1) Autorizzazione
  for (const op of ops) {
    const perm = authorize(op, actor)
    if (!perm) {
      await db.patchTransaction.create({
        data: {
          path: op.path, op: op.op,
          value: op.value ? JSON.stringify(op.value) : null,
          actor, authorized: false,
          status: 'rejected',
          reason: `Permesso negato: ${actor} non può ${op.op} su ${op.path}`,
        },
      })
      return { accepted: false, reason: `Permesso negato: ${actor} non può ${op.op} su ${op.path}` }
    }
  }

  // 2) Snapshot per replay
  const state = await loadGlobalState()
  const snapshot = JSON.parse(JSON.stringify(state))

  // 3) Apply transazionale (clone -> prova -> commit)
  const work = JSON.parse(JSON.stringify(state))
  try {
    for (const op of ops) applyOp(work, op)
  } catch (e: any) {
    await db.patchTransaction.create({
      data: {
        path: ops[0]?.path || '/', op: ops[0]?.op || 'add',
        value: JSON.stringify(ops), actor, authorized: true,
        status: 'rejected',
        reason: `Apply fallito: ${e.message}`,
        snapshot: JSON.stringify(snapshot),
      },
    })
    return { accepted: false, reason: `Apply fallito: ${e.message}` }
  }

  // 4) Commit + persist
  await persistGlobalState(work)
  for (const op of ops) {
    await db.patchTransaction.create({
      data: {
        path: op.path, op: op.op,
        value: op.value !== undefined ? JSON.stringify(op.value) : null,
        actor, authorized: true,
        status: 'accepted',
        reason: 'OK',
        snapshot: JSON.stringify(snapshot),
      },
    })
  }

  return { accepted: true, reason: 'Transazione applicata', snapshot }
}

/**
 * Replay: riproduce una transazione storica per debugging.
 */
export async function replayTransaction(txId: string): Promise<PatchResult> {
  const tx = await db.patchTransaction.findUnique({ where: { id: txId } })
  if (!tx) return { accepted: false, reason: 'Transazione non trovata' }
  if (!tx.snapshot) return { accepted: false, reason: 'Snapshot mancante' }
  return { accepted: true, reason: 'Replay disponibile (snapshot caricato)', snapshot: JSON.parse(tx.snapshot) }
}
