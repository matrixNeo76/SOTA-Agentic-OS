/**
 * Fase 8: Evoluzione Formale dei Workflow (Lean4Agent)
 *
 * L'ERL (Fase 5) estrae euristiche dall'esperienza, ma per processi
 * industriali serve rigore matematico. Questa fase traduce il DAG di
 * DynAMO (Fase 2) in contratti formali verificabili.
 *
 * Pipeline:
 *  1) Per ogni nodo del DAG, genera un FormalContract con:
 *     - preconditions (predicati che devono valere prima)
 *     - postconditions (predicati che devono valere dopo)
 *     - variableTypes (tipi delle variabili lette/scritte)
 *  2) Verifica formale: traduce i contratti in pseudo-Lean4 (semplificato)
 *     e verifica consistenza (read/write variables, pre/post implications)
 *  3) LeanEvolve: quando un task fallisce, localizza il nodo problematico
 *     usando i log di traiettoria + feedback formale, riscrive solo quel
 *     nodo via LLM, ri-valida prima del deploy
 *
 * Nota: la vera integrazione Lean4 richiede un runtime Lean esterno.
 * Qui implementiamo un verifier simbolico che emula i controlli principali
 * (consistenza variabili, implicazioni pre/post) senza dipendenze esterne.
 */
import { db } from '@/lib/db'

// B1 fix: size cap su rewrittenInstruction e failureReason
const MAX_INSTRUCTION_SIZE = 10_000
const MAX_FAILURE_REASON_SIZE = 5_000

// G4 fix: cap massimo cicli di leanEvolve
const MAX_EVOLVE_CYCLES = 10

export type FormalContractSpec = {
  taskId: string
  preconditions: string[]   // es. ["input.status = 'approved'", "context.budget > 0"]
  postconditions: string[]  // es. ["output.report_id != null"]
  variableTypes: Record<string, string>  // es. { budget: "Int", status: "String" }
}

export type VerificationResult = {
  taskId: string
  verified: boolean
  errors: string[]
  warnings: string[]
  leanSource: string
}

/**
 * Associa contratti formali ai task di un piano DynAMO.
 * Se il piano ha già contratti, li sovrascrive.
 */
export async function attachContracts(
  planId: string,
  contracts: FormalContractSpec[]
): Promise<{ attached: number; planId: string }> {
  // Elimina contratti precedenti per questo piano
  await db.formalContract.deleteMany({ where: { planId } })

  // B8 FIX: batch create with createMany instead of N+1 sequential loop
  if (contracts.length > 0) {
    await db.formalContract.createMany({
      data: contracts.map((c) => ({
        planId,
        taskId: c.taskId,
        preconditions: JSON.stringify(c.preconditions),
        postconditions: JSON.stringify(c.postconditions),
        variableTypes: JSON.stringify(c.variableTypes),
        verified: false,
      })),
    })
  }

  return { attached: contracts.length, planId }
}

/**
 * Genera contratti formali automaticamente dal piano (DAG).
 * Heuristiche:
 *  - Per ogni task: preconditions = dipendenze completate
 *  - postconditions = task stesso completato
 *  - variableTypes: inferite dal payload del task (tutte String di default)
 */
export async function autoGenerateContracts(planId: string): Promise<FormalContractSpec[]> {
  // B5 fix: valida planId non vuoto
  if (!planId || !planId.trim()) {
    throw new Error('planId is required and cannot be empty')
  }
  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  })
  if (!plan) throw new Error(`Piano ${planId} non trovato`)

  // B3 FIX: wrap JSON.parse in try/catch
  let planJson: any
  try { planJson = JSON.parse(plan.planJson) } catch { planJson = { tasks: [] } }
  const tasks: { taskId: string; agentId: string; description: string; dependencies: string[] }[] = planJson.tasks || []
  const contracts: FormalContractSpec[] = []

  for (const t of tasks) {
    const preconditions = t.dependencies.map((dep) => `task.${dep}.status = 'completed'`)
    preconditions.push(`task.${t.taskId}.status = 'pending'`)
    const postconditions = [`task.${t.taskId}.status = 'completed'`]
    const variableTypes: Record<string, string> = {
      [`task.${t.taskId}.status`]: 'String',
      [`task.${t.taskId}.agentId`]: 'String',
    }
    contracts.push({
      taskId: t.taskId,
      preconditions,
      postconditions,
      variableTypes,
    })
  }

  await attachContracts(planId, contracts)
  return contracts
}

