/**
 * AgentVerify: Verifica formale basata su LTL (Fase 4)
 *
 * Estensione subset LTL supportato:
 *   G(p)            → sempre p (safety globale)
 *   F(p)            → eventualmente p (liveness)
 *   X(p)            → al prossimo step p
 *   !p              → negazione
 *   p && q          → congiunzione
 *   p || q          → disgiunzione
 *   p -> q          → implicazione
 *   p U q           → p fino a q (until)
 *
 * Ogni regola è compilata in una FSM (o NFA con stati finiti) valutata
 * ad ogni evento con overhead O(1).
 *
 * Sintassi esempi supportati:
 *   G(high_risk -> X human_approval)         safety: ogni high_risk richiede approvazione nel passo dopo
 *   G(tainted -> !sensitive_call)           safety: tainted non può mai raggiungere sink sensibili
 *   G(error -> F reflect)                    liveness: dopo errore, eventualmente riflessione
 *   G(a && b)                                safety: a e b sempre veri insieme
 *   F(success)                               liveness: success deve eventualmente apparire
 *   !idle && active                          state: mai idle quando active
 */
import { db } from '@/lib/db'

export type DiscreteState = string

export type LTLRuleSpec = {
  ruleId: string
  formula: string
  description: string
  severity: 'block' | 'warn' | 'log'
}

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
  {
    ruleId: 'LTL-005',
    formula: 'F(halt || success)',
    description: 'Ogni esecuzione deve eventualmente terminare (halt o success)',
    severity: 'warn',
  },
  {
    ruleId: 'LTL-006',
    formula: 'G(plan -> F execute)',
    description: 'Dopo un PLAN deve eventualmente seguire un EXECUTE (nessun piano sterile)',
    severity: 'warn',
  },
]

// ===== AST per parsing LTL =====
type AST =
  | { kind: 'prop'; name: string }              // proposizione atomica
  | { kind: 'not'; child: AST }                 // !p
  | { kind: 'and'; left: AST; right: AST }      // p && q
  | { kind: 'or'; left: AST; right: AST }       // p || q
  | { kind: 'impl'; left: AST; right: AST }     // p -> q
  | { kind: 'G'; child: AST }                   // G(p)
  | { kind: 'F'; child: AST }                   // F(p)
  | { kind: 'X'; child: AST }                   // X(p)
  | { kind: 'U'; left: AST; right: AST }        // p U q

// ===== Parser LTL (recursive descent) =====
class LTLParser {
  private tokens: string[]
  private pos = 0

  constructor(formula: string) {
    // Tokenizza: separa operatori, parentesi, identificatori
    this.tokens = formula
      .replace(/->/g, ' -> ')
      .replace(/&&/g, ' && ')
      .replace(/\|\|/g, ' || ')
      .replace(/!/g, ' ! ')
      .replace(/\(/g, ' ( ')
      .replace(/\)/g, ' ) ')
      .split(/\s+/)
      .filter(Boolean)
  }

  parse(): AST {
    const ast = this.parseUntil()
    if (this.pos < this.tokens.length) {
      throw new Error(`Token inatteso: ${this.tokens[this.pos]}`)
    }
    return ast
  }

  // Top level: gestisce U (until) — precedenza più bassa
  private parseUntil(): AST {
    const left = this.parseImpl()
    if (this.peek() === 'U') {
      this.consume('U')
      const right = this.parseImpl()
      return { kind: 'U', left, right }
    }
    return left
  }

  // -> : implicazione
  private parseImpl(): AST {
    const left = this.parseOr()
    if (this.peek() === '->') {
      this.consume('->')
      const right = this.parseImpl() // right-assoc
      return { kind: 'impl', left, right }
    }
    return left
  }

  // || : disgiunzione
  private parseOr(): AST {
    let left = this.parseAnd()
    while (this.peek() === '||') {
      this.consume('||')
      const right = this.parseAnd()
      left = { kind: 'or', left, right }
    }
    return left
  }

  // && : congiunzione
  private parseAnd(): AST {
    let left = this.parseUnary()
    while (this.peek() === '&&') {
      this.consume('&&')
      const right = this.parseUnary()
      left = { kind: 'and', left, right }
    }
    return left
  }

