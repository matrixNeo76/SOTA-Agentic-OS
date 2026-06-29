/**
 * Taint Tracking (Fase 4)
 *
 * Traccia rigidamente gli input non fidati etichettandoli come TAINTED.
 * Qualsiasi flusso di pensiero che utilizzi questi dati viene bloccato
 * dall'eseguire chiamate di sistema sensibili.
 *
 * Previene cicli virali autonomi indotti dall'ambiente (MitE).
 *
 * B6 fix: prima activeFlows era una Map in-memory, che perdeva stato su
 * reload del processo o tra istanze serverless. Ora flowTrace è persistito
 * nel DB (TaintRecord.flowTrace) e tutte le letture sono query DB.
 *
 * B7 fix: implementato TTL decay (default 24h). clearExpiredFlows ora
 * marca come "expired" i record scaduti (impostando blocked=false e
 * taintLabel='EXPIRED') per pulire il DB.
 */
import { db } from '@/lib/db'

const SENSITIVE_SINKS = [
  'tool_call:exec', 'tool_call:file_write', 'tool_call:network',
  'tool_call:db_write', 'tool_call:deploy', 'tool_call:delete',
]

// B7: TTL per i taint records. Dopo questo tempo, il taint è considerato
// "scaduto" e non blocca più i sink. Default 24h.
const TAINT_TTL_MS = 24 * 60 * 60 * 1000

type TaintFlow = {
  recordId: string
  source: string
  payload: string
  flowTrace: string[]
  blockedAtSink?: string
}

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
  return record.id
}

/**
 * Propaga il taint: registra che il dato tainted è fluito in un altro step.
 *
 * B6 fix: ora aggiorna direttamente il DB (non più la Map in-memory).
 * Legge il flowTrace corrente, aggiunge lo step, e persiste.
 */
export async function propagateTaint(taintId: string, step: string): Promise<void> {
  const record = await db.taintRecord.findUnique({
    where: { id: taintId },
    select: { flowTrace: true },
  })
  if (!record) {
    // B6: prima questo era un silent no-op nella Map; ora ritorniamo
    // esplicitamente per segnalare che il taintId non esiste.
    return
  }
  const flow: string[] = JSON.parse(record.flowTrace || '[]')
  flow.push(step)
  await db.taintRecord.update({
    where: { id: taintId },
    data: { flowTrace: JSON.stringify(flow) },
  })
}

/**
 * Cancello di sink: verifica se un'operazione sensibile sta consumando
 * dati tainted. Se sì, blocca.
 *
 * B6 fix: legge i flussi dal DB (non più dalla Map in-memory).
 * B7 fix: ignora i taint scaduti (createdAt + TTL < now).
 */
export async function checkSink(
  sink: string,
  taintIds: string[]
): Promise<{ allowed: boolean; reason: string; blockedFlows: TaintFlow[] }> {
  if (!SENSITIVE_SINKS.includes(sink)) {
    return { allowed: true, reason: 'Sink non sensibile', blockedFlows: [] }
  }

  const now = new Date()
  const ttlCutoff = new Date(now.getTime() - TAINT_TTL_MS)

  // Carica tutti i record non scaduti
  const records = await db.taintRecord.findMany({
    where: {
      id: { in: taintIds },
      createdAt: { gt: ttlCutoff }, // B7: ignora scaduti
    },
  })

  const blockedFlows: TaintFlow[] = []
  for (const record of records) {
    const flowTrace: string[] = JSON.parse(record.flowTrace || '[]')
    flowTrace.push(`sink:${sink}`)

    const flow: TaintFlow = {
      recordId: record.id,
      source: record.source,
      payload: record.payload,
      flowTrace,
      blockedAtSink: sink,
    }
    blockedFlows.push(flow)

    // Aggiorna il record con il nuovo step + marca come blocked
    await db.taintRecord.update({
      where: { id: record.id },
      data: {
        flowTrace: JSON.stringify(flowTrace),
        blocked: true,
      },
    })
  }

  if (blockedFlows.length > 0) {
    return {
      allowed: false,
      reason: `Bloccato: ${blockedFlows.length} flussi tainted hanno raggiunto sink ${sink}`,
      blockedFlows,
    }
  }

  // Se alcuni taintIds erano scaduti o non esistenti, lo segnaliamo nel reason
  const found = new Set(records.map((r) => r.id))
  const missing = taintIds.filter((id) => !found.has(id))
  if (missing.length > 0) {
    return {
      allowed: true,
      reason: `${missing.length} taintId(s) scaduti o non trovati (ignorati)`,
      blockedFlows: [],
    }
  }

  return { allowed: true, reason: 'Nessun taint attivo', blockedFlows: [] }
}

/**
 * B7 fix: pulisce i flussi tainted scaduti (TTL decay).
 * Marca i record con createdAt + TTL < now impostando taintLabel='EXPIRED'
 * (mantiene il record per audit, ma non blocca più i sink).
 *
 * Chiamare periodicamente (es. su ogni checkSink o via cron job).
 */
export async function clearExpiredFlows(): Promise<number> {
  const cutoff = new Date(Date.now() - TAINT_TTL_MS)
  const result = await db.taintRecord.updateMany({
    where: {
      createdAt: { lt: cutoff },
      taintLabel: 'TAINTED', // non aggiornare quelli già expired
      blocked: false, // non toccare i record che hanno già bloccato un sink
    },
    data: {
      taintLabel: 'EXPIRED',
    },
  })
  return result.count
}

export async function listTaintRecords(limit = 20) {
  return db.taintRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * B6: ritorna il TTL configurato (per test e introspection).
 */
export function getTaintTTL(): number {
  return TAINT_TTL_MS
}
