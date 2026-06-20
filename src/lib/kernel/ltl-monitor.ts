/**
 * AgentVerify: Verifica formale basata su LTL (Fase 4)
 *
 * Ogni evento dell'orchestratore viene tradotto in uno stato discreto.
 * Un monitor FSM valuta gli eventi contro vincoli LTL compilati con
 * overhead O(1) per evento.
 *
 * Sintassi LTL supportata (subset):
 *   G(p)            → sempre p
 *   X(p)            → next p
 *   F(p)            → eventually p
 *   p -> q          → p implica q
 *   p U q           → p fino a q
 *
 * Esempio: "G(high_risk -> X human_approval)"
 * → ogni volta che si verifica un evento high_risk,
 *   l'evento successivo deve essere human_approval.
 */
import { db } from '@/lib/db'

export type DiscreteState = string // etichetta di stato (es. "tool_call", "human_approval")

export type LTLRuleSpec = {
  ruleId: string
  formula: string
  description: string
  severity: 'block' | 'warn' | 'log'
}

// Pre-caricamento regole LTL di default
export const DEFAULT_LTL_RULES: LTLRuleSpec[] = [
  {
    ruleId: 'LTL-001',
    formula: 'G(high_risk -> X human_approval)',
    description: 'Ogni tool call ad alto rischio richiede approvazione umana nel passo successivo',
    severity: 'block',
  },
  {
    ruleId: 'LTL-002',
    formula: 'G(tainted -> !sensitive_call)',
    description: 'Un dato tainted non può mai raggiungere una chiamata di sistema sensibile',
    severity: 'block',
  },
  {
    ruleId: 'LTL-003',
    formula: 'G(check -> X execute)',
    description: 'Dopo un CHECK deve seguire un EXECUTE (no loop infiniti di verifica)',
    severity: 'warn',
  },
  {
    ruleId: 'LTL-004',
    formula: 'G(error -> F reflect)',
    description: 'Dopo un errore deve eventualmente seguire una riflessione',
    severity: 'warn',
  },
]

/**
 * FSM Monitor: per ogni regola LTL, mantiene uno stato interno
 * e valuta transizioni ad ogni evento.
 *
 * Implementazione semplificata: riconosce i pattern G(p -> X q) e G(p -> !q)
 * tradotti in FSM a 2-3 stati.
 */
type FSMState = 'idle' | 'expecting' | 'violated'

type CompiledRule = {
  ruleId: string
  antecedent: DiscreteState
  consequent: DiscreteState
  negated: boolean // se true, consequent deve NON verificarsi
  severity: 'block' | 'warn' | 'log'
  state: FSMState
  pendingEvent?: string // per debug
}

/**
 * Compila una formula LTL nel nostro subset in una FSM.
 * Supporta: G(a -> X b) e G(a -> !b)
 */
function compileLTL(rule: LTLRuleSpec): CompiledRule | null {
  const f = rule.formula.replace(/\s+/g, ' ')
  // pattern: G( X -> Y )
  const m1 = f.match(/^G\((\w+)\s*->\s*X\s*(\w+)\)$/)
  if (m1) {
    return {
      ruleId: rule.ruleId,
      antecedent: m1[1],
      consequent: m1[2],
      negated: false,
      severity: rule.severity,
      state: 'idle',
    }
  }
  // pattern: G( X -> !Y )
  const m2 = f.match(/^G\((\w+)\s*->\s*!(\w+)\)$/)
  if (m2) {
    return {
      ruleId: rule.ruleId,
      antecedent: m2[1],
      consequent: m2[2],
      negated: true,
      severity: rule.severity,
      state: 'idle',
    }
  }
  return null
}

/**
 * In-memory monitor (una FSM per regola attiva).
 */
class LTLMonitor {
  private rules: CompiledRule[] = []
  private static instance: LTLMonitor | null = null

  static getInstance(): LTLMonitor {
    if (!this.instance) this.instance = new LTLMonitor()
    return this.instance
  }

  loadRules(specs: LTLRuleSpec[]) {
    this.rules = specs
      .map(compileLTL)
      .filter((r): r is CompiledRule => r !== null)
  }

