import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Wrench, ArrowDownCircle } from 'lucide-react'

export type BlockedAction = {
  id: string; agentId: string; action: string; source: string
  axiomTrail: string; readableExplanation: string; status: string
  resolution?: string; resolvedBy?: string; createdAt: string; resolvedAt?: string
}

export const SOURCE_STYLE: Record<string, { color: string; bg: string; icon: typeof ShieldAlert; label: string }> = {
  ltl: { color: 'text-status-danger', bg: 'bg-status-danger/10 border-status-danger/30', icon: ShieldAlert, label: 'LTL Violation' },
  taint: { color: 'text-status-warn', bg: 'bg-status-warn/10 border-status-warn/30', icon: AlertTriangle, label: 'Taint Tracking' },
  normative: { color: 'text-cat-cognitive', bg: 'bg-cat-cognitive/10 border-cat-cognitive/30', icon: ShieldAlert, label: 'Normative Calculus' },
  hitl_gate: { color: 'text-cat-governance', bg: 'bg-cat-governance/10 border-cat-governance/30', icon: AlertTriangle, label: 'HITL Gate' },
}

export const STATUS_STYLE: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
  pending: { color: 'text-status-warn', bg: 'bg-status-warn/10', icon: AlertTriangle, label: 'In attesa' },
  approved: { color: 'text-status-ok', bg: 'bg-status-ok/10', icon: CheckCircle2, label: 'Approvata' },
  rejected: { color: 'text-status-danger', bg: 'bg-status-danger/10', icon: XCircle, label: 'Rifiutata' },
  modified: { color: 'text-status-info', bg: 'bg-status-info/10', icon: Wrench, label: 'Modificata' },
  downgraded: { color: 'text-muted-foreground', bg: 'bg-muted/30', icon: ArrowDownCircle, label: 'Declassata' },
}

export function getSourceStyle(source: string) { return SOURCE_STYLE[source] || SOURCE_STYLE.ltl }
export function getStatusStyle(status: string) { return STATUS_STYLE[status] || STATUS_STYLE.pending }
export type ResolutionChoice = 'approved' | 'modified' | 'downgraded' | 'rejected'
export const RESOLUTION_LABELS: Record<ResolutionChoice, string> = { approved: 'Approva (assumi responsabilità)', modified: 'Modifica parametri', downgraded: 'Declassa task', rejected: 'Rifiuta' }