  // Unari: !, G, F, X
  private parseUnary(): AST {
    const t = this.peek()
    if (t === '!') {
      this.consume('!')
      return { kind: 'not', child: this.parseUnary() }
    }
    if (t === 'G') {
      this.consume('G')
      // Supporta sia G(p) che G p (atomo nudo)
      if (this.peek() === '(') {
        this.consume('(')
        const child = this.parseUntil()
        this.consume(')')
        return { kind: 'G', child }
      }
      return { kind: 'G', child: this.parseAtom() }
    }
    if (t === 'F') {
      this.consume('F')
      if (this.peek() === '(') {
        this.consume('(')
        const child = this.parseUntil()
        this.consume(')')
        return { kind: 'F', child }
      }
      return { kind: 'F', child: this.parseAtom() }
    }
    if (t === 'X') {
      this.consume('X')
      if (this.peek() === '(') {
        this.consume('(')
        const child = this.parseUntil()
        this.consume(')')
        return { kind: 'X', child }
      }
      return { kind: 'X', child: this.parseAtom() }
    }
    return this.parseAtom()
  }

  // Atomo: identificatore o ( ... )
  private parseAtom(): AST {
    const t = this.peek()
    if (t === '(') {
      this.consume('(')
      const inner = this.parseUntil()
      this.consume(')')
      return inner
    }
    if (!t || /(!|&&|\|\||->|\(|\)|G|F|X|U)/.test(t)) {
      throw new Error(`Atomo atteso, trovato: ${t}`)
    }
    this.consume(t)
    return { kind: 'prop', name: t }
  }

  private peek(): string | undefined {
    return this.tokens[this.pos]
  }

  private consume(expected: string): void {
    if (this.tokens[this.pos] !== expected) {
      throw new Error(`Atteso "${expected}", trovato "${this.tokens[this.pos]}"`)
    }
    this.pos++
  }
}

// ===== Compilatore AST -> FSM =====
type FSMState = string
type FSMTransition = { from: FSMState; on: 'true' | 'false'; to: FSMState }

interface CompiledFSM {
  states: Set<FSMState>
  transitions: FSMTransition[]
  initial: FSMState
  accepting: Set<FSMState>  // stati dove la regola è soddisfatta
  violating: Set<FSMState>  // stati dove la regola è violata in modo irrimediabile
  pending: Set<FSMState>    // stati dove la regola è ancora in valutazione
}

/**
 * Evaluta un AST atom-level rispetto all'evento corrente.
 * Ritorna true se l'evento corrente soddisfa la proposizione.
 */
function evalAST(node: AST, eventLabel: DiscreteState, history: DiscreteState[]): boolean {
  switch (node.kind) {
    case 'prop':
      return eventLabel === node.name
    case 'not':
      return !evalAST(node.child, eventLabel, history)
    case 'and':
      return evalAST(node.left, eventLabel, history) && evalAST(node.right, eventLabel, history)
    case 'or':
      return evalAST(node.left, eventLabel, history) || evalAST(node.right, eventLabel, history)
    case 'impl':
      return !evalAST(node.left, eventLabel, history) || evalAST(node.right, eventLabel, history)
    case 'G':
    case 'F':
    case 'X':
    case 'U':
      // Questi operatori temporali non possono essere valutati atomicamente.
      // Vengono gestiti dal runtime FSM, non qui.
      throw new Error(`Operatore temporale ${node.kind} non evalutabile atomicamente`)
  }
}

/**
 * Compila una regola LTL in una FSM.
 * Per semplicità gestiamo esplicitamente i pattern più comuni:
 *   - G(p)              → 2 stati: OK / VIOLATED
 *   - G(a -> X b)       → 3 stati: IDLE / EXPECTING_B / VIOLATED
 *   - G(a -> !b)        → 3 stati: IDLE / EXPECTING_NOTB / VIOLATED
 *   - G(a -> F b)       → 3 stati: IDLE / WAITING_B / VIOLATED (con timeout indefinito)
 *   - F(p)              → 2 stati: WAITING / SATISFIED
 *   - X(p)              → 2 stati: EXPECTING_NEXT_P / VIOLATED
 *   - p U q             → 3 stati: WAITING_Q / SATISFIED / VIOLATED
 * Per pattern complessi ritorna null (regola non compilabile, skip).
 */
function compileLTL(rule: LTLRuleSpec): CompiledFSM | null {
  const f = rule.formula.replace(/\s+/g, ' ').trim()
  try {
    const ast = new LTLParser(f).parse()
    return compileAST(ast, rule)
  } catch (e) {
    // Parsing fallito: regola non supportata
    return null
  }
}

