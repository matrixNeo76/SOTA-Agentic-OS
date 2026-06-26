/**
 * GET /api/admin/settings — Read current system configuration
 * POST /api/admin/settings — Update configuration (writable settings only)
 *
 * C6 — Admin settings scrivibili (SystemSetting table + runtime override).
 *
 * GET now returns TWO blocks:
 *   - `settings`: array of writable/read-only setting rows from the store
 *                 (DB > env > default, with `source` badge)
 *   - `live`: live runtime status (DB provider, LLM health, mesh, integration,
 *             embedding provider) — same shape as before C6, kept for the UI.
 *
 * POST accepts `{ updates: { key: value, ... } }` and writes each writable key
 * through the store. Read-only keys are reported in `rejected`. The cache is
 * updated eagerly so subsequent reads see the new value without restart.
 */

import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getProvider, hasPgvector, hasAge } from '@/lib/db-runtime'
import { llmHealthCheck } from '@/lib/llm-client/client'
import { eventMeshHealth } from '@/lib/event-mesh/mesh'
import { integrationLayerStatus } from '@/lib/integration/bridges'
import {
  getAllSettings,
  setSetting,
  reloadCache,
  SETTING_DEFS,
  type SettingValue,
} from '@/lib/settings'

// === GET =============================================================

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const [provider, pgvector, age, llmHealth, meshHealth, integration, settings] = await Promise.all([
    getProvider(),
    hasPgvector(),
    hasAge(),
    llmHealthCheck().catch(() => ({ available: false, model: 'unknown' })),
    eventMeshHealth(),
    Promise.resolve(integrationLayerStatus()),
    getAllSettings(),
  ])

  const { getProviderInfo } = await import('@/lib/embedding-provider')
  const embeddingInfo = await getProviderInfo()

  // Group settings by category for UI convenience.
  const byCategory = groupByCategory(settings)

  return NextResponse.json({
    settings,
    byCategory,
    live: {
      database: {
        provider,
        url: process.env.DATABASE_URL || '(default SQLite)',
        extensions: { pgvector, age },
      },
      llm: {
        available: llmHealth.available,
        model: llmHealth.model || 'zai-glm',
        latencyMs: (llmHealth as any).latencyMs,
        apiKeyConfigured: Boolean(process.env.ZAI_API_KEY),
      },
      embedding: embeddingInfo,
      eventMesh: meshHealth,
      observability: {
        langfuseEnabled: Boolean(process.env.LANGFUSE_URL),
        langfuseUrl: process.env.LANGFUSE_URL || null,
      },
      integration: {
        started: integration.started,
        activeSubscriptions: integration.activeSubscriptions,
      },
      toolPaths: {
        read:
          process.env.TOOL_ALLOWED_READ_PATHS?.split(',') ||
          ['/tmp', join(process.cwd(), 'src')],
        write:
          process.env.TOOL_ALLOWED_WRITE_PATHS?.split(',') ||
          ['/tmp', join(process.cwd(), 'upload')],
      },
      mcpExternalServers: process.env.MCP_EXTERNAL_SERVERS || null,
    },
    schemaVersion: 1,
  })
}

// === POST ============================================================

interface PostBody {
  updates?: Record<string, string>
  reload?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Optional: just reload the cache from DB (e.g. after manual DB edits).
  if (body.reload && !body.updates) {
    await reloadCache()
    return NextResponse.json({ reloaded: true })
  }

  if (!body.updates || typeof body.updates !== 'object') {
    return NextResponse.json(
      { error: 'Missing `updates` map (and not a reload request)' },
      { status: 400 },
    )
  }

  const updatedBy = auth.userId
  const applied: Array<{
    key: string
    previousValue: string | undefined
    newValue: string
    source: string
  }> = []
  const rejected: Array<{ key: string; reason: string }> = []

  for (const [key, value] of Object.entries(body.updates)) {
    if (typeof value !== 'string') {
      rejected.push({ key, reason: 'Value must be a string' })
      continue
    }
    const result = await setSetting(key, value, updatedBy)
    if (result.set) {
      applied.push({
        key,
        previousValue: result.previousValue,
        newValue: result.newValue ?? value,
        source: result.source ?? 'db',
      })
    } else {
      rejected.push({ key, reason: result.reason ?? 'Unknown error' })
    }
  }

  return NextResponse.json({
    updated: applied.length > 0,
    applied,
    rejected,
    writableKeys: SETTING_DEFS.filter((s) => !s.readOnly).map((s) => s.key),
    requiresRestart: rejected
      .filter((r) => r.reason.includes('read-only'))
      .map((r) => r.key),
  })
}

// === Helpers =========================================================

function groupByCategory(settings: SettingValue[]): Record<string, SettingValue[]> {
  const out: Record<string, SettingValue[]> = {}
  for (const s of settings) {
    if (!out[s.category]) out[s.category] = []
    out[s.category].push(s)
  }
  return out
}
