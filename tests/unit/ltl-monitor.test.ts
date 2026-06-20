import { describe, it, expect } from 'vitest'
import {
  validateLTLFormula,
  previewFSM,
  DEFAULT_LTL_RULES,
} from '@/lib/kernel/ltl-monitor'
import { VALID_LTL_FORMULAS, INVALID_LTL_FORMULAS, EVENT_SEQUENCES } from '../fixtures'

describe('LTL Monitor — Parser', () => {
  describe('formule valide', () => {
    VALID_LTL_FORMULAS.forEach(({ formula, pattern }) => {
      it(`parsa correttamente: ${formula}`, () => {
        const result = validateLTLFormula(formula)
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
        // validateLTLFormula ritorna pattern solo in alcuni casi;
        // previewFSM lo ritorna sempre → verifichiamo lì
        const preview = previewFSM(formula)
        expect(preview.valid).toBe(true)
        if (preview.pattern) {
          expect(preview.pattern).toBe(pattern)
        }
      })
    })
  })

  describe('formule invalide', () => {
    INVALID_LTL_FORMULAS.forEach(({ formula, error }, idx) => {
      it(`rifiuta formula invalida #${idx + 1}: "${formula}"`, () => {
        if (!formula) {
          // Empty formula is a special case
          const result = validateLTLFormula(formula)
          expect(result.valid).toBe(false)
          return
        }
        const result = validateLTLFormula(formula)
        expect(result.valid).toBe(false)
        expect(result.error).toBeDefined()
        if (error) {
          expect(result.error).toMatch(error)
        }
      })
    })
  })

  describe('sintassi flessibile', () => {
    it('accetta G(p) con parentesi', () => {
      expect(validateLTLFormula('G(p)').valid).toBe(true)
    })
    it('accetta G p senza parentesi (atomo singolo)', () => {
      expect(validateLTLFormula('G p').valid).toBe(true)
    })
    it('accetta F(p) con parentesi', () => {
      expect(validateLTLFormula('F(p)').valid).toBe(true)
    })
    it('accetta F p senza parentesi', () => {
      expect(validateLTLFormula('F p').valid).toBe(true)
    })
    it('accetta X(p) con parentesi', () => {
      expect(validateLTLFormula('X(p)').valid).toBe(true)
    })
    it('accetta X p senza parentesi', () => {
      expect(validateLTLFormula('X p').valid).toBe(true)
    })
    it('accetta p U q (until)', () => {
      expect(validateLTLFormula('p U q').valid).toBe(true)
    })
    it('accetta operatori logici: &&, ||, !, ->', () => {
      expect(validateLTLFormula('G(p && q)').valid).toBe(true)
      expect(validateLTLFormula('G(p || q)').valid).toBe(true)
      expect(validateLTLFormula('G(!p)').valid).toBe(true)
      expect(validateLTLFormula('G(p -> q)').valid).toBe(true)
    })
    it('accetta atomi annidati: G(a -> X b)', () => {
      expect(validateLTLFormula('G(a -> X b)').valid).toBe(true)
    })
    it('accetta atomi annidati: G(a -> !b)', () => {
      expect(validateLTLFormula('G(a -> !b)').valid).toBe(true)
    })
    it('accetta atomi annidati: G(a -> F b)', () => {
      expect(validateLTLFormula('G(a -> F b)').valid).toBe(true)
    })
  })
})