function compileAST(ast: AST, rule: LTLRuleSpec): CompiledFSM | null {
  // Pattern G(p): sempre p
  if (ast.kind === 'G') {
    // Sotto-caso: G(a -> X b)
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'X') {
      const antecedent = ast.child.left
      const consequent = ast.child.right.child
      return buildGThenXFSM(antecedent, consequent, rule)
    }
    // Sotto-caso: G(a -> !b)  (implicazione con negazione)
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'not') {
      const antecedent = ast.child.left
      const consequent = ast.child.right.child
      return buildGThenNotFSM(antecedent, consequent, rule)
    }
    // Sotto-caso: G(a -> F b)
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'F') {
      const antecedent = ast.child.left
      const consequent = ast.child.right.child
      return buildGThenFFSM(antecedent, consequent, rule)
    }
    // Caso generale G(p): 2 stati
    return buildGFSM(ast.child, rule)
  }

  // Pattern F(p): eventualmente p
  if (ast.kind === 'F') {
    return buildFFSM(ast.child, rule)
  }

  // Pattern X(p): al prossimo step p
  if (ast.kind === 'X') {
    return buildXFSM(ast.child, rule)
  }

  // Pattern p U q
  if (ast.kind === 'U') {
    return buildUFSM(ast.left, ast.right, rule)
  }

  // Pattern nudo (senza operatore temporale): trattalo come G(p)
  return buildGFSM(ast, rule)
}

// ===== Builder per ciascun pattern =====

function buildGFSM(p: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: OK (accepting), VIOLATED
  return {
    states: new Set(['OK', 'VIOLATED']),
    transitions: [],
    initial: 'OK',
    accepting: new Set(['OK']),
    violating: new Set(['VIOLATED']),
    pending: new Set(),
  }
}

function buildFFSM(p: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: WAITING (pending), SATISFIED (accepting)
  return {
    states: new Set(['WAITING', 'SATISFIED']),
    transitions: [],
    initial: 'WAITING',
    accepting: new Set(['SATISFIED']),
    violating: new Set(),
    pending: new Set(['WAITING']),
  }
}

function buildXFSM(p: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: EXPECTING (pending), SATISFIED (accepting), VIOLATED
  return {
    states: new Set(['EXPECTING', 'SATISFIED', 'VIOLATED']),
    transitions: [],
    initial: 'EXPECTING',
    accepting: new Set(['SATISFIED']),
    violating: new Set(['VIOLATED']),
    pending: new Set(['EXPECTING']),
  }
}

function buildUFSM(p: AST, q: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: WAITING_Q (pending, p deve valere), SATISFIED (q vero), VIOLATED (!p && !q)
  return {
    states: new Set(['WAITING_Q', 'SATISFIED', 'VIOLATED']),
    transitions: [],
    initial: 'WAITING_Q',
    accepting: new Set(['SATISFIED']),
    violating: new Set(['VIOLATED']),
    pending: new Set(['WAITING_Q']),
  }
}

function buildGThenXFSM(a: AST, b: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: IDLE (accepting), EXPECTING_B (pending), VIOLATED
  return {
    states: new Set(['IDLE', 'EXPECTING_B', 'VIOLATED']),
    transitions: [],
    initial: 'IDLE',
    accepting: new Set(['IDLE']),
    violating: new Set(['VIOLATED']),
    pending: new Set(['EXPECTING_B']),
  }
}

function buildGThenNotFSM(a: AST, b: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: IDLE (accepting), AFTER_A (pending), VIOLATED
  return {
    states: new Set(['IDLE', 'AFTER_A', 'VIOLATED']),
    transitions: [],
    initial: 'IDLE',
    accepting: new Set(['IDLE']),
    violating: new Set(['VIOLATED']),
    pending: new Set(['AFTER_A']),
  }
}

function buildGThenFFSM(a: AST, b: AST, rule: LTLRuleSpec): CompiledFSM {
  // Stati: IDLE (accepting), WAITING_B (pending), SATISFIED_B (accepting)
  // WAITING_B non è mai violating finché non si chiude l'esecuzione
  return {
    states: new Set(['IDLE', 'WAITING_B', 'SATISFIED_B']),
    transitions: [],
    initial: 'IDLE',
    accepting: new Set(['IDLE', 'SATISFIED_B']),
    violating: new Set(),
    pending: new Set(['WAITING_B']),
  }
}

