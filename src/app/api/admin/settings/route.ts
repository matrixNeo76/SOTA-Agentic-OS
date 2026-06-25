/**
 * GET /api/admin/settings — Read current system configuration
 * POST /api/admin/settings — Update configuration (writeable settings only)
 *
 * WS2.1 — Settings generali: DATABASE_URL (read-only), LLM provider,
 * event-mesh backend, Langfuse on/off, tool path restrictions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getProvider, hasPgvector, hasAge } from '@/lib/db-runtime'
import { llmHealthCheck } from '@/lib/llm-client/client'
import { eventMeshHealth } from '@/lib/event-mesh/mesh'
import { integrationLayerStatus } from '@/lib/integration/bridges'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const [provider, pgvector, age, llmHealth, meshHealth, integration] = await Promise.all([
    getProvider(),
    hasPgvector(),
    hasAge(),
    llmHealthCheck().catch(() => ({ available: false, model: 'unknown' })),
    eventMeshHealth(),
    Promise.resolve(integrationLayerStatus()),
  ])

  const { getProviderInfo } = await import('@/lib/embedding-provider')
  const embeddingInfo = await getProviderInfo()

  return NextResponse.json({
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
      read: process.env.TOOL_ALLOWED_READ_PATHS?.split(',') || ['/tmp', join(process.cwd(), 'src')],
      write: process.env.TOOL_ALLOWED_WRITE_PATHS?.split(',') || ['/tmp', join(process.cwd(), 'upload')],
    },
    mcpExternalServers: process.env.MCP_EXTERNAL_SERVERS || null,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  // In production: write settings to a config table or .env file.
  // For now, we return what's writeable and what requires restart.
  const body = await req.json()

  return NextResponse.json({
    updated: false,
    message: 'Settings update requires server restart. Modify .env file and restart.',
    requestedChanges: body,
    writeableAtRuntime: ['toolPaths', 'mcpExternalServers'],
    requiresRestart: ['database', 'llm', 'eventMesh', 'observability'],
  })
}
