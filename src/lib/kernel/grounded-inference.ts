/**
 * Fase 10: Grounded Inference (Model Encapsulator)
 *
 * Risolve la "Vulnerabilità dello Stato Latente": l'LLM non deve mai
 * agire come archivio di memoria o gestore del ciclo di esecuzione.
 * Deve essere degradato a funzione logica stateless.
 *
 * Pattern:
 *  - Model Encapsulator: inietta contesto minimale, azzerando sessione ad ogni iterazione
 *  - Anti-mutazione diretta: l'LLM sintetizza script di parsing deterministici
 *    che l'OS esegue in sandbox isolata (no accesso diretto a DB produzione)
 *  - Information Pass-Through Limitato: solo i dati strettamente necessari al task
 */
import { db } from '@/lib/db'
import { runPipeline } from './compiled-ai' // riusa la sandbox 4-stadi
import * as vm from 'node:vm' // N9 FIX: sandbox isolato per script LLM-generated

export type EncapsulatedCall = {
  agentId: string
  taskGoal: string
  contextData: Record<string, unknown> // dati strettamente necessari
}

export type EncapsulatedResult = {
  sessionId: string
  status: 'executed' | 'failed' | 'sandbox_blocked' | 'pending'
  modelOutput: string
  parsedScript?: string
  sandboxResult?: unknown
  sandboxOk: boolean
  retryCount: number
}

/**
 * Model Encapsulator: esegue una chiamata LLM rigorosamente isolata.
 *
 * 1) Verifica la policy di incapsulamento dell'agente
 * 2) Tronca il contesto al budget di token consentito
 * 3) Costruisce un prompt deterministico con contesto minimale
 * 4) Chiama l'LLM (stub deterministico in questa implementazione)
 * 5) Se l'output contiene uno script, lo esegue in sandbox
 * 6) Persiste tutto in EncapsulatedSession per audit
 */
export async function encapsulatedCall(call: EncapsulatedCall): Promise<EncapsulatedResult> {
  const policy = await getOrCreatePolicy(call.agentId)

  // 1) Tronca contesto al budget
  const contextStr = JSON.stringify(call.contextData)
  const truncatedContext = contextStr.length > policy.contextBudget * 4
    ? contextStr.slice(0, policy.contextBudget * 4) + '...[truncated]'
    : contextStr

  // 2) Costruisci prompt deterministico con reset esplicito della sessione
  const systemPrompt = `You are a stateless reasoning function. SESSION RESET.
You have NO memory of previous calls. Use ONLY the context provided below.
Your task: ${call.taskGoal}

Rules:
- Do NOT modify data directly
- If parsing/transformation is needed, output a JavaScript function body that takes 'input' and returns the result
- Output format: either plain text answer OR a fenced code block with the parsing function
- The function will be executed in a sandbox by the OS, not by you

Context (minimal, scoped to this task only):
${truncatedContext}`

  // 3) Chiama l'LLM via ZAI SDK
  let modelOutput: string
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a grounded inference engine in SOTA Agentic OS. Execute tasks using only the provided context. Output plain text or a fenced JS code block for parsing.' },
        { role: 'user', content: systemPrompt },
      ],
    })
    modelOutput = completion.choices[0]?.message?.content || 'No output from model.'
  } catch (e: any) {
    modelOutput = `LLM Error: ${e.message}. Falling back to deterministic output.\n\n${simulateLLMOutput(call.taskGoal, call.contextData)}`
  }

  // 4) Estrai eventuale script di parsing dal output
  // C2 fix: extractScript ora può throware se script è oversized o contiene blocked keyword.
  // In quel caso, marca la session come 'sandbox_blocked' senza crashare.
  let parsedScript: string | null = null
  let extractionError: string | null = null
  try {
    parsedScript = extractScript(modelOutput)
  } catch (e: any) {
    extractionError = e.message
  }

  // 5) Crea sessione
  const session = await db.encapsulatedSession.create({
    data: {
      agentId: call.agentId,
      taskGoal: call.taskGoal,
      contextInjected: truncatedContext,
      modelOutput,
      parsedScript: parsedScript ?? undefined,
      sandboxOk: false,
      retryCount: 0,
      // C2 — se extractionError, marca come 'sandbox_blocked' (script non sicuro)
      status: extractionError ? 'sandbox_blocked' : (parsedScript ? 'pending' : 'executed'),
    },
  })

  // C2 — se extractionError, logga e ritorna sandbox_blocked
  if (extractionError) {
    // eslint-disable-next-line no-console
    console.warn('[grounded-inference] extractScript blocked:', extractionError)
    return {
      sessionId: session.id,
      status: 'sandbox_blocked',
      modelOutput,
      parsedScript: undefined,
      sandboxResult: { error: extractionError },
      sandboxOk: false,
      retryCount: 0,
    }
  }

  // 6) Se c'è uno script e la sandbox è abilitata, eseguilo
  if (parsedScript && policy.sandboxEnabled) {
    const sandboxResult = await executeSandbox(parsedScript, call.contextData)
    await db.encapsulatedSession.update({
      where: { id: session.id },
      data: {
        sandboxResult: JSON.stringify(sandboxResult.result),
        sandboxOk: sandboxResult.ok,
        status: sandboxResult.ok ? 'executed' : 'sandbox_blocked',
      },
    })
    return {
      sessionId: session.id,
      status: sandboxResult.ok ? 'executed' : 'sandbox_blocked',
      modelOutput,
      parsedScript: parsedScript ?? undefined,
      sandboxResult: sandboxResult.result,
      sandboxOk: sandboxResult.ok,
      retryCount: 0,
    }
  }

  return {
    sessionId: session.id,
    status: 'executed',
    modelOutput,
    parsedScript: parsedScript ?? undefined,
    sandboxOk: false,
    retryCount: 0,
  }
}

