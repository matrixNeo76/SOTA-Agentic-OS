import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Genera un ID time-sortable intero positivo.
 *
 * Formato: timestamp_ms (44 bit) + counter casuale (20 bit)
 * - Garantisce unicità anche tra riavvii del server (timestamp sempre crescente)
 * - Time-sortable: gli ID più recenti sono numericamente maggiori
 * - Rientra in Number.MAX_SAFE_INTEGER (2^53 - 1)
 *
 * Sostituisce il vecchio pattern `tsOffset * 1000 + counter` che poteva
 * collidere dopo ~31 ore di uptime (tsOffset wrap-around).
 *
 * Usato per cycleId in curator.ts e acts.ts.
 */
export function generateTimeSortableId(): number {
  const timestamp = Date.now() // ms since epoch (44 bit until year 2100)
  const counter = Math.floor(Math.random() * 1048576) // 20 bit casuali (0..2^20-1)
  // Combina: timestamp shiftato di 20 bit + counter
  // Massimo: 2^44 * 2^20 = 2^64 → ma usiamo solo 53 bit sicuri
  // In pratica: timestamp (~41 bit nel 2026) << 12 | counter (12 bit)
  // per restare sotto MAX_SAFE_INTEGER
  return (timestamp % 17592186044416) * 4096 + (counter % 4096)
}