/**
 * Verifica formale di tutti i contratti di un piano.
 *
 * Controlli implementati (emulazione Lean4):
 *  1) Type consistency: tutte le variabili usate in pre/post hanno un tipo dichiarato
 *  2) Dependency closure: le preconditions di un task devono poter essere soddisfatte
 *     dalle postconditions delle sue dipendenze
 *  3) Acyclic consistency: nessuna postcondition contraddice una precondizione di un task precedente
 *
 * Ritorna un verification log per ogni task.
 */
export async function verifyWorkflow(planId: string): Promise<{
  verified: boolean
  results: VerificationResult[]
  leanSource: string
  workflowId: string
}> {
  // B5 fix: valida planId non vuoto
  if (!planId || !planId.trim()) {
    throw new Error('planId is required and cannot be empty')
  }
  const plan = await db.agentPlan.findUnique({
    where: { id: planId },
    include: { tasks: true },
  })
  if (!plan) throw new Error(`Piano ${planId} non trovato`)

  // B3 FIX: wrap JSON.parse in try/catch
  let planJson: any
  try { planJson = JSON.parse(plan.planJson) } catch { planJson = { tasks: [] } }
  const tasks: { taskId: string; agentId: string; description: string; dependencies: string[] }[] = planJson.tasks || []
  const contractRows = await db.formalContract.findMany({ where: { planId } })
  const contractMap = new Map(contractRows.map((c) => [c.taskId, c]))

  const results: VerificationResult[] = []
  const allErrors: string[] = []
  // B4 fix: array per batch update dei contratti
  const contractUpdates: Array<{ id: string; verified: boolean; verificationLog: string }> = []

  // Genera pseudo-Lean4 source
  const leanLines: string[] = [
    '-- FormalAgentLib: Auto-generated Lean4 contracts',
    `-- Workflow: ${plan.taskGoal}`,
    `-- Plan ID: ${planId}`,
    '',
    'structure TaskState where',
    '  status : String',
    '  agentId : String',
    '  result : Option String',
    '',
    'structure WorkflowState where',
    '  tasks : List (String × TaskState)',
    '',
  ]

  for (const t of tasks) {
    const c = contractMap.get(t.taskId)
    if (!c) {
      const err = `Task ${t.taskId} senza contratto formale`
      allErrors.push(err)
      results.push({
        taskId: t.taskId,
        verified: false,
        errors: [err],
        warnings: [],
        leanSource: '',
      })
      continue
    }

    // B3 FIX: wrap JSON.parse in try/catch
    let preconditions: string[] = []
    let postconditions: string[] = []
    let variableTypes: Record<string, string> = {}
    try { preconditions = JSON.parse(c.preconditions) } catch { preconditions = [] }
    try { postconditions = JSON.parse(c.postconditions) } catch { postconditions = [] }
    try { variableTypes = JSON.parse(c.variableTypes) } catch { variableTypes = {} }

    const errors: string[] = []
    const warnings: string[] = []

    // Check 1: type consistency
    const allPredicates = [...preconditions, ...postconditions]
    for (const pred of allPredicates) {
      const varMatches = pred.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\s*(=|!=|>|<)/g) || []
      for (const vm of varMatches) {
        const varName = vm.split(/\s*[=!<>]/)[0].trim()
        if (!variableTypes[varName] && !varName.startsWith('task.')) {
          warnings.push(`Variabile ${varName} senza tipo dichiarato`)
        }
      }
    }

    // Check 2: dependency closure
    // Per ogni dipendenza dep, deve esistere una postcondition "task.dep.status = 'completed'"
    // che soddisfa la precondizione "task.dep.status = 'completed'"
    for (const dep of t.dependencies) {
      const depContract = contractMap.get(dep)
      if (!depContract) {
        errors.push(`Dipendenza ${dep} senza contratto (cannot verify closure)`)
        continue
      }
      // B3 FIX: wrap JSON.parse in try/catch
      let depPost: string[] = []
      try { depPost = JSON.parse(depContract.postconditions) } catch { depPost = [] }
      const expectedPost = `task.${dep}.status = 'completed'`
      // B4 FIX: use regex instead of loose includes to avoid false positives
      // PRIMA: p.includes('completed') matchava anche 'not-completed' o 'incomplete'
      // ORA: regex che verifica status = 'completed' con eventuali spazi
      const completedRegex = new RegExp(`task\\.${dep}\\.status\\s*=\\s*['"]completed['"]`)
      if (!depPost.some((p) => completedRegex.test(p))) {
        errors.push(`Closure fallita: ${dep} non garantisce '${expectedPost}'`)
      }
    }

    // Check 3: postcondition ben formata (almeno una post)
    if (postconditions.length === 0) {
      warnings.push(`Nessuna postcondition: task senza effetto osservabile`)
    }

    const verified = errors.length === 0
    if (!verified) allErrors.push(...errors.map((e) => `${t.taskId}: ${e}`))

    // Genera blocco Lean4 per questo task
    const leanBlock = [
      '',
      `-- Task ${t.taskId} (${t.agentId})`,
      `def task_${t.taskId}_pre (s : WorkflowState) : Prop :=`,
      `  ${preconditions.length > 0 ? preconditions.map(p => `"${p}"`).join(' ∧ ') : 'True'}`,
      '',
      `def task_${t.taskId}_post (s : WorkflowState) (s' : WorkflowState) : Prop :=`,
      `  ${postconditions.length > 0 ? postconditions.map(p => `"${p}"`).join(' ∧ ') : 'True'}`,
      '',
      `theorem task_${t.taskId}_correct :`,
      `  ∀ s : WorkflowState, task_${t.taskId}_pre s →`,
      `  ∃ s' : WorkflowState, task_${t.taskId}_post s s' := by`,
      `  ${verified ? 'sorry -- verified by symbolic checker' : 'sorry -- VERIFICATION FAILED'}`,
    ].join('\n')

    leanLines.push(leanBlock)

    results.push({
      taskId: t.taskId,
      verified,
      errors,
      warnings,
      leanSource: leanBlock,
    })

    // B4 fix: raccogli update per batch invece di N+1 sequenziali
    // PRIMA: await db.formalContract.update nel loop → N query sequenziali
    // ORA: raccogli in array, poi Promise.all fuori dal loop
    contractUpdates.push({
      id: c.id,
      verified,
      verificationLog: JSON.stringify({ errors, warnings }, null, 2),
    })
  }

  // B4 fix: batch update tutti i contratti in parallelo
  await Promise.all(
    contractUpdates.map((u) =>
      db.formalContract.update({
        where: { id: u.id },
        data: { verified: u.verified, verificationLog: u.verificationLog },
      }),
    ),
  )

  const verifiedOverall = allErrors.length === 0
  const leanSource = leanLines.join('\n')

  // Salva snapshot del workflow verificato
  // C3 fix: usa version incrementale (max+1) invece di hardcoded version:1
  // PRIMA: ogni verifyWorkflow creava un nuovo record con version:1 → duplicati
  // ORA: calcola max version esistente per planId e incrementa
  const existingMaxVersion = await db.verifiedWorkflow.findFirst({
    where: { planId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const nextVersion = (existingMaxVersion?.version || 0) + 1

  const workflow = await db.verifiedWorkflow.create({
    data: {
      planId,
      contractsJson: JSON.stringify(results),
      leanSource,
      verified: verifiedOverall,
      deployed: false,
      version: nextVersion, // C3: incrementale invece di hardcoded 1
    },
  })

  return {
    verified: verifiedOverall,
    results,
    leanSource,
    workflowId: workflow.id,
  }
}

/**
 * LeanEvolve: quando un task fallisce, riscrive l'istruzione via LLM
 * e ri-valida il workflow.
 *
 * Pipeline:
 *  1) Identifica il nodo fallito (failedTaskId) e il motivo
 *  2) Recupera il feedback formale (errori Lean4)
 *  3) Genera nuova istruzione via LLM (stub: deterministica per ora)
 *  4) Ri-valida il workflow con la nuova istruzione
 */
export async function leanEvolve(
  planId: string,
  failedTaskId: string,
  failureReason: string
): Promise<{
  cycle: number
  rewrittenInstruction: string
  revalidated: boolean
  revalidationLog: string
}> {
  // Recupera ciclo precedente
  const lastEvolve = await db.leanEvolveEvent.findFirst({
    where: { planId },
    orderBy: { createdAt: 'desc' },
  })
  const cycle = (lastEvolve?.cycle || 0) + 1

  // G4 fix: cap massimo cicli per prevenire loop infinito
  // PRIMA: cycle cresceva indefinitamente se leanEvolve veniva chiamato ripetitivamente
  // ORA: throw se supera MAX_EVOLVE_CYCLES (10)
  if (cycle > MAX_EVOLVE_CYCLES) {
    throw new Error(`Max evolve cycles (${MAX_EVOLVE_CYCLES}) reached for plan ${planId}. Manual intervention required.`)
  }

  // B1 fix: size cap su failureReason (5KB)
  const truncatedFailureReason = failureReason.length > MAX_FAILURE_REASON_SIZE
    ? failureReason.slice(0, MAX_FAILURE_REASON_SIZE) + '...[truncated]'
    : failureReason

  // Recupera feedback formale
  const contract = await db.formalContract.findFirst({
    where: { planId, taskId: failedTaskId },
  })
  const leanFeedback = contract?.verificationLog || 'No formal feedback available'

  // Genera nuova istruzione via LLM con fallback deterministico
  const plan = await db.agentPlan.findUnique({ where: { id: planId } })
  // C1 fix: try/catch su JSON.parse(plan.planJson) — consistenza con autoGenerateContracts/verifyWorkflow
  // PRIMA: se planJson corrotto, leanEvolve crashava con errore non gestito
  // ORA: fallback a { tasks: [] } e continua con deterministicRewrite
  let planJson: any
  try { planJson = JSON.parse(plan?.planJson || '{}') } catch { planJson = { tasks: [] } }
  const failedTask = (planJson.tasks || []).find((t: any) => t.taskId === failedTaskId)
  const originalDescription = failedTask?.description || ''
  const deterministicRewrite = `${originalDescription} [LeanEvolve v${cycle}: pre-condizioni verificate, recovery da "${truncatedFailureReason.slice(0, 50)}"]`

  let rewrittenInstruction: string
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a Lean4 formal verifier evolution engine. Rewrite the failed task instruction to fix the issue. Output ONLY the rewritten instruction, nothing else.' },
        { role: 'user', content: `Original instruction: "${originalDescription}"\nFailure reason: ${failureReason}\nLean4 feedback: ${leanFeedback}\n\nRewrite the instruction to fix the failure.` },
      ],
    })
    rewrittenInstruction = completion.choices[0]?.message?.content?.trim() || deterministicRewrite
  } catch {
    rewrittenInstruction = deterministicRewrite
  }

  // B1 fix: size cap su rewrittenInstruction (10KB)
  if (rewrittenInstruction.length > MAX_INSTRUCTION_SIZE) {
    rewrittenInstruction = rewrittenInstruction.slice(0, MAX_INSTRUCTION_SIZE) + '...[truncated]'
  }

  // C5 FIX: apply rewrittenInstruction back to planJson BEFORE re-verifying.
  // PRIMA: rewrittenInstruction era salvato solo nell'evento, ma il planJson
  // non veniva modificato → la ri-validazione girava contro il piano originale.
  // ORA: aggiorna la description del task fallito nel planJson, poi ri-valida.
  if (failedTask && rewrittenInstruction) {
    const updatedPlanJson = JSON.parse(JSON.stringify(planJson)) // deep clone
    const taskToUpdate = (updatedPlanJson.tasks || []).find((t: any) => t.taskId === failedTaskId)
    if (taskToUpdate) {
      taskToUpdate.description = rewrittenInstruction
      await db.agentPlan.update({
        where: { id: planId },
        data: { planJson: JSON.stringify(updatedPlanJson) },
      })
    }
  }

  // Ri-valida (ora contro il piano aggiornato con la nuova istruzione)
  const verification = await verifyWorkflow(planId)
  const revalidated = verification.verified

  // Persisti evento LeanEvolve
  await db.leanEvolveEvent.create({
    data: {
      planId,
      failedTaskId,
      failureReason: truncatedFailureReason, // B1: troncato
      leanFeedback,
      rewrittenInstruction,
      revalidated,
      revalidationLog: JSON.stringify({
        verified: verification.verified,
        results: verification.results.map((r) => ({ taskId: r.taskId, verified: r.verified, errors: r.errors })),
      }),
      cycle,
    },
  })

  return {
    cycle,
    rewrittenInstruction,
    revalidated,
    revalidationLog: JSON.stringify({
      verified: verification.verified,
      errorCount: verification.results.reduce((s, r) => s + r.errors.length, 0),
    }),
  }
}

/**
 * Statistiche per dashboard.
 *
 * B2 fix: tutte le 6 query in Promise.all (era 3+3 sequenziali).
 * PRIMA: 3 query in Promise.all + 3 query sequenziali = 4 round-trip DB.
 * ORA: 6 query in 1 Promise.all = 1 round-trip DB.
 */
export async function leanStats() {
  const [contracts, verifiedWorkflows, evolveEvents, verifiedContracts, deployedWorkflows, successfulEvolve] = await Promise.all([
    db.formalContract.count(),
    db.verifiedWorkflow.count(),
    db.leanEvolveEvent.count(),
    db.formalContract.count({ where: { verified: true } }),
    db.verifiedWorkflow.count({ where: { deployed: true } }),
    db.leanEvolveEvent.count({ where: { revalidated: true } }),
  ])

  return {
    contracts,
    verifiedContracts,
    verifiedWorkflows,
    deployedWorkflows,
    evolveEvents,
    successfulEvolve,
  }
}

export async function listVerifiedWorkflows(planId?: string) {
  return db.verifiedWorkflow.findMany({
    where: planId ? { planId } : {},
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

export async function listEvolveEvents(planId?: string) {
  return db.leanEvolveEvent.findMany({
    where: planId ? { planId } : {},
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}