/**
 * N9 FIX: Esegue uno script di parsing in sandbox isolata via node:vm.
 * PRIMA: usava `new Function('input', script)` che NON è un sandbox —
 * lo script aveva accesso completo a process, require, db, fetch (RCE).
 * ORA: usa vm.runInNewContext() con contesto limitato e timeout 5s.
 */
async function executeSandbox(script: string, input: unknown): Promise<{ ok: boolean; result: unknown }> {
  try {
    const sandbox = {
      input,
      JSON, Math, Date, String, Number, Array, Object, Boolean,
      parseInt, parseFloat, isNaN,
    }
    // Wrap in IIFE per supportare `return` (come new Function faceva)
    const wrappedCode = `(function(input) {\n${script}\n})(input)`
    const result = vm.runInNewContext(wrappedCode, sandbox, {
      filename: 'grounded-inference-script.js',
      timeout: 5000,
      displayErrors: true,
    })
    return { ok: true, result }
  } catch (e: any) {
    return { ok: false, result: { error: e.message } }
  }
}

/**
 * C2 fix (Model Encapsulator audit Fase A): sanitizzazione extractScript.
 *
 * PRIMA: extractScript estraeva qualunque contenuto dal fenced code block o dal
 * match `return`, senza size cap né keyword blocklist. Anche se vm.runInNewContext
 * blocca `process`/`require` a runtime (sandbox senza questi globals), l'assenza
 * di size cap esponeva a DoS via parse di script enormi (1MB+), e l'assenza di
 * blocklist lasciava passare pattern sospetti che potevano sfruttare vulnerabilità
 * future del sandbox (es. prototype pollution via __proto__).
 *
 * ORA:
 *  - Size cap: 10KB su script estratto (MAX_SCRIPT_SIZE)
 *  - Keyword blocklist: 6 keyword sospette (BLOCKED_KEYWORDS) → throw se matchano
 *  - Trim + null-coalescing esplicito (no undefined)
 *  - Regex `return` reso più stretto (non greedy, max 5KB catturati)
 */
const MAX_SCRIPT_SIZE = 10_000

const BLOCKED_KEYWORDS: readonly string[] = [
  'process',
  'require',
  'fetch',
  'global',
  'constructor',
  '__proto__',
]

/**
 * Estrae uno script di parsing dall'output del modello.
 * Cerca blocchi ```js o ```javascript, oppure una riga che inizia con 'return'.
 *
 * C2 — Sanitizza l'output prima di ritornarlo:
 *  - size cap MAX_SCRIPT_SIZE (throw se superato)
 *  - blocklist BLOCKED_KEYWORDS (throw se keyword presente)
 */
