/**
 * Zod validation schemas per API routes — Fase Gamma γ1
 *
 * Schema centralizzati per validazione input.
 * Pattern: const parsed = loginSchema.parse(body) → throws ZodError on invalid
 */
import { z } from 'zod'

// === Auth ===
export const loginSchema = z.object({
  action: z.literal('login'),
  email: z.string().email(),
  password: z.string().min(1),
})

export const logoutSchema = z.object({
  action: z.literal('logout'),
})

// === Console ===
export const consoleTaskSchema = z.object({
  task: z.string().min(1).max(5000),
  mode: z.enum(['full', 'plan-only']).optional().default('full'),
})

// === Plan ===
export const planSchema = z.object({
  mode: z.enum(['generate', 'list', 'get', 'delete']).optional(),
  goal: z.string().min(1).max(2000).optional(),
  planId: z.string().optional(),
})

// === Memory ===
export const memorySchema = z.object({
  action: z.enum(['episode', 'entity', 'rule', 'transaction', 'list', 'delete']).optional(),
  observation: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  ruleId: z.string().optional(),
  id: z.string().optional(),
})

// === Verify (LTL) ===
export const verifySchema = z.object({
  action: z.enum(['create_rule', 'list_rules', 'verify_event', 'delete_rule', 'fsm_state']).optional(),
  ruleId: z.string().optional(),
  formula: z.string().optional(),
  stateLabel: z.string().optional(),
  eventType: z.string().optional(),
  payload: z.string().optional(),
})

// === Tools ===
export const toolInstallSchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  publisher: z.string().optional(),
  installedBy: z.string().optional(),
  defaultPermissions: z.array(z.string()).optional(),
})

// === Skills ===
export const skillCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  promptTemplate: z.string().min(1),
  category: z.string().optional(),
  outputFormat: z.enum(['text', 'json', 'markdown']).optional(),
  isPublic: z.boolean().optional(),
})

export const skillExecuteSchema = z.object({
  skillId: z.string().min(1),
  variables: z.record(z.string(), z.string()).optional(),
})

// === MCP Client ===
export const mcpRegisterSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().url(),
  protocol: z.enum(['jsonrpc', 'http', 'sse']).optional(),
  authType: z.enum(['none', 'bearer', 'basic', 'ecdsa']).optional(),
  authToken: z.string().optional(),
  publisherFingerprint: z.string().optional(),
})

export const mcpExecuteSchema = z.object({
  connectionId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
})

// === Blocked Actions ===
export const blockedResolveSchema = z.object({
  action: z.literal('resolve'),
  blockedId: z.string().min(1),
  choice: z.enum(['approved', 'modified', 'downgraded', 'rejected']),
  resolvedBy: z.string().optional(),
  resolutionDetails: z.record(z.string(), z.unknown()).optional(),
})

// === Cost ===
export const costBudgetSchema = z.object({
  action: z.literal('set_budget'),
  warn: z.number().positive(),
  danger: z.number().positive(),
})

// === Generic action wrapper ===
export const actionSchema = z.object({
  action: z.string(),
}).passthrough()

// === Helper: safe parse with error response ===
export function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const firstError = result.error.issues[0]
  return { success: false, error: firstError ? `${firstError.path.join('.')}: ${firstError.message}` : 'Validation error' }
}
