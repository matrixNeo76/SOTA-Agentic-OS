/**
 * Script: audit-stubs.ts
 *
 * Analizza tutti i 25 moduli kernel in src/lib/kernel/ per identificare:
 * - Funzioni stub (simulate*, mock*, dummy*)
 * - Commenti TODO/FIXME/STUB
 * - Valori hardcoded che simulano LLM
 * - Template-based invece di ragionamento reale
 *
 * Output: STUB-AUDIT.md con tabella modulo → implementazione
 *
 * Usage: bun run scripts/audit-stubs.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const KERNEL_DIR = '/home/z/my-project/src/lib/kernel'
const OUTPUT_FILE = '/home/z/my-project/download/STUB-AUDIT.md'

// === Pattern stub detection ===
type StubPattern = {
  pattern: RegExp
  label: string
  severity: 'high' | 'medium' | 'low'
}

const STUB_PATTERNS: StubPattern[] = [
  { pattern: /simulateLLMOutput|simulateModelOutput|simulateOutput/gi, label: 'Funzione simulate*', severity: 'high' },
  { pattern: /mock[A-Z]|mockData|mockResponse/gi, label: 'Mock data', severity: 'high' },
  { pattern: /\bSTUB\b|TODO:\s*replace|FIXME:\s*implement/gi, label: 'Commento STUB/TODO', severity: 'medium' },
  { pattern: /deterministic|rule-based.*instead|simplified.*version/gi, label: 'Deterministico/rule-based dichiarato', severity: 'medium' },
  { pattern: /template.based|template.*explanation|generateExplanation/gi, label: 'Template-based', severity: 'medium' },
  { pattern: /return\s+['"`].*['"`]\s*;?\s*\/\/\s*stub/gi, label: 'Return hardcoded con commento stub', severity: 'high' },
  { pattern: /hardcoded|hard.coded/gi, label: 'Hardcoded dichiarato', severity: 'medium' },
  { pattern: /placeholder.*real|placeholder.*implementation/gi, label: 'Placeholder per implementazione reale', severity: 'medium' },
  { pattern: /\bconsole\.log\(.*stub|console\.warn\(.*stub/gi, label: 'Log stub', severity: 'low' },
]

// === Moduli noti come stub dal codice ===
// Distinzione critica:
// - "stub" = dovrebbe usare LLM ma usa implementazione deterministica (gap di credibilità)
// - "partial" = reale ma con limitazioni dichiarate (es. 7 pattern FSM, no NFA)
// - "real-deterministic" = deterministico BY DESIGN (non è uno stub, è una scelta architetturale)
const KNOWN_STUBS: Record<string, { status: 'stub' | 'partial' | 'real'; reason: string }> = {
  // === STUB (gap di credibilità — dovrebbero usare LLM) ===
  'grounded-inference.ts': { status: 'stub', reason: 'simulateLLMOutput() deterministico, no LLM reale — dovrebbe usare ZAI SDK' },
  'time-router.ts': { status: 'stub', reason: 'scoreModels() rule-based + simulateModelOutput() stub — dovrebbe usare LLM per scoring' },
  'sovereign-translator.ts': { status: 'partial', reason: 'generateExplanation() template-based — dovrebbe usare LLM per spiegazioni in linguaggio naturale' },
  'context-engineering.ts': { status: 'partial', reason: 'summarizer deterministico (no LLM) — riassunti low-quality' },
  'agent-objective.ts': { status: 'partial', reason: 'Genera sotto-obiettivo testuale con stub deterministico — dovrebbe usare LLM' },
  'dominator-tree.ts': { status: 'partial', reason: 'semanticMatch() ritorna false (stub) — dovrebbe usare LLM per matching semantico' },

  // === PARTIAL (reale ma con limitazioni dichiarate) ===
  'lean4-agent.ts': { status: 'partial', reason: 'Verifica simbolica emulata, no runtime Lean4 reale' },
  'ltl-monitor.ts': { status: 'partial', reason: '7 pattern FSM, no NFA per pattern composti (G(F(p)), weak-until)' },

  // === REAL DETERMINISTIC (by design, NON stub) ===
  'acts.ts': { status: 'real', reason: 'Controller rule-based deterministico BY DESIGN (O(1) decision, no LLM richiesto)' },
  'normative.ts': { status: 'real', reason: 'Cancello normativo deterministico BY DESIGN (gerarchia assiomatica O(1))' },
  'patchboard.ts': { status: 'real', reason: 'Kernel transazionale JSON Patch deterministico BY DESIGN' },
  'curator.ts': { status: 'real', reason: 'Compilatore XML deterministico BY DESIGN (parsing strutturato, no LLM)' },
  'affect-subsystem.ts': { status: 'real', reason: 'Telemetria affettiva con Meta-Observer deterministico BY DESIGN' },
  'artificial-retainer.ts': { status: 'real', reason: 'Delegation/HITL/Normative deterministici BY DESIGN (calcolo O(1))' },
}

// === Audit module ===
type ModuleAudit = {
  filename: string
  lines: number
  exports: string[]
  stubs: Array<{ line: number; pattern: string; severity: string; context: string }>
  knownStatus?: 'stub' | 'partial' | 'real'
  knownReason?: string
  verdict: 'stub' | 'partial' | 'real'
  confidence: number  // 0-100
}

function auditModule(filepath: string): ModuleAudit {
  const content = readFileSync(filepath, 'utf-8')
  const lines = content.split('\n')
  const filename = filepath.split('/').pop() || ''

  // Extract exports
  const exports: string[] = []
  const exportRe = /export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/g
  let m
  while ((m = exportRe.exec(content)) !== null) {
    exports.push(m[1])
  }

  // Find stubs
  const stubs: ModuleAudit['stubs'] = []
  lines.forEach((line, idx) => {
    STUB_PATTERNS.forEach(({ pattern, label, severity }) => {
      if (pattern.test(line)) {
        stubs.push({
          line: idx + 1,
          pattern: label,
          severity,
          context: line.trim().slice(0, 120),
        })
      }
      pattern.lastIndex = 0  // reset regex
    })
  })

  // Determine verdict
  const known = KNOWN_STUBS[filename]
  let verdict: 'stub' | 'partial' | 'real' = 'real'
  let confidence = 100

  if (known) {
    verdict = known.status
    confidence = 90
  } else if (stubs.some(s => s.severity === 'high')) {
    verdict = 'stub'
    confidence = 70
  } else if (stubs.some(s => s.severity === 'medium')) {
    verdict = 'partial'
    confidence = 75
  } else if (stubs.length > 0) {
    verdict = 'partial'
    confidence = 60
  }

  return {
    filename,
    lines: lines.length,
    exports,
    stubs,
    knownStatus: known?.status,
    knownReason: known?.reason,
    verdict,
    confidence,
  }
}

// === Main ===
function main() {
  console.log('[audit-stubs] Analyzing kernel modules...')

  const files = readdirSync(KERNEL_DIR)
    .filter(f => f.endsWith('.ts'))
    .sort()

  const audits = files.map(f => auditModule(join(KERNEL_DIR, f)))

  // Generate report
  const report = generateReport(audits)
  writeFileSync(OUTPUT_FILE, report)

  // Console summary
  const stubs = audits.filter(a => a.verdict === 'stub')
  const partials = audits.filter(a => a.verdict === 'partial')
  const reals = audits.filter(a => a.verdict === 'real')

  console.log(`[audit-stubs] Audit complete:`)
  console.log(`  ✅ Real: ${reals.length} modules`)
  console.log(`  🟡 Partial: ${partials.length} modules`)
  console.log(`  🔴 Stub: ${stubs.length} modules`)
  console.log(`  Report: ${OUTPUT_FILE}`)

  // Print stub/partial details
  if (stubs.length > 0) {
    console.log('\n🔴 STUB modules:')
    stubs.forEach(a => console.log(`  - ${a.filename}: ${a.knownReason || a.stubs[0]?.context || 'unknown'}`))
  }
  if (partials.length > 0) {
    console.log('\n🟡 PARTIAL modules:')
    partials.forEach(a => console.log(`  - ${a.filename}: ${a.knownReason || a.stubs[0]?.context || 'unknown'}`))
  }
}

function generateReport(audits: ModuleAudit[]): string {
  const date = new Date().toISOString().split('T')[0]
  const stubs = audits.filter(a => a.verdict === 'stub')
  const partials = audits.filter(a => a.verdict === 'partial')
  const reals = audits.filter(a => a.verdict === 'real')

  let md = `# SOTA Agentic OS — Stub Audit Report

> **Data:** ${date}
> **Versione:** 0.9.0 (pre-Track 0)
> **Moduli analizzati:** ${audits.length}
> **Metodo:** Analisi statica del codice in \`src/lib/kernel/\` + pattern matching + knowledge base manuale

---

## Riepilogo

| Status | Count | % |
|--------|-------|---|
| ✅ Reale | ${reals.length} | ${Math.round(reals.length / audits.length * 100)}% |
| 🟡 Parziale | ${partials.length} | ${Math.round(partials.length / audits.length * 100)}% |
| 🔴 Stub | ${stubs.length} | ${Math.round(stubs.length / audits.length * 100)}% |
| **Totale** | ${audits.length} | 100% |

---

## Tabella Dettagliata

| Modulo | Status | Confidence | Righe | Export | Note |
|--------|--------|------------|-------|--------|------|
`

  audits.forEach(a => {
    const icon = a.verdict === 'real' ? '✅' : a.verdict === 'partial' ? '🟡' : '🔴'
    const note = a.knownReason || (a.stubs.length > 0 ? a.stubs[0].context : 'Implementazione completa')
    md += `| ${icon} \`${a.filename}\` | ${a.verdict} | ${a.confidence}% | ${a.lines} | ${a.exports.length} | ${note.slice(0, 80)} |\n`
  })

  // Dettaglio stub
  md += `\n---\n\n## 🔴 Moduli Stub (implementazione deterministica, no LLM)\n\n`
  if (stubs.length === 0) {
    md += `Nessun modulo stub rilevato.\n`
  } else {
    stubs.forEach(a => {
      md += `### ${a.filename}\n\n`
      md += `- **Status:** 🔴 STUB (confidence ${a.confidence}%)\n`
      md += `- **Righe:** ${a.lines}\n`
      md += `- **Export:** ${a.exports.join(', ')}\n`
      if (a.knownReason) md += `- **Ragione nota:** ${a.knownReason}\n`
      md += `\n**Evidenza codice:**\n\n`
      a.stubs.forEach(s => {
        md += `- Line ${s.line} [${s.severity}] ${s.pattern}: \`${s.context}\`\n`
      })
      md += `\n`
    })
  }

  // Dettaglio parziali
  md += `\n---\n\n## 🟡 Moduli Parziali (reale ma con limitazioni)\n\n`
  if (partials.length === 0) {
    md += `Nessun modulo parziale rilevato.\n`
  } else {
    partials.forEach(a => {
      md += `### ${a.filename}\n\n`
      md += `- **Status:** 🟡 PARTIALE (confidence ${a.confidence}%)\n`
      md += `- **Righe:** ${a.lines}\n`
      md += `- **Export:** ${a.exports.join(', ')}\n`
      if (a.knownReason) md += `- **Ragione nota:** ${a.knownReason}\n`
      md += `\n**Evidenza codice:**\n\n`
      if (a.stubs.length > 0) {
        a.stubs.forEach(s => {
          md += `- Line ${s.line} [${s.severity}] ${s.pattern}: \`${s.context}\`\n`
        })
      } else {
        md += `- Nessun pattern stub rilevato automaticamente (classificato manualmente)\n`
      }
      md += `\n`
    })
  }

  // Reali
  md += `\n---\n\n## ✅ Moduli Reali (implementazione completa)\n\n`
  md += `| Modulo | Righe | Export |\n|--------|-------|--------|\n`
  reals.forEach(a => {
    md += `| \`${a.filename}\` | ${a.lines} | ${a.exports.length} |\n`
  })

  // Raccomandazioni
  md += `\n---\n\n## Raccomandazioni per Track 1 — Intelligenza Reale\n\n`
  md += `I seguenti moduli richiedono integrazione LLM reale (Track 1, Settimana 16):\n\n`
  md += `1. **grounded-inference.ts** — sostituire \`simulateLLMOutput()\` con ZAI SDK\n`
  md += `2. **time-router.ts** — sostituire \`scoreModels()\` rule-based con LLM scoring\n`
  md += `3. **sovereign-translator.ts** — sostituire \`generateExplanation()\` template con LLM\n\n`
  md += `I seguenti moduli richiedono approfondimento (Track 3, opzionale):\n\n`
  md += `1. **lean4-agent.ts** — dichiarare "emulazione simbolica" o integrare runtime Lean4 reale\n`
  md += `2. **ltl-monitor.ts** — estendere a NFA per pattern composti (\`G(F(p))\`, weak-until)\n`

  md += `\n---\n\n*Report generato il ${date} da \`scripts/audit-stubs.ts\`*\n`

  return md
}

main()
