/**
 * Bootstrap Demo — Customer Support Automation Use Case
 *
 * Configura l'ambiente SOTA Agentic OS per un caso d'uso reale:
 * azienda SaaS che automatizza il supporto clienti con agenti AI governati.
 *
 * Usage: npx tsx scripts/bootstrap-demo.ts
 */

import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth/session'

// === Demo Data =======================================================

const DEMO_AGENTS = [
  { uri: 'agent://orchestrator', name: 'Orchestrator', tier: 'executive', role: 'Coordinate support workflow' },
  { uri: 'agent://triage', name: 'Triage Agent', tier: 'strategic', role: 'Classify and route tickets' },
  { uri: 'agent://billing', name: 'Billing Specialist', tier: 'operational', role: 'Handle billing inquiries and refunds' },
  { uri: 'agent://technical', name: 'Technical Support', tier: 'operational', role: 'Diagnose and resolve technical issues' },
  { uri: 'agent://qa', name: 'QA Reviewer', tier: 'strategic', role: 'Review responses before sending' },
]

const DEMO_RED_LINES = [
  { description: 'Never process refund above $500 without human approval', rationale: 'Financial safety policy', severity: 'absolute' },
  { description: 'Never share customer PII with third-party tools', rationale: 'GDPR compliance', severity: 'absolute' },
  { description: 'Never escalate to manager without QA review', rationale: 'Escalation policy', severity: 'strong' },
]

const DEMO_LTL_RULES = [
  { ruleId: 'LTL-SLA-001', formula: 'G(ticket_created -> F(response_sent))', description: 'Every ticket must eventually get a response (SLA)', severity: 'warn' },
  { ruleId: 'LTL-SAFETY-001', formula: 'G(refund_request -> X human_approval)', description: 'Refund requests require human approval next step', severity: 'block' },
  { ruleId: 'LTL-QA-001', formula: 'G(response_drafted -> X qa_reviewed)', description: 'Every response draft must be QA reviewed', severity: 'block' },
]

const DEMO_AXIOMS = [
  { axiom: 'GDPR: never store customer PII outside approved systems', priority: 1 },
  { axiom: 'SLA: respond to all tickets within 24 hours', priority: 1 },
  { axiom: 'Escalate to manager only after QA review fails', priority: 2 },
  { axiom: 'Use customer-facing tone: professional, empathetic, concise', priority: 3 },
  { axiom: 'Log all actions for audit trail', priority: 2 },
]

const DEMO_KB_ENTRIES = [
  {
    agentUri: 'agent://billing',
    layer: 'procedural' as const,
    content: 'Refund Policy: Refunds under $100 can be processed automatically. Refunds $100-$500 require team lead approval. Refunds above $500 require manager approval.',
  },
  {
    agentUri: 'agent://technical',
    layer: 'procedural' as const,
    content: 'API Rate Limit Error: If customer reports 429 errors, check their plan tier. Free tier: 100 req/hour. Pro tier: 1000 req/hour. Enterprise: unlimited. Suggest upgrade if consistently hitting limits.',
  },
  {
    agentUri: 'agent://triage',
    layer: 'procedural' as const,
    content: 'Ticket Classification Guide: billing=invoice, payment, refund, subscription. technical=bug, error, integration, api. general=feature request, feedback, question. Escalate security issues immediately.',
  },
  {
    agentUri: 'agent://billing',
    layer: 'semantic' as const,
    content: 'Subscription Plans: Free ($0/mo, 100 API calls), Pro ($49/mo, 1000 calls), Team ($199/mo, 5000 calls), Enterprise (custom, unlimited). Pro-rate refunds for plan downgrades.',
  },
  {
    agentUri: 'agent://technical',
    layer: 'episodic' as const,
    content: 'Common Integration Issues: 1) Webhook not firing → check HTTPS cert, retry policy. 2) Auth 401 → verify API key not expired, check scopes. 3) Rate 429 → implement exponential backoff. 4) Timeout → increase client timeout to 30s.',
  },
]

// === Bootstrap Functions =============================================

async function ensureAdminUser() {
  const existing = await db.user.findUnique({ where: { email: 'admin@sota-os.local' } })
  if (existing) {
    console.log('  ✓ Admin user exists')
    return
  }
  const { hash, salt } = hashPassword('admin123')
  await db.user.create({
    data: {
      email: 'admin@sota-os.local',
      name: 'System Admin',
      role: 'admin',
      passwordHash: `${salt}:${hash}`,
      tenantId: 'default',
      active: true,
    },
  })
  console.log('  ✓ Admin user created (admin@sota-os.local / admin123)')
}

