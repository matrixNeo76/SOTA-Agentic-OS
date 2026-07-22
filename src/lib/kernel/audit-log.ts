/**
 * Audit Log — Track 6.3
 *
 * Registra azioni privilegiate in modo immutabile per compliance SOC2/GDPR.
 * Ogni entry ha un hash chain (SHA-256 del record precedente) per garantire immutabilità.
 *
 * Azioni auditate:
 * - sovereign_resolve (approve/reject/modify/downgrade blocked action)
 * - tool_revoke (revoke tool)
 * - tool_install (install tool)
 * - budget_change (update budget thresholds)
 * - user_invite (invite user to org)
 * - user_remove (remove user from org)
 * - user_role_change (change user role)
 * - org_update (update org settings)
 * - preset_apply (apply sector preset)
 * - backup_create (manual backup)
 * - data_export (GDPR data export)
 * - data_delete (GDPR data deletion)
 */
import { db } from '@/lib/db'
import { createHash } from 'crypto'

export type AuditAction =
  | 'sovereign_resolve'
  | 'tool_revoke'
  | 'tool_install'
  | 'budget_change'
  | 'user_invite'
  | 'user_remove'
  | 'user_role_change'
  | 'org_update'
  | 'preset_apply'
  | 'backup_create'
  | 'data_export'
  | 'data_delete'
  | 'workspace_create'
  | 'workspace_delete'

export type AuditEntry = {
  action: AuditAction
  actorId: string
  organizationId: string
  targetType?: string
  targetId?: string
  description: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/**
 * Record an audit entry with hash chain for immutability.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    // Get the last audit entry for this org to build hash chain
    const lastEntry = await db.auditLedgerEntry.findFirst({
      where: { organizationId: entry.organizationId },
      orderBy: { createdAt: 'desc' },
    })

    const prevHash = lastEntry?.hashChain || 'genesis'
    const timestamp = new Date().toISOString()

    // Build the data to hash
    const dataToHash = JSON.stringify({
      prevHash,
      action: entry.action,
      actorId: entry.actorId,
      organizationId: entry.organizationId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      description: entry.description,
      timestamp,
    })

    const hash = createHash('sha256').update(dataToHash).digest('hex')

    await db.auditLedgerEntry.create({
      data: {
        agentId: entry.actorId,        // reuse agentId field for actor
        action: entry.action,
        targetType: entry.targetType || 'system',
        targetId: entry.targetId || '',
        description: entry.description,
        readableNarrative: entry.description,
        level: 'info',
        hashChain: hash,
        prevHash,
        organizationId: entry.organizationId,
      },
    })
  } catch (e) {
    // Audit logging is best-effort — don't block the operation
    console.error('[audit] Failed to record:', e)
  }
}

/**
 * Get audit log for an organization.
 */
export async function getAuditLog(
  organizationId: string,
  options: { limit?: number; action?: string; actorId?: string } = {}
) {
  const { limit = 50, action, actorId } = options

  return db.auditLedgerEntry.findMany({
    where: {
      organizationId,
      ...(action && { action }),
      ...(actorId && { agentId: actorId }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      agentId: true,
      targetType: true,
      targetId: true,
      description: true,
      hashChain: true,
      prevHash: true,
      createdAt: true,
    },
  })
}

/**
 * Verify audit log integrity by checking the hash chain.
 */
export async function verifyAuditIntegrity(organizationId: string): Promise<{
  valid: boolean
  brokenAt?: string
  totalEntries: number
}> {
  const entries = await db.auditLedgerEntry.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, hashChain: true, prevHash: true, action: true, agentId: true, description: true, createdAt: true },
  })

  let prevHash = 'genesis'
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry.id, totalEntries: entries.length }
    }
    prevHash = entry.hashChain
  }

  return { valid: true, totalEntries: entries.length }
}