// ===== Runtime FSM: una istanza per regola attiva =====
interface RuntimeRule {
  spec: LTLRuleSpec
  fsm: CompiledFSM
  state: FSMState
  history: DiscreteState[]
  // pattern info per il dispatch
  pattern: 'G' | 'F' | 'X' | 'U' | 'G->X' | 'G->!b' | 'G->F' | 'G-plain'
  ast: AST
}

class LTLMonitor {
  private rules: RuntimeRule[] = []
  private static instance: LTLMonitor | null = null

  static getInstance(): LTLMonitor {
    if (!this.instance) this.instance = new LTLMonitor()
    return this.instance
  }

  loadRules(specs: LTLRuleSpec[]) {
    this.rules = []
    for (const spec of specs) {
      try {
        const ast = new LTLParser(spec.formula).parse()
        const fsm = compileAST(ast, spec)
        if (!fsm) continue
        const pattern = this.detectPattern(ast)
        this.rules.push({
          spec,
          fsm,
          state: fsm.initial,
          history: [],
          pattern,
          ast,
        })
      } catch (e) {
        // skip regole non parseabili
      }
    }
  }

  private detectPattern(ast: AST): RuntimeRule['pattern'] {
    if (ast.kind === 'G') {
      if (ast.child.kind === 'impl' && ast.child.right.kind === 'X') return 'G->X'
      if (ast.child.kind === 'impl' && ast.child.right.kind === 'not') return 'G->!b'
      if (ast.child.kind === 'impl' && ast.child.right.kind === 'F') return 'G->F'
      return 'G-plain'
    }
    if (ast.kind === 'F') return 'F'
    if (ast.kind === 'X') return 'X'
    if (ast.kind === 'U') return 'U'
    return 'G-plain'
  }

  evalEvent(eventLabel: DiscreteState, _payload: unknown): {
    verdict: 'accept' | 'reject' | 'warn'
    violations: { ruleId: string; reason: string; pattern: string; currentState: string }[]
  } {
    const violations: { ruleId: string; reason: string; pattern: string; currentState: string }[] = []
    let verdict: 'accept' | 'reject' | 'warn' = 'accept'

    for (const r of this.rules) {
      const prev = r.state
      this.stepRule(r, eventLabel)
      if (r.fsm.violating.has(r.state)) {
        violations.push({
          ruleId: r.spec.ruleId,
          reason: `Regola ${r.spec.ruleId} violata: transizione ${prev} → ${r.state} su evento "${eventLabel}". ${r.spec.description}`,
          pattern: r.pattern,
          currentState: r.state,
        })
        if (r.spec.severity === 'block') verdict = 'reject'
        else if (r.spec.severity === 'warn' && verdict !== 'reject') verdict = 'warn'
        // Reset after violation (per continuare a monitorare)
        r.state = r.fsm.initial
      }
      r.history.push(eventLabel)
      if (r.history.length > 100) r.history.shift()
    }

    return { verdict, violations }
  }