async function bootstrapAgentMesh() {
  console.log('\n📡 Bootstrapping Agent Mesh...')
  for (const agent of DEMO_AGENTS) {
    const existing = await db.graphNode.findUnique({ where: { uri: agent.uri } })
    if (!existing) {
      await db.graphNode.create({
        data: {
          uri: agent.uri,
          entityType: 'Agent',
          lifecycleState: 'active',
          attributes: JSON.stringify({ name: agent.name, tier: agent.tier, role: agent.role }),
          createdByAgent: 'system',
          createdByModel: 'bootstrap',
          source: 'system-event',
          confidence: 1.0,
        },
      })
    }
  }
  // Create mesh edges (hierarchy) using FK relations
  const edges = [
    { from: 'agent://orchestrator', to: 'agent://triage', relation: 'SUPERVISES' },
    { from: 'agent://orchestrator', to: 'agent://qa', relation: 'SUPERVISES' },
    { from: 'agent://triage', to: 'agent://billing', relation: 'DELEGATES_TO' },
    { from: 'agent://triage', to: 'agent://technical', relation: 'DELEGATES_TO' },
  ]
  for (const edge of edges) {
    const fromNode = await db.graphNode.findUnique({ where: { uri: edge.from } })
    const toNode = await db.graphNode.findUnique({ where: { uri: edge.to } })
    if (fromNode && toNode) {
      const existingEdge = await db.graphEdge.findFirst({
        where: { fromNodeId: fromNode.id, toNodeId: toNode.id, relationType: edge.relation },
      })
      if (!existingEdge) {
        await db.graphEdge.create({
          data: {
            fromNodeId: fromNode.id,
            toNodeId: toNode.id,
            relationType: edge.relation,
            properties: '{}',
            createdByAgent: 'system',
          },
        })
      }
    }
  }
  console.log(`  ✓ ${DEMO_AGENTS.length} agents created with ${edges.length} hierarchy edges`)
}

async function createRedLines() {
  console.log('\n🛡️ Creating Red Lines...')
  for (const rl of DEMO_RED_LINES) {
    await db.redLine.upsert({
      where: { description: rl.description },
      create: rl,
      update: {},
    })
  }
  console.log(`  ✓ ${DEMO_RED_LINES.length} Red Lines created`)
}

async function createLTLRules() {
  console.log('\n📋 Creating LTL Rules...')
  for (const rule of DEMO_LTL_RULES) {
    await db.lTLRule.upsert({
      where: { ruleId: rule.ruleId },
      create: {
        ruleId: rule.ruleId,
        ltlFormula: rule.formula,
        description: rule.description,
        severity: rule.severity,
        active: true,
      },
      update: {},
    })
  }
  console.log(`  ✓ ${DEMO_LTL_RULES.length} LTL Rules created`)
}

async function createAxioms() {
  console.log('\n⚖️ Creating Normative Axioms...')
  for (const ax of DEMO_AXIOMS) {
    const existing = await db.normativeRule.findFirst({ where: { axiom: ax.axiom } })
    if (!existing) {
      await db.normativeRule.create({ data: ax })
    }
  }
  console.log(`  ✓ ${DEMO_AXIOMS.length} Normative Axioms created`)
}

async function seedKnowledgeBase() {
  console.log('\n📚 Seeding Knowledge Base...')
  for (const entry of DEMO_KB_ENTRIES) {
    const existing = await db.memoryEntry.findFirst({
      where: { agentUri: entry.agentUri, content: { startsWith: entry.content.slice(0, 50) } },
    })
    if (!existing) {
      await db.memoryEntry.create({
        data: {
          agentUri: entry.agentUri,
          layer: entry.layer,
          content: entry.content,
          utilityScore: 0.8,
        },
      })
    }
  }
  console.log(`  ✓ ${DEMO_KB_ENTRIES.length} KB entries created`)
}

async function captureInitialWorldState() {
  console.log('\n🌍 Capturing initial WorldState...')
  const stats = {
    totalAgents: DEMO_AGENTS.length,
    activeTickets: 0,
    resolvedToday: 0,
    avgResponseTime: 0,
    customerSatisfaction: 0,
    completedTasksLast24h: 0,
    failedTasksLast24h: 0,
    totalCostLast24h: 0,
    errorRate: 0,
    anomalies: [] as string[],
  }
  await db.globalState.upsert({
    where: { key: 'world_model_snapshot' },
    create: {
      key: 'world_model_snapshot',
      value: JSON.stringify(stats),
    },
    update: { value: JSON.stringify(stats) },
  })
  console.log('  ✓ WorldState captured')
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  SOTA Agentic OS — Demo Bootstrap                        ║')
  console.log('║  Use Case: Customer Support Automation                   ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  await ensureAdminUser()
  await bootstrapAgentMesh()
  await createRedLines()
  await createLTLRules()
  await createAxioms()
  await seedKnowledgeBase()
  await captureInitialWorldState()

  console.log('\n✅ Bootstrap completo!')
  console.log('\n📋 Prossimi passi:')
  console.log('   1. Avvia il dev server: bun run dev')
  console.log('   2. Vai su http://localhost:3000')
  console.log('   3. Login: admin@sota-os.local / admin123')
  console.log('   4. Visita la demo page: http://localhost:3000/demo')
  console.log('\n🎯 Cosa puoi fare ora:')
  console.log('   • Dashboard: overview KPI del sistema')
  console.log('   • Runs: crea un piano di supporto clienti')
  console.log('   • Console: interagisci con l\'LLM per risolvere ticket')
  console.log('   • Memory: esplora la knowledge base')
  console.log('   • Agents: visualizza il mesh gerarchico')
  console.log('   • Governance: verifica red lines e LTL rules')
  console.log('   • Insights: monitora cost, errors, affect')
}

main()
  .catch((err) => {
    console.error('❌ Bootstrap failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
