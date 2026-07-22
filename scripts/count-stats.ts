/**
 * Script: count-stats.ts
 *
 * Conta i reali numeri del progetto per riconciliazione documentale:
 * - Modelli Prisma (da schema.prisma)
 * - API routes (da src/app/api/)
 * - Moduli kernel (da src/lib/kernel/)
 * - Componenti workbench (da src/components/workbench/)
 * - Test files (da tests/)
 * - Componenti UI shadcn (da src/components/ui/)
 *
 * Output: console + file /home/z/my-project/download/STATS.md
 *
 * Usage: bun run scripts/count-stats.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = '/home/z/my-project'

// === Counter helpers ===
function countPrismaModels(): number {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf-8')
  const matches = schema.match(/^model\s+(\w+)\s*{/gm)
  return matches ? matches.length : 0
}

function countPrismaModelsList(): string[] {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf-8')
  const matches = schema.match(/^model\s+(\w+)\s*{/gm)
  if (!matches) return []
  return matches.map(m => m.replace(/^model\s+/, '').replace(/\s*{/, ''))
}

function countDir(dir: string, filter: (f: string) => boolean): number {
  if (!existsSync(dir)) return 0
  let count = 0
  const items = readdirSync(dir)
  for (const item of items) {
    const path = join(dir, item)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      count += countDir(path, filter)
    } else if (filter(item)) {
      count++
    }
  }
  return count
}

function listApiRoutes(): string[] {
  const routes: string[] = []
  const apiDir = join(ROOT, 'src/app/api')
  if (!existsSync(apiDir)) return routes

  function walk(dir: string, prefix: string) {
    const items = readdirSync(dir)
    for (const item of items) {
      const path = join(dir, item)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        // Check if it has a route.ts
        if (existsSync(join(path, 'route.ts'))) {
          const routeName = prefix + '/' + item
          routes.push(routeName)
        }
        // Recurse into subdirectories
        walk(path, prefix + '/' + item)
      }
    }
  }
  walk(apiDir, '/api')
  return routes.sort()
}

function listKernelModules(): string[] {
  const dir = join(ROOT, 'src/lib/kernel')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts'))
    .sort()
}

function listWorkbenchComponents(): string[] {
  const dir = join(ROOT, 'src/components/workbench')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
    .sort()
}

function listUiComponents(): string[] {
  const dir = join(ROOT, 'src/components/ui')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.tsx'))
    .sort()
}

function listTestFiles(): string[] {
  const dir = join(ROOT, 'tests')
  if (!existsSync(dir)) return []
  const files: string[] = []
  function walk(d: string) {
    const items = readdirSync(d)
    for (const item of items) {
      const path = join(d, item)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (item.endsWith('.test.ts') || item.endsWith('.test.tsx')) files.push(item)
    }
  }
  walk(dir)
  return files.sort()
}

function countLines(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  const items = readdirSync(dir)
  for (const item of items) {
    const path = join(dir, item)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      total += countLines(path, ext)
    } else if (item.endsWith(ext)) {
      const content = readFileSync(path, 'utf-8')
      total += content.split('\n').length
    }
  }
  return total
}

// === Main ===
function main() {
  const prismaModels = countPrismaModels()
  const prismaModelsList = countPrismaModelsList()
  const apiRoutes = listApiRoutes()
  const kernelModules = listKernelModules()
  const workbenchComponents = listWorkbenchComponents()
  const uiComponents = listUiComponents()
  const testFiles = listTestFiles()
  const workbenchLines = countLines(join(ROOT, 'src/components/workbench'), '.tsx') + countLines(join(ROOT, 'src/components/workbench'), '.ts')

  console.log('=== SOTA Agentic OS — Project Stats ===\n')
  console.log(`Prisma models: ${prismaModels}`)
  console.log(`API routes: ${apiRoutes.length}`)
  console.log(`Kernel modules: ${kernelModules.length}`)
  console.log(`Workbench components: ${workbenchComponents.length} (~${workbenchLines} lines)`)
  console.log(`UI components (shadcn): ${uiComponents.length}`)
  console.log(`Test files: ${testFiles.length}`)

  // Generate STATS.md
  const date = new Date().toISOString().split('T')[0]
  let md = `# SOTA Agentic OS — Project Stats (Reconciled)

> **Data:** ${date}
> **Versione:** 0.9.0
> **Metodo:** Conteggio automatico da \`scripts/count-stats.ts\`

---

## Numeri Ufficiali (fonte di verità)

| Metrica | Valore | Fonte |
|---------|--------|-------|
| Modelli Prisma | ${prismaModels} | \`prisma/schema.prisma\` |
| API routes | ${apiRoutes.length} | \`src/app/api/**/route.ts\` |
| Moduli kernel | ${kernelModules.length} | \`src/lib/kernel/*.ts\` |
| Componenti workbench | ${workbenchComponents.length} (~${workbenchLines} righe) | \`src/components/workbench/*.{ts,tsx}\` |
| Componenti UI shadcn | ${uiComponents.length} | \`src/components/ui/*.tsx\` |
| File di test | ${testFiles.length} | \`tests/**/*.test.{ts,tsx}\` |

---

## Modelli Prisma (${prismaModels})

\`\`\`
${prismaModelsList.join('\n')}
\`\`\`

---

## API Routes (${apiRoutes.length})

\`\`\`
${apiRoutes.join('\n')}
\`\`\`

---

## Moduli Kernel (${kernelModules.length})

\`\`\`
${kernelModules.join('\n')}
\`\`\`

---

## Componenti Workbench (${workbenchComponents.length}, ~${workbenchLines} righe)

\`\`\`
${workbenchComponents.join('\n')}
\`\`\`

---

## Componenti UI shadcn (${uiComponents.length})

\`\`\`
${uiComponents.join('\n')}
\`\`\`

---

## File di Test (${testFiles.length})

\`\`\`
${testFiles.join('\n')}
\`\`\`

---

*Statistiche generate il ${date} da \`scripts/count-stats.ts\`*
`

  writeFileSync(join(ROOT, 'download/STATS.md'), md)
  console.log(`\nReport: ${join(ROOT, 'download/STATS.md')}`)
}

main()
