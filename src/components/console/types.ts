export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked'
export type ErrorDetail = { type: string; message: string; phase: string; recoverable: boolean; suggestion?: string }
export type ExecStep = { taskId: string; agentId: string; description: string; status: StepStatus; strategy?: string; ltlVerdict?: string; ltlViolations?: string[]; result?: string; error?: ErrorDetail; durationMs?: number }
export type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp: string; result?: { goal: string; steps: ExecStep[]; batches: string[][]; reflection?: { approved: boolean; heuristic?: string; reviewReason?: string; error?: string }; summary: { totalTasks: number; completed: number; failed: number; blocked: number; durationMs: number }; errors?: ErrorDetail[] }; isPlanOnly?: boolean; error?: string; errors?: ErrorDetail[] }
let idCounter = 0
export function genMessageId() { idCounter++; return `msg-${Date.now()}-${idCounter}` }
export const STEP_ICONS = { pending: { color: 'text-muted-foreground' }, running: { color: 'text-status-info' }, done: { color: 'text-status-ok' }, failed: { color: 'text-status-danger' }, blocked: { color: 'text-status-warn' } } as const
export const SUGGESTIONS = [
  { icon: 'brain', title: 'Analizza e reportizza', desc: 'Analizza le metriche di vendita Q3 e produci un report esecutivo' },
  { icon: 'shield', title: 'Verifica conformità', desc: 'Verifica la conformità di sicurezza del modulo di autenticazione' },
  { icon: 'zap', title: 'Ottimizza processo', desc: 'Ottimizza il processo di deploy del microservizio auth' },
  { icon: 'terminal', title: 'Piano di test', desc: 'Crea un piano di test per la nuova API REST' },
] as const
export type Skill = { id: string; name: string; description: string; category: string; promptTemplate: string; outputFormat: string; usageCount: number }