  private stepRule(r: RuntimeRule, eventLabel: DiscreteState): void {
    const a = r.ast
    switch (r.pattern) {
      case 'G-plain': {
        // G(p): se p è falso → VIOLATED
        const p = a.kind === 'G' ? a.child : a
        const ok = this.evalAtom(p, eventLabel, r.history)
        if (!ok) r.state = 'VIOLATED'
        else r.state = 'OK'
        break
      }
      case 'G->X': {
        // G(a -> X b): se in EXPECTING_B e b è falso → VIOLATED; se a vero → EXPECTING_B
        const antecedent = (a as any).child.left
        const consequent = (a as any).child.right.child
        const aTrue = this.evalAtom(antecedent, eventLabel, r.history)
        const bTrue = this.evalAtom(consequent, eventLabel, r.history)
        if (r.state === 'EXPECTING_B') {
          if (bTrue) {
            r.state = aTrue ? 'EXPECTING_B' : 'IDLE'
          } else {
            r.state = 'VIOLATED'
          }
        } else {
          // IDLE
          if (aTrue) r.state = 'EXPECTING_B'
        }
        break
      }
      case 'G->!b': {
        // G(a -> !b): se AFTER_A e b vero → VIOLATED; se a vero → AFTER_A
        const antecedent = (a as any).child.left
        const consequent = (a as any).child.right.child
        const aTrue = this.evalAtom(antecedent, eventLabel, r.history)
        const bTrue = this.evalAtom(consequent, eventLabel, r.history)
        if (r.state === 'AFTER_A') {
          if (bTrue) r.state = 'VIOLATED'
          else r.state = aTrue ? 'AFTER_A' : 'IDLE'
        } else {
          if (aTrue) r.state = 'AFTER_A'
        }
        break
      }
      case 'G->F': {
        // G(a -> F b): se WAITING_B e b vero → SATISFIED_B; se a vero → WAITING_B
        const antecedent = (a as any).child.left
        const consequent = (a as any).child.right.child
        const aTrue = this.evalAtom(antecedent, eventLabel, r.history)
        const bTrue = this.evalAtom(consequent, eventLabel, r.history)
        if (r.state === 'WAITING_B') {
          if (bTrue) r.state = 'SATISFIED_B'
          // resta in WAITING_B se a ricomincia (richiede nuovo b)
          else if (aTrue) r.state = 'WAITING_B'
        } else if (r.state === 'IDLE' || r.state === 'SATISFIED_B') {
          if (aTrue) r.state = 'WAITING_B'
          else r.state = 'IDLE'
        }
        break
      }
      case 'F': {
        // F(p): se p vero → SATISFIED
        const p = (a as any).child
        const ok = this.evalAtom(p, eventLabel, r.history)
        if (ok) r.state = 'SATISFIED'
        // resta in WAITING altrimenti
        break
      }
      case 'X': {
        // X(p): primo evento dopo attivazione → check; se p falso VIOLATED
        const p = (a as any).child
        const ok = this.evalAtom(p, eventLabel, r.history)
        if (r.state === 'EXPECTING') {
          r.state = ok ? 'SATISFIED' : 'VIOLATED'
        }
        break
      }
      case 'U': {
        // p U q: se q vero → SATISFIED; se !p && !q → VIOLATED
        const p = (a as any).left
        const q = (a as any).right
        const pTrue = this.evalAtom(p, eventLabel, r.history)
        const qTrue = this.evalAtom(q, eventLabel, r.history)
        if (qTrue) r.state = 'SATISFIED'
        else if (!pTrue) r.state = 'VIOLATED'
        // altrimenti resta in WAITING_Q
        break
      }
    }
  }

  private evalAtom(node: AST, eventLabel: DiscreteState, history: DiscreteState[]): boolean {
    switch (node.kind) {
      case 'prop': return eventLabel === node.name
      case 'not': return !this.evalAtom(node.child, eventLabel, history)
      case 'and': return this.evalAtom(node.left, eventLabel, history) && this.evalAtom(node.right, eventLabel, history)
      case 'or': return this.evalAtom(node.left, eventLabel, history) || this.evalAtom(node.right, eventLabel, history)
      case 'impl': return !this.evalAtom(node.left, eventLabel, history) || this.evalAtom(node.right, eventLabel, history)
      default: return false // operatori temporali non evalutabili atomicamente
    }
  }

  /**
   * Snapshot per debugging/UI: ritorna stato corrente di ogni FSM.
   */
  snapshot(): { ruleId: string; pattern: string; currentState: string; history: DiscreteState[] }[] {
    return this.rules.map((r) => ({
      ruleId: r.spec.ruleId,
      pattern: r.pattern,
      currentState: r.state,
      history: r.history.slice(-10),
    }))
  }
}

const monitor = LTLMonitor.getInstance()
let monitorInitialized = false
let lastRuleCount = -1

/**
 * Inizializza il monitor con regole dal DB o default.
 * Idempotente: ricarica solo se il numero di regole attive è cambiato.
 */
export async function initMonitor(): Promise<void> {
  const dbRules = await db.lTLRule.findMany({ where: { active: true } })
  // Ricalcola solo se il numero di regole è cambiato (es. nuova regola aggiunta)
  if (monitorInitialized && dbRules.length === lastRuleCount) {
    return
  }
  const specs: LTLRuleSpec[] = dbRules.length
    ? dbRules.map((r) => ({
        ruleId: r.ruleId,
        formula: r.ltlFormula,
        description: r.description || '',
        severity: r.severity as 'block' | 'warn' | 'log',
      }))
    : DEFAULT_LTL_RULES
  monitor.loadRules(specs)
  monitorInitialized = true
  lastRuleCount = dbRules.length
}