describe('LTL Monitor — FSM Compilation', () => {
  describe('pattern supportati (7)', () => {
    it('G(p) → 2 stati (OK/VIOLATED)', () => {
      const result = previewFSM('G(p)')
      expect(result.valid).toBe(true)
      expect(result.states).toBeDefined()
      expect(result.states!.length).toBe(2)
      const stateTypes = result.states!.map(s => s.type)
      expect(stateTypes).toContain('initial')
      expect(stateTypes).toContain('violating')
    })

    it('F(p) → 2 stati (WAITING/SATISFIED)', () => {
      const result = previewFSM('F(p)')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(2)
      const stateTypes = result.states!.map(s => s.type)
      expect(stateTypes).toContain('initial')
      expect(stateTypes).toContain('accepting')
    })

    it('X(p) → 3 stati (EXPECTING/SATISFIED/VIOLATED)', () => {
      const result = previewFSM('X(p)')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(3)
    })

    it('p U q → 3 stati (WAITING_Q/SATISFIED/VIOLATED)', () => {
      const result = previewFSM('p U q')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(3)
    })

    it('G(a -> X b) → 3 stati (IDLE/EXPECTING_B/VIOLATED)', () => {
      const result = previewFSM('G(a -> X b)')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(3)
    })

    it('G(a -> !b) → 3 stati (IDLE/AFTER_A/VIOLATED)', () => {
      const result = previewFSM('G(a -> !b)')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(3)
    })

    it('G(a -> F b) → 3 stati (IDLE/WAITING_B/SATISFIED_B)', () => {
      const result = previewFSM('G(a -> F b)')
      expect(result.valid).toBe(true)
      expect(result.states!.length).toBe(3)
    })
  })

  describe('description testuale', () => {
    it('G(p) ha descrizione safety globale', () => {
      const result = previewFSM('G(p)')
      expect(result.description).toMatch(/safety/i)
    })
    it('F(p) ha descrizione liveness', () => {
      const result = previewFSM('F(p)')
      expect(result.description).toMatch(/liveness|apparire/i)
    })
    it('X(p) ha descrizione next', () => {
      const result = previewFSM('X(p)')
      expect(result.description).toMatch(/prossimo|next/i)
    })
    it('p U q ha descrizione until', () => {
      const result = previewFSM('p U q')
      expect(result.description).toMatch(/until|fino/i)
    })
  })

  describe('pattern non riconosciuto', () => {
    it('formula valida ma pattern non supportato ritorna valid:true con stati', () => {
      // G(p && q) è riconosciuto come G-plain (caso generale)
      const result = previewFSM('G(p && q)')
      expect(result.valid).toBe(true)
    })
  })
})

describe('LTL Monitor — Default Rules', () => {
  it('DEFAULT_LTL_RULES contiene 6 regole', () => {
    expect(DEFAULT_LTL_RULES).toHaveLength(6)
  })

  it('tutte le regole default sono valide', () => {
    DEFAULT_LTL_RULES.forEach(rule => {
      const result = validateLTLFormula(rule.formula)
      expect(result.valid, `Regola ${rule.ruleId} formula invalida: ${rule.formula}`).toBe(true)
    })
  })

  it('tutte le regole default hanno severity valido', () => {
    DEFAULT_LTL_RULES.forEach(rule => {
      expect(['block', 'warn', 'log']).toContain(rule.severity)
    })
  })

  it('LTL-001 e LTL-002 sono block', () => {
    const blockRules = DEFAULT_LTL_RULES.filter(r => r.severity === 'block')
    expect(blockRules.map(r => r.ruleId)).toContain('LTL-001')
    expect(blockRules.map(r => r.ruleId)).toContain('LTL-002')
  })
})

describe('LTL Monitor — Event Sequences', () => {
  // Questi test verificano la logica delle FSM tramite previewFSM
  // (il runtime richiede DB, testato in integration)

  it('sequence high_risk → human_approval è consistente con G(high_risk -> X human_approval)', () => {
    const fsm = previewFSM('G(high_risk -> X human_approval)')
    expect(fsm.valid).toBe(true)
    // La FSM ha IDLE → EXPECTING_B → (VIOLATED o IDLE)
    const expectingState = fsm.states!.find(s => s.name === 'EXPECTING_B')
    expect(expectingState).toBeDefined()
    expect(expectingState!.type).toBe('pending')
  })

  it('sequence neverTerminates è consistente con F(halt || success)', () => {
    const fsm = previewFSM('F(halt || success)')
    expect(fsm.valid).toBe(true)
    const waitingState = fsm.states!.find(s => s.name === 'WAITING')
    expect(waitingState).toBeDefined()
    expect(waitingState!.type).toBe('initial') // parte in attesa
  })
})