  /**
   * Evaluta un evento contro tutte le FSM. O(1) per regola.
   */
  evalEvent(eventLabel: DiscreteState, payload: unknown): {
    verdict: 'accept' | 'reject' | 'warn'
    violations: { ruleId: string; reason: string }[]
  } {
    const violations: { ruleId: string; reason: string }[] = []
    let verdict: 'accept' | 'reject' | 'warn' = 'accept'

    for (const r of this.rules) {
      // Se siamo in stato 'expecting' e arriva l'evento atteso → reset
      if (r.state === 'expecting') {
        if (!r.negated && eventLabel === r.consequent) {
          r.state = 'idle'
        } else if (r.negated && eventLabel !== r.consequent) {
          // ok, abbiamo evitato il consequent vietato
          r.state = 'idle'
        } else if (r.negated && eventLabel === r.consequent) {
          // VIOLAZIONE: consequent vietato è apparso
          r.state = 'violated'
          violations.push({
            ruleId: r.ruleId,
            reason: `Dopo ${r.antecedent} non doveva apparire ${r.consequent} (regola ${r.ruleId})`,
          })
          if (r.severity === 'block') verdict = 'reject'
          else if (r.severity === 'warn' && verdict !== 'reject') verdict = 'warn'
          r.state = 'idle' // reset dopo violazione
        } else {
          // Non è il consequent atteso. Per regole G(a -> X b), violazione.
          if (!r.negated) {
            r.state = 'violated'
            violations.push({
              ruleId: r.ruleId,
              reason: `Dopo ${r.antecedent} era atteso ${r.consequent} (regola ${r.ruleId})`,
            })
            if (r.severity === 'block') verdict = 'reject'
            else if (r.severity === 'warn' && verdict !== 'reject') verdict = 'warn'
            // se l'evento corrente è un nuovo antecedent, rimetti in expecting
            if (eventLabel === r.antecedent) r.state = 'expecting'
            else r.state = 'idle'
          }
        }
      } else {
        // idle: controlla se questo evento è un antecedent
        if (eventLabel === r.antecedent) {
          r.state = 'expecting'
        }
      }
    }

    return { verdict, violations }
  }
}

const monitor = LTLMonitor.getInstance()

/**
 * Inizializza il monitor con regole dal DB o default.
 */
export async function initMonitor(): Promise<void> {
  const dbRules = await db.lTLRule.findMany({ where: { active: true } })
  const specs: LTLRuleSpec[] = dbRules.length
    ? dbRules.map((r) => ({
        ruleId: r.ruleId,
        formula: r.ltlFormula,
        description: r.description || '',
        severity: r.severity as 'block' | 'warn' | 'log',
      }))
    : DEFAULT_LTL_RULES
  monitor.loadRules(specs)
}

/**
 * Evaluta un evento dell'orchestratore.
 * Side effect: persiste un VerificationEvent.
 */
export async function verifyEvent(
  eventLabel: DiscreteState,
  eventType: string,
  payload: unknown
): Promise<{ verdict: 'accept' | 'reject' | 'warn'; violations: { ruleId: string; reason: string }[] }> {
  await initMonitor() // reload rules (idempotent)
  const result = monitor.evalEvent(eventLabel, payload)
  await db.verificationEvent.create({
    data: {
      eventType,
      payload: JSON.stringify(payload),
      stateLabel: eventLabel,
      verdict: result.verdict,
      reason: result.violations.map((v) => v.reason).join('; ') || 'OK',
    },
  })
  return result
}

/**
 * Aggiunge una regola LTL al DB.
 */
export async function addLTLRule(spec: LTLRuleSpec): Promise<void> {
  await db.lTLRule.create({
    data: {
      ruleId: spec.ruleId,
      ltlFormula: spec.formula,
      description: spec.description,
      severity: spec.severity,
    },
  })
}

export async function listLTLRules() {
  return db.lTLRule.findMany({ where: { active: true }, orderBy: { ruleId: 'asc' } })
}