function extractScript(output: string): string | null {
  let rawScript: string | null = null

  // Blocco fenced
  const fenced = output.match(/```(?:js|javascript)?\s*\n([\s\S]*?)\n```/)
  if (fenced) {
    const code = fenced[1].trim()
    // Rimuovi 'function(...){...}' wrapper se presente
    rawScript = code.replace(/^function\s*\w*\s*\([^)]*\)\s*\{?/, '').replace(/\}\s*$/, '').trim()
  } else {
    // Riga "return ..." — regex non greedy + size limit implicito
    // (max 5KB catturati per evitare DoS via regex backtracking)
    const returnMatch = output.match(/^(return\s+[\s\S]{0,5000}?);?\s*$/m)
    if (returnMatch) {
      rawScript = returnMatch[1].trim()
    }
  }

  if (rawScript === null) return null

  // C2 — Size cap
  if (rawScript.length > MAX_SCRIPT_SIZE) {
    throw new Error(
      `extractScript: script too large (${rawScript.length} bytes, max ${MAX_SCRIPT_SIZE}). ` +
      `Possible DoS via LLM-generated oversized script.`
    )
  }

  // C2 — Keyword blocklist
  for (const keyword of BLOCKED_KEYWORDS) {
    if (rawScript.includes(keyword)) {
      throw new Error(
        `extractScript: blocked keyword "${keyword}" found in script. ` +
        `Possible RCE attempt via LLM-generated script.`
      )
    }
  }

  return rawScript
}

/**
 * Simula un output LLM che contiene uno script di parsing.
 * In produzione: sostituire con ZAI.create().chat.completions.create(...)
 */
function simulateLLMOutput(taskGoal: string, context: Record<string, unknown>): string {
  const inputKeys = Object.keys(context)
  // Se il contesto ha un array, genera uno script che lo filtra/mappa
  if (inputKeys.length > 0) {
    const firstKey = inputKeys[0]
    const val = context[firstKey]
    if (Array.isArray(val)) {
      return `Ecco la trasformazione richiesta per "${taskGoal}":

\`\`\`js
return input.${firstKey}.filter(x => x != null).map(x => typeof x === 'object' ? JSON.stringify(x) : String(x))
\`\`\`

Questo script filtra i valori nulli e serializza gli oggetti.`
    }
    if (typeof val === 'object' && val !== null) {
      return `Ecco la trasformazione richiesta per "${taskGoal}":

\`\`\`js
return Object.entries(input.${firstKey}).map(([k, v]) => k + ': ' + v)
\`\`\`

Questo script converte l'oggetto in un array di stringhe "key: value".`
    }
  }
  // Default: risposta testuale senza script
  return `Analisi completata per "${taskGoal}". Il contesto contiene ${inputKeys.length} campi.`
}

/**
 * Recupera o crea la policy di incapsulamento per un agente.
 */
async function getOrCreatePolicy(agentId: string) {
  let policy = await db.encapsulationPolicy.findUnique({ where: { agentId } })
  if (!policy) {
    policy = await db.encapsulationPolicy.create({
      data: {
        agentId,
        maxRetries: 3,
        contextBudget: 2000,
        sandboxEnabled: true,
        forbidDirectMutation: true,
      },
    })
  }
  return policy
}

export async function updatePolicy(
  agentId: string,
  updates: { maxRetries?: number; contextBudget?: number; sandboxEnabled?: boolean; forbidDirectMutation?: boolean }
) {
  return db.encapsulationPolicy.upsert({
    where: { agentId },
    create: { agentId, ...updates },
    update: updates,
  })
}

export async function listSessions(agentId?: string, limit = 30) {
  return db.encapsulatedSession.findMany({
    where: agentId ? { agentId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function groundingStats() {
  const [sessions, executed, sandboxBlocked, policies] = await Promise.all([
    db.encapsulatedSession.count(),
    db.encapsulatedSession.count({ where: { status: 'executed' } }),
    db.encapsulatedSession.count({ where: { status: 'sandbox_blocked' } }),
    db.encapsulationPolicy.count(),
  ])
  return { sessions, executed, sandboxBlocked, policies }
}