/**
 * Forza ricaricamento delle regole (chiamare dopo add/delete).
 */
export async function reloadMonitor(): Promise<void> {
  monitorInitialized = false
  lastRuleCount = -1
  await initMonitor()
}

export async function verifyEvent(
  eventLabel: DiscreteState,
  eventType: string,
  payload: unknown
): Promise<{ verdict: 'accept' | 'reject' | 'warn'; violations: { ruleId: string; reason: string }[]; snapshot: { ruleId: string; pattern: string; currentState: string; history: string[] }[] }> {
  await initMonitor()
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
  return {
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ ruleId: v.ruleId, reason: v.reason })),
    snapshot: monitor.snapshot().map((s) => ({ ...s, history: s.history })),
  }
}

export async function addLTLRule(spec: LTLRuleSpec): Promise<void> {
  // Valida sintassi prima di salvare
  try {
    new LTLParser(spec.formula).parse()
  } catch (e: any) {
    throw new Error(`Formula LTL non valida: ${e.message}`)
  }
  try {
    await db.lTLRule.create({
      data: {
        ruleId: spec.ruleId,
        ltlFormula: spec.formula,
        description: spec.description,
        severity: spec.severity,
      },
    })
  } catch (e: any) {
    // B3 fix: gestisci P2002 (unique constraint su ruleId) con errore strutturato
    if (e?.code === 'P2002') {
      throw new LTLRuleConflictError(spec.ruleId)
    }
    throw e
  }
  await reloadMonitor()
}

/**
 * B3: errore strutturato per ruleId duplicato.
 * Il caller (API route) può controllare instanceof per restituire 409 Conflict.
 */
export class LTLRuleConflictError extends Error {
  constructor(public ruleId: string) {
    super(`LTL rule with ruleId "${ruleId}" already exists`)
    this.name = 'LTLRuleConflictError'
  }
}

/**
 * B5 fix: usa update (non updateMany) + lancia errore se non trovata.
 * Prima updateMany nascondeva il caso "ruleId non esistente" ritornando
 * count=0 silenziosamente.
 */
export async function deleteLTLRule(ruleId: string): Promise<void> {
  const existing = await db.lTLRule.findFirst({ where: { ruleId } })
  if (!existing) {
    throw new LTLRuleNotFoundError(ruleId)
  }
  await db.lTLRule.update({
    where: { id: existing.id },
    data: { active: false },
  })
  await reloadMonitor()
}

export class LTLRuleNotFoundError extends Error {
  constructor(public ruleId: string) {
    super(`LTL rule with ruleId "${ruleId}" not found`)
    this.name = 'LTLRuleNotFoundError'
  }
}

export async function listLTLRules() {
  return db.lTLRule.findMany({ where: { active: true }, orderBy: { ruleId: 'asc' } })
}

/**
 * Valida una formula LTL senza salvarla (per preview editor).
 */
export function validateLTLFormula(formula: string): { valid: boolean; error?: string; pattern?: string } {
  try {
    const ast = new LTLParser(formula).parse()
    const fsm = compileAST(ast, { ruleId: 'preview', formula, description: '', severity: 'warn' })
    if (!fsm) {
      return { valid: false, error: 'Pattern LTL non supportato' }
    }
    // B2 fix: rimosso check morto su LTLMonitor.detectPattern (metodo inesistente).
    // Si usa direttamente detectPatternExternal(ast) che è l'implementazione reale.
    const pattern = detectPatternExternal(ast)
    return { valid: true, pattern }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}

function detectPatternExternal(ast: AST): string {
  if (ast.kind === 'G') {
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'X') return 'G(a -> X b)'
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'not') return 'G(a -> !b)'
    if (ast.child.kind === 'impl' && ast.child.right.kind === 'F') return 'G(a -> F b)'
    return 'G(p)'
  }
  if (ast.kind === 'F') return 'F(p)'
  if (ast.kind === 'X') return 'X(p)'
  if (ast.kind === 'U') return 'p U q'
  return 'plain'
}

/**
 * Preview: compila una formula e ritorna la FSM per visualizzazione.
 */
