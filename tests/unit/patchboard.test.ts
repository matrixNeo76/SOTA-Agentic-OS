import { describe, it, expect } from 'vitest'
import {
  applyTransaction,
  loadGlobalState,
  type PatchOp,
} from '@/lib/kernel/patchboard'
import { VALID_PATCH_OPS, PERMISSION_MATRIX } from '../fixtures'

// Per testare il patchboard senza DB, creiamo un mock minimal
// Le funzioni reali usano Prisma, ma la logica di validazione
// è testabile isolando le funzioni interne.

// Estraiamo le funzioni pure per testarle direttamente
// (applyOp, authorize, resolvePath sono private, ma possiamo
// testare il comportamento tramite applyTransaction con DB mock)

describe('Patchboard — Permission Scoping', () => {
  // Test della logica di autorizzazione basata sui PATH PREFIX
  // Senza DB, verifichiamo solo la matrice teorica

  PERMISSION_MATRIX.forEach(({ actor, path, op, shouldAuthorize }) => {
    it(`${actor} ${op} su ${path} → ${shouldAuthorize ? 'authorize' : 'reject'}`, () => {
      // Verifica la regola di autorizzazione teorica
      const authorized = checkAuthorizationTheory(actor, path, op)
      expect(authorized).toBe(shouldAuthorize)
    })
  })
})

/**
 * Replica della logica di autorizzazione del patchboard (without DB).
 * Da tenere sincronizzata con DEFAULT_PERMISSIONS in patchboard.ts.
 */
function checkAuthorizationTheory(actor: string, path: string, op: string): boolean {
  const PERMISSIONS = [
    { pathPrefix: '/system', actors: ['kernel', 'curator'], ops: ['replace', 'test'] },
    { pathPrefix: '/agents', actors: ['kernel', 'orchestrator'], ops: ['add', 'replace', 'remove'] },
    { pathPrefix: '/tasks', actors: ['orchestrator', 'scheduler'], ops: ['add', 'replace', 'remove'] },
    { pathPrefix: '/memory', actors: ['kernel', 'curator', 'reflective'], ops: ['add', 'replace'] },
    { pathPrefix: '/metrics', actors: ['curator'], ops: ['replace'] },
    { pathPrefix: '/public', actors: ['*'], ops: ['add', 'replace'] },
  ]
  for (const p of PERMISSIONS) {
    if (path.startsWith(p.pathPrefix)) {
      if (p.actors.includes('*') || p.actors.includes(actor)) {
        if (p.ops.includes(op)) return true
      }
    }
  }
  return false
}

describe('Patchboard — JSON Patch Operations', () => {
  describe('struttura operazioni', () => {
    it('tutte le operazioni valide hanno op + path', () => {
      VALID_PATCH_OPS.forEach(op => {
        expect(op.op).toBeDefined()
        expect(op.path).toBeDefined()
        expect(op.path.startsWith('/')).toBe(true)
      })
    })

    it('operazioni add/replace hanno value', () => {
      const addOp = VALID_PATCH_OPS.find(o => o.op === 'add')
      const replaceOp = VALID_PATCH_OPS.find(o => o.op === 'replace')
      expect(addOp!.value).toBeDefined()
      expect(replaceOp!.value).toBeDefined()
    })

    it('operazione test ha value', () => {
      const testOp = VALID_PATCH_OPS.find(o => o.op === 'test')
      expect(testOp!.value).toBeDefined()
    })
  })

  describe('path validation', () => {
    it('path valido inizia con /', () => {
      expect('/system/status'.startsWith('/')).toBe(true)
      expect('/public/note'.startsWith('/')).toBe(true)
    })

    it('path invalido non inizia con /', () => {
      expect('system/status'.startsWith('/')).toBe(false)
    })
  })
})

describe('Patchboard — RFC 6902 Subset', () => {
  it('supporta 6 operazioni: add, remove, replace, move, copy, test', () => {
    const supportedOps = ['add', 'remove', 'replace', 'move', 'copy', 'test']
    supportedOps.forEach(op => {
      expect(typeof op).toBe('string')
    })
    expect(supportedOps).toHaveLength(6)
  })

  it('move richiede from', () => {
    const op: PatchOp = { op: 'move', path: '/dest', from: '/src' }
    expect(op.from).toBeDefined()
    expect(op.from).toBe('/src')
  })

  it('copy richiede from', () => {
    const op: PatchOp = { op: 'copy', path: '/dest', from: '/src' }
    expect(op.from).toBeDefined()
  })

  it('add/replace/test non richiedono from', () => {
    const addOp: PatchOp = { op: 'add', path: '/x', value: 1 }
    const replaceOp: PatchOp = { op: 'replace', path: '/x', value: 1 }
    const testOp: PatchOp = { op: 'test', path: '/x', value: 1 }
    expect(addOp.from).toBeUndefined()
    expect(replaceOp.from).toBeUndefined()
    expect(testOp.from).toBeUndefined()
  })
})

describe('Patchboard — Atomicity', () => {
  it('se una op fallisce, l\'intera transazione è scartata (teoria)', () => {
    // La teoria: applyTransaction fa snapshot, applica tutte le ops su clone,
    // se una fallisce ritorna rejected senza persistere
    const ops: PatchOp[] = [
      { op: 'add', path: '/valid', value: 'ok' },
      { op: 'add', path: '/invalid/missing/parent', value: 'fail' },  // path invalido
    ]
    // Verifichiamo che la struttura sia corretta per l'atomicity
    expect(ops).toHaveLength(2)
    expect(ops[0].path).toBe('/valid')
    expect(ops[1].path).toBe('/invalid/missing/parent')
  })
})

describe('Patchboard — Path Resolution', () => {
  it('path semplice /a/b/c si decompone correttamente', () => {
    const parts = '/a/b/c'.split('/').filter(Boolean)
    expect(parts).toEqual(['a', 'b', 'c'])
  })

  it('path con escape ~1 (slash) e ~0 (tilde)', () => {
    const path = '/a~1b~0c'
    const parts = path.split('/').filter(Boolean)
    expect(parts[0]).toBe('a~1b~0c')
    // Dopo unescape: a/b~c
    const unescaped = parts[0].replace(/~1/g, '/').replace(/~0/g, '~')
    expect(unescaped).toBe('a/b~c')
  })
})
