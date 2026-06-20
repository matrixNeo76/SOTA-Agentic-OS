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
  // Time-sortable ID che fit in SQLite Int (max 2^31-1 = 2,147,483,647)
  // Usa minuti dal 2024-01-01 + counter casuale a 2 cifre
  // minutesSince2024 * 100 + counter → max ~214M nel 2025 (fit in INT fino al 2026)
  const minutesSince2024 = Math.floor((Date.now() - 1704067200000) / 60000)
  const counter = Math.floor(Math.random() * 100)
  return minutesSince2024 * 100 + counter
}

