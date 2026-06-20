/**
 * Compiled AI Pipeline (Fase 2)
 *
 * L'LLM genera logica di business dentro template pre-validati.
 * Il codice generato passa attraverso 4 stadi di validazione:
 *   1) Safety      → no eval, no require dinamico, no fs riservati
 *   2) Syntax      → parsing con `new Function` (sandbox)
 *   3) Execution   → smoke test con input fixture
 *   4) Accuracy    → assertion sui risultati attesi
 *
 * Superati tutti gli stadi, l'artefatto è deployable.
 */
import { db } from '@/lib/db'

const FORBIDDEN_TOKENS = [
  'eval(', 'Function(', 'require(', 'process.exit',
  'child_process', 'fs.writeFileSync', 'fs.unlinkSync',
  'fetch(', 'http.request', 'https.request',
  'globalThis.', '__dirname', '__filename',
]

export type ValidationResult = {
  stage: 'safety' | 'syntax' | 'execution' | 'accuracy'
  passed: boolean
  reason: string
}

/**
 * Stadio 1: Safety static analysis.
 */
export function checkSafety(code: string): ValidationResult {
  for (const t of FORBIDDEN_TOKENS) {
    if (code.includes(t)) {
      return { stage: 'safety', passed: false, reason: `Token vietato rilevato: ${t}` }
    }
  }
  // devono esserci solo caratteri sicuri (no backtick per evitare template injection)
  if (code.includes('`')) {
    return { stage: 'safety', passed: false, reason: 'Template literals non permessi' }
  }
  return { stage: 'safety', passed: true, reason: 'Nessun pattern pericoloso' }
}

/**
 * Stadio 2: Syntax check via `new Function` sandbox.
 */
export function checkSyntax(code: string): ValidationResult {
  try {
    new Function('input', code)
    return { stage: 'syntax', passed: true, reason: 'Parsing OK' }
  } catch (e: any) {
    return { stage: 'syntax', passed: false, reason: `Errore sintattico: ${e.message}` }
  }
}

/**
 * Stadio 3: Execution smoke test con fixture.
 */
export function checkExecution(code: string, fixture: unknown): ValidationResult {
  try {
    const fn = new Function('input', code) as (input: unknown) => unknown
    const result = fn(fixture)
    if (result === undefined) {
      return { stage: 'execution', passed: false, reason: 'Funzione non restituisce nulla' }
    }
    return { stage: 'execution', passed: true, reason: 'Esecuzione completata' }
  } catch (e: any) {
    return { stage: 'execution', passed: false, reason: `Runtime error: ${e.message}` }
  }
}

/**
 * Stadio 4: Accuracy assertion.
 */
export function checkAccuracy(
  code: string,
  fixture: unknown,
  expected: unknown
): ValidationResult {
  try {
    const fn = new Function('input', code) as (input: unknown) => unknown
    const result = fn(fixture)
    const ok = JSON.stringify(result) === JSON.stringify(expected)
    return {
      stage: 'accuracy',
      passed: ok,
      reason: ok ? 'Risultato atteso confermato' : `Atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(result)}`,
    }
  } catch (e: any) {
    return { stage: 'accuracy', passed: false, reason: `Runtime error: ${e.message}` }
  }
}

/**
 * Pipeline completa a 4 stadi.
 */
export async function runPipeline(
  name: string,
  templateId: string,
  code: string,
  fixture: unknown,
  expected: unknown
): Promise<{ artifactId: string; results: ValidationResult[]; deployed: boolean }> {
  const results: ValidationResult[] = []
  results.push(checkSafety(code))
  if (!results[0].passed) return await saveArtifact(name, templateId, code, results, false)
  results.push(checkSyntax(code))
  if (!results[1].passed) return await saveArtifact(name, templateId, code, results, false)
  results.push(checkExecution(code, fixture))
  if (!results[2].passed) return await saveArtifact(name, templateId, code, results, false)
  results.push(checkAccuracy(code, fixture, expected))
  const deployed = results[3].passed
  return await saveArtifact(name, templateId, code, results, deployed)
}

async function saveArtifact(
  name: string,
  templateId: string,
  code: string,
  results: ValidationResult[],
  deployed: boolean
): Promise<{ artifactId: string; results: ValidationResult[]; deployed: boolean }> {
  const r = results
  const artifact = await db.compiledArtifact.create({
    data: {
      name,
      templateId,
      generatedCode: code,
      validationSafety: r[0]?.passed || false,
      validationSyntax: r[1]?.passed || false,
      validationExec: r[2]?.passed || false,
      validationAcc: r[3]?.passed || false,
      deployed,
      deployedAt: deployed ? new Date() : null,
    },
  })
  return { artifactId: artifact.id, results, deployed }
}

/**
 * Lista template predefiniti.
 */
export const BUILTIN_TEMPLATES = [
  {
    templateId: 'compliance_check',
    name: 'Compliance Check',
    description: 'Valida che un input rispetti regole di compliance',
    skeleton: 'return input.status === "approved" && input.signature != null;',
  },
  {
    templateId: 'authz_decision',
    name: 'Authorization Decision',
    description: 'Decide se autorizzare un\'azione basandosi su ruolo e scope',
    skeleton: 'return input.role === "admin" || input.scopes.includes("write");',
  },
  {
    templateId: 'risk_score',
    name: 'Risk Scoring',
    description: 'Calcola un punteggio di rischio 0-100 da una request',
    skeleton: 'return Math.min(100, input.attempts * 10 + (input.geo !== "IT" ? 30 : 0));',
  },
]
