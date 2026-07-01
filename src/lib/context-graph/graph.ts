/**
 * Context Graph — Fase 1.2 (refactor Fase 1.1)
 *
 * Questo modulo è ora un re-export di `@/lib/graph-age.ts`.
 * Il motivo: graph-age.ts espone la stessa API ma instrada dinamicamente
 * su Apache AGE (Cypher nativo) quando disponibile, con fallback
 * al path relazionale Prisma (SQLite o Postgres senza AGE).
 *
 * Tutti i consumer esistenti (graphrag, API routes, ecc.) continuano
 * a funzionare senza modifiche e ottengono automaticamente il path
 * AGE in produzione.
 *
 * Fase 1.1 — vedi src/lib/graph-age.ts per l'implementazione.
 */

export {
  createNode,
  createEdge,
  getNode,
  getNeighbors,
  traverse,
  updateNodeLifecycle,
  queryNodes,
  graphStats,
  cypherQuery,
  type GraphNodeRecord,
  type GraphEdgeRecord,
} from '@/lib/graph-age'
