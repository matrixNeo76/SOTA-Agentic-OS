'use client'

/**
 * Demo Page — Customer Support Automation Use Case
 *
 * Pagina demo concreta che guida l'utente attraverso un caso d'uso reale:
 * azienda SaaS "Acme Cloud" che automatizza il supporto clienti.
 *
 * Mostra come utilizzare tutti i 6 moduli CORE di SOTA Agentic OS.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Play, Brain, Database, Users, ShieldCheck, TrendingUp,
  CheckCircle2, AlertTriangle, ArrowRight, Zap, RefreshCw,
  Terminal, GitBranch, DollarSign,
} from 'lucide-react'

interface DemoScenario {
  id: string
  title: string
  description: string
  module: string
  icon: typeof Play
  steps: string[]
  cta: { label: string; view: string }
}

const SCENARIOS: DemoScenario[] = [
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    description: 'Visualizza KPI aggregati: agenti attivi, ticket, cost, error rate',
    module: 'Dashboard',
    icon: TrendingUp,
    steps: [
      'Vedi 8 KPI cards con metriche live',
      'Controlla cost oggi vs budget',
      'Verifica error rate e anomalies',
    ],
    cta: { label: 'Apri Dashboard', view: 'dashboard' },
  },
  {
    id: 'console',
    title: 'Risolvi Ticket con LLM',
    description: 'Interagisci con l\'LLM per risolvere un ticket reale',
    module: 'Console',
    icon: Terminal,
    steps: [
      'Apri la Console',
      'Inserisci: "Customer reports 429 errors on API. Plan: Pro"',
      'LLM pianifica, usa tools, redige risposta',
      'Governance gate verifica red lines',
    ],
    cta: { label: 'Apri Console', view: 'runs' },
  },
  {
    id: 'runs',
    title: 'Workflow Supporto',
    description: 'Crea un piano multi-agente per gestire ticket',
    module: 'Runs',
    icon: Play,
    steps: [
      'Crea piano: "Process 10 pending tickets"',
      'Orchestrator → Triage → Billing/Technical',
      'QA review prima di inviare',
      'HITL gates su azioni sensibili',
    ],
    cta: { label: 'Apri Runs', view: 'runs' },
  },
  {
    id: 'memory',
    title: 'Knowledge Base',
    description: 'Esplora KB con policy, FAQ, guide tecniche',
    module: 'Memory',
    icon: Database,
    steps: [
      '5 KB entries: refund policy, rate limit, triage',
      'Search semantica su contenuti',
      'Graph: agent → KB entry → source',
    ],
    cta: { label: 'Apri Memory', view: 'memory' },
  },
  {
    id: 'agents',
    title: 'Agent Mesh',
    description: 'Visualizza 5 agenti e relazioni gerarchiche',
    module: 'Agents',
    icon: Users,
    steps: [
      'Mesh: Orchestrator → Triage → Specialists',
      'QA Reviewer supervisiona risposte',
      'Metrics: task count, success rate, cost',
    ],
    cta: { label: 'Apri Agents', view: 'agents' },
  },
  {
    id: 'governance',
    title: 'Trust & Governance',
    description: 'Red lines, LTL rules, audit trail',
    module: 'Governance',
    icon: ShieldCheck,
    steps: [
      '3 Red Lines: refund, PII, escalation',
      '3 LTL Rules: SLA, approval, QA',
      '5 Axioms: GDPR, SLA, tone, audit',
      'Audit Ledger delle azioni admin',
    ],
    cta: { label: 'Apri Governance', view: 'governance' },
  },
  {
    id: 'insights',
    title: 'Insights & Cost',
    description: 'Cost tracking, evaluation, errors, affect',
    module: 'Insights',
    icon: DollarSign,
    steps: [
      'Cost: total, today, by agent/model/phase',
      'Budget: warn $1/day, danger $5/day',
      'Observability: errors + traces',
      'Affect: desperation/frustration',
    ],
    cta: { label: 'Apri Insights', view: 'insights' },
  },
]

export default function DemoPage() {
  const router = useRouter()
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    checkBootstrap()
  }, [])

  async function checkBootstrap() {
    setChecking(true)
    try {
      const r = await fetch('/api/agent-mesh').catch(() => null)
      if (!r || !r.ok) {
        setBootstrapped(false)
        return
      }
      const data = await r.json()
      const agentCount = data?.stats?.totalAgents ?? 0
      setBootstrapped(agentCount >= 5)
    } catch {
      setBootstrapped(false)
    } finally {
      setChecking(false)
    }
  }

  function navigateTo(view: string) {
    router.push(`/?view=${view}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Zap className="w-4 h-4" />
            SOTA Agentic OS — Demo Live
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Customer Support Automation
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Caso d'uso reale: azienda SaaS <strong>Acme Cloud</strong> che automatizza
            il supporto clienti con 5 agenti AI governati da red lines, LTL rules e audit trail.
          </p>
        </div>

        {/* Bootstrap Status */}
        {checking ? (
          <Card>
            <CardContent className="p-6 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              <span>Verificando stato bootstrap...</span>
            </CardContent>
          </Card>
        ) : bootstrapped ? (
          <Card className="border-status-ok/30 bg-status-ok/5">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-status-ok" />
              <div className="flex-1">
                <div className="font-medium text-status-ok">Sistema pronto</div>
                <div className="text-xs text-muted-foreground">
                  5 agenti, 3 red lines, 3 LTL rules, 5 axioms, 5 KB entries configurati
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={checkBootstrap} aria-label="Re-check bootstrap status">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-status-warn/30 bg-status-warn/5">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-status-warn" />
              <div className="flex-1">
                <div className="font-medium text-status-warn">Bootstrap richiesto</div>
                <div className="text-xs text-muted-foreground">
                  Esegui nel terminale: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">npx tsx scripts/bootstrap-demo.ts</code>
                </div>
              </div>
              <Button size="sm" onClick={checkBootstrap}>
                <RefreshCw className="w-4 h-4 mr-1" /> Re-check
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Quick Start */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Quick Start: Risolvi un Ticket
            </CardTitle>
            <CardDescription>
              Prova subito — interagisci con l'LLM come fosse un customer ticket
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-2">
              <div className="text-muted-foreground"># Esempi di ticket reali da incollare nella Console:</div>
              <div className="text-foreground">
                <span className="text-status-info">customer:</span> "I'm getting 429 errors on your API.
                My company is Acme Corp, plan Pro. Need this fixed ASAP!"
              </div>
              <div className="text-foreground">
                <span className="text-status-info">customer:</span> "I was charged twice for my Pro subscription
                this month. Invoice #INV-2024-8829. Want a refund."
              </div>
              <div className="text-foreground">
                <span className="text-status-info">customer:</span> "Webhook not firing after last update.
                Checked docs but can't figure it out."
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => navigateTo('runs')} className="flex-1">
                <Terminal className="w-4 h-4 mr-2" />
                Apri Console e prova
              </Button>
              <Button variant="outline" onClick={() => navigateTo('dashboard')}>
                <TrendingUp className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Scenarios Grid */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Esplora tutti i moduli</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SCENARIOS.map((scenario) => {
              const Icon = scenario.icon
              return (
                <Card key={scenario.id} className="hover:border-primary/30 transition-colors">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base">{scenario.title}</CardTitle>
                        <Badge variant="outline" className="text-[10px] mt-1">{scenario.module}</Badge>
                      </div>
                    </div>
                    <CardDescription className="mt-2">{scenario.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="text-xs space-y-1.5">
                      {scenario.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary font-mono text-[10px] mt-0.5">{i + 1}.</span>
                          <span className="text-muted-foreground">{step}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigateTo(scenario.cta.view)}
                    >
                      {scenario.cta.label}
                      <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Architecture Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="w-5 h-5" />
              Architettura del Caso d'Uso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              {/* Agent Mesh Visualization */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-primary">Orchestrator</Badge>
                  <span className="text-muted-foreground text-xs">executive</span>
                </div>
                <div className="text-muted-foreground text-xs">↓ supervises</div>
                <div className="flex gap-4">
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="secondary">Triage</Badge>
                    <span className="text-[10px] text-muted-foreground">strategic</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="secondary">QA Reviewer</Badge>
                    <span className="text-[10px] text-muted-foreground">strategic</span>
                  </div>
                </div>
                <div className="text-muted-foreground text-xs">↓ delegates to</div>
                <div className="flex gap-4">
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="outline">Billing</Badge>
                    <span className="text-[10px] text-muted-foreground">operational</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="outline">Technical</Badge>
                    <span className="text-[10px] text-muted-foreground">operational</span>
                  </div>
                </div>
              </div>

              {/* Governance Layer */}
              <div className="border-t pt-4">
                <div className="text-xs font-medium text-muted-foreground mb-2">GOVERNANCE LAYER</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="destructive" className="text-[10px]">Red Line: no refund &gt;$500</Badge>
                  <Badge variant="destructive" className="text-[10px]">Red Line: no PII leak</Badge>
                  <Badge variant="warning" className="text-[10px]">LTL: SLA 24h</Badge>
                  <Badge variant="warning" className="text-[10px]">LTL: refund→approval</Badge>
                  <Badge variant="secondary" className="text-[10px]">Axiom: GDPR</Badge>
                  <Badge variant="secondary" className="text-[10px]">Axiom: audit trail</Badge>
                </div>
              </div>

              {/* Data Flow */}
              <div className="border-t pt-4">
                <div className="text-xs font-medium text-muted-foreground mb-2">DATA FLOW</div>
                <div className="text-xs space-y-1 font-mono">
                  <div>Customer Ticket → Console → LLM (zai-glm)</div>
                  <div>→ Taint Input (governance hook)</div>
                  <div>→ Plan Generation (orchestrator)</div>
                  <div>→ Tool Calls [pre-execute gate: taint+LTL+red lines]</div>
                  <div>→ Response Draft → QA Review (LTL check)</div>
                  <div>→ Send Response → Cost Entry → Affect Update</div>
                  <div>→ Audit Ledger Entry</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Login Info */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">Credenziali Admin</div>
              <div className="text-muted-foreground text-xs font-mono">
                admin@sota-os.local / admin123
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => router.push('/login')}>
              Login
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