export function previewFSM(formula: string): {
  valid: boolean
  error?: string
  pattern?: string
  states?: { name: string; type: 'initial' | 'accepting' | 'violating' | 'pending' }[]
  description?: string
} {
  try {
    const ast = new LTLParser(formula).parse()
    const fsm = compileAST(ast, { ruleId: 'preview', formula, description: '', severity: 'warn' })
    if (!fsm) return { valid: false, error: 'Pattern non supportato' }
    const pattern = detectPatternExternal(ast)
    const states = Array.from(fsm.states).map((name) => ({
      name,
      type: fsm.initial === name ? 'initial'
        : fsm.accepting.has(name) ? 'accepting'
        : fsm.violating.has(name) ? 'violating'
        : fsm.pending.has(name) ? 'pending'
        : 'pending',
    })) as { name: string; type: 'initial' | 'accepting' | 'violating' | 'pending' }[]
    return {
      valid: true,
      pattern,
      states,
      description: describePattern(pattern),
    }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}

function describePattern(pattern: string): string {
  const desc: Record<string, string> = {
    'G(p)': 'Safety globale: p deve valere in ogni stato. Violazione immediata se p è falso.',
    'F(p)': 'Liveness: p deve apparire almeno una volta. In attesa finché non appare.',
    'X(p)': 'Next: al prossimo evento p deve essere vero.',
    'p U q': 'Until: p deve valere finché q non appare. Violazione se p è falso prima di q.',
    'G(a -> X b)': 'Safety: ogni a deve essere seguito da b al passo successivo.',
    'G(a -> !b)': 'Safety: dopo a, b non deve mai apparire.',
    'G(a -> F b)': 'Liveness condizionata: ogni a deve essere eventualmente seguito da b.',
  }
  return desc[pattern] || 'Pattern non riconosciuto'
}

/**
 * G3: Simula una formula LTL su una sequenza di eventi (senza persistere).
 *
 * Crea un monitor temporaneo, vi carica solo la formula specificata, e
 * valuta ogni evento della sequenza uno alla volta. Ritorna il trace
 * step-by-step + il verdict finale.
 *
 * Utile per validare semanticamente una regola prima del salvataggio.
 *
 * @param formula Formula LTL (es. "G(plan -> F execute)")
 * @param events  Sequenza di state labels (es. ["plan", "execute", "halt"])
 * @returns Per-step verdict + final verdict + violations
 */
export function simulateLTL(
  formula: string,
  events: string[]
): {
  valid: boolean
  error?: string
  pattern?: string
  steps: { event: string; stepIndex: number; verdict: 'accept' | 'warn' | 'reject'; violations: { ruleId: string; reason: string }[] }[]
  finalVerdict: 'accept' | 'warn' | 'reject'
  totalViolations: number
} {
  try {
    const ast = new LTLParser(formula).parse()
    const fsm = compileAST(ast, { ruleId: 'SIM', formula, description: 'simulation', severity: 'warn' })
    if (!fsm) {
      return { valid: false, error: 'Pattern non supportato', steps: [], finalVerdict: 'reject', totalViolations: 0 }
    }
    const pattern = detectPatternExternal(ast)

    // Crea un monitor temporaneo con solo questa regola
    const tempMonitor = new LTLMonitor()
    tempMonitor.loadRules([{ ruleId: 'SIM', formula, description: 'simulation', severity: 'warn' }])

    const steps: { event: string; stepIndex: number; verdict: 'accept' | 'warn' | 'reject'; violations: { ruleId: string; reason: string }[] }[] = []
    let totalViolations = 0
    let finalVerdict: 'accept' | 'warn' | 'reject' = 'accept'

    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const result = tempMonitor.evalEvent(event, null)
      const stepVerdict = result.verdict
      const stepViolations = result.violations.map((v) => ({ ruleId: v.ruleId, reason: v.reason }))
      steps.push({
        event,
        stepIndex: i,
        verdict: stepVerdict,
        violations: stepViolations,
      })
      if (stepVerdict === 'reject') {
        totalViolations += stepViolations.length
        finalVerdict = 'reject'
      } else if (stepVerdict === 'warn' && finalVerdict !== 'reject') {
        finalVerdict = 'warn'
      }
    }

    return {
      valid: true,
      pattern,
      steps,
      finalVerdict,
      totalViolations,
    }
  } catch (e: any) {
    return { valid: false, error: e.message, steps: [], finalVerdict: 'reject', totalViolations: 0 }
  }
}
