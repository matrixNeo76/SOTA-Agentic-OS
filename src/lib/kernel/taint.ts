/**
 * Taint Tracking (Fase 4)
 *
 * Traccia rigidamente gli input non fidati etichettandoli come TAINTED.
 * Qualsiasi flusso di pensiero che utilizzi questi dati viene bloccato
 * dall'eseguire chiamate di sistema sensibili.
 *
 * Previene cicli virali autonomi indotti dall'ambiente (MitE).
 */
import { db } from '@/lib/db'

const SENSITIVE_SINKS = [
  'tool_call:exec', 'tool_call:file_write', 'tool_call:network',
  'tool_call:db_write', 'tool_call:deploy', 'tool_call:delete',
]

type TaintFlow = {
  recordId: string
  source: string
  payload: string
  flowTrace: string[]
  blockedAtSink?: string
}

const activeFlows: Map<string, TaintFlow> = new Map()

/**
 * Marca un input come tainted. Restituisce un taintId.
 */
export async function taintInput(source: string, payload: string): Promise<string> {
  const record = await db.taintRecord.create({
    data: {
      source,
      payload,
      taintLabel: 'TAINTED',
      flowTrace: JSON.stringify([`input:${source}`]),
      blocked: false,
    },
  })
  const flow: TaintFlow = {
    recordId: record.id,
    source,
    payload,
    flowTrace: [`input:${source}`],
  }
  activeFlows.set(record.id, flow)
  return record.id
}

/**
 * Propaga il taint: registra che il dato tainted è fluito in un altro step.
 */
export function propagateTaint(taintId: string, step: string): void {
  const flow = activeFlows.get(taintId)
  if (flow) {
    flow.flowTrace.push(step)
  }
}

/**
 * Cancello di sink: verifica se un'operazione sensibile sta consumando
 * dati tainted. Se sì, blocca.
 */
export async function checkSink(
  sink: string,
  taintIds: string[]
): Promise<{ allowed: boolean; reason: string; blockedFlows: TaintFlow[] }> {
  if (!SENSITIVE_SINKS.includes(sink)) {
    return { allowed: true, reason: 'Sink non sensibile', blockedFlows: [] }
  }
  const blockedFlows: TaintFlow[] = []
  for (const id of taintIds) {
    const flow = activeFlows.get(id)
    if (flow) {
      flow.flowTrace.push(`sink:${sink}`)
      flow.blockedAtSink = sink
      blockedFlows.push(flow)
      await db.taintRecord.update({
        where: { id },
        data: {
          flowTrace: JSON.stringify(flow.flowTrace),
          blocked: true,
        },
      })
    }
  }
  if (blockedFlows.length > 0) {
    return {
      allowed: false,
      reason: `Bloccato: ${blockedFlows.length} flussi tainted hanno raggiunto sink ${sink}`,
      blockedFlows,
    }
  }
  return { allowed: true, reason: 'Nessun taint attivo', blockedFlows: [] }
}

/**
 * Pulisce i flussi tainted scaduti (decay).
 */
export function clearExpiredFlows(): void {
  // In una implementazione reale, scadenza basata su TTL.
  // Qui manteniamo tutti i flussi attivi per la sessione.
}

export async function listTaintRecords(limit = 20) {
  return db.taintRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
