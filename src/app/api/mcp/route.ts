/**
 * MCP Server (Model Context Protocol) — Fase 5.4
 *
 * Espone i moduli Fase 1-4 via JSON-RPC 2.0 per client esterni
 * (Claude Desktop, Cursor, VS Code, ecc.).
 *
 * Protocollo MCP:
 *   - initialize: handshake con capabilities
 *   - tools/list: elenco tool disponibili
 *   - tools/call: esecuzione tool
 *   - prompts/list: elenco prompt templates (skill)
 *   - resources/list: elenco risorse (GraphNode, WorldState, etc.)
 *   - resources/read: lettura risorsa per URI
 *
 * Tool esposti (mapping ai moduli Fase 1-4):
 *   - sota_mesh_stats: Event Mesh stats
 *   - sota_world_model_capture: capture WorldState
 *   - sota_world_model_predict: create prediction
 *   - sota_digital_twin_whatif: run what-if simulation
 *   - sota_autonomous_org_proposals: list pending proposals
 *   - sota_autonomous_org_approve: approve proposal (HITL)
 *   - sota_agent_mesh_bootstrap: bootstrap default mesh
 *   - sota_agent_mesh_topology: get mesh topology
 *   - sota_evaluation_run: run evaluation on benchmark
 *   - sota_conflict_resolution_list: list pending conflicts
 *   - sota_conflict_resolution_resolve: resolve conflict
 *   - sota_cognitive_gc_run: run consolidation
 *   - sota_cognitive_router_classify: classify task
 *   - sota_skill_registry_search: search skills
 *   - sota_skill_synthesis_detect: detect skill gaps
 *   - sota_knowledge_extraction: extract document
 *   - sota_context_graph_query: query GraphNode by type
 *   - sota_memory_search: semantic memory search
 *   - sota_llm_health: check LLM availability
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { meshStats } from '@/lib/agent-mesh/topology'
import { worldModelStats, captureWorldState, createPrediction, getLatestWorldState } from '@/lib/world-model/engine'
import { digitalTwinStats, runWhatIf, WHAT_IF_PRESETS } from '@/lib/digital-twin/engine'
import { listPendingProposals, autonomousOrgStats, approveProposal } from '@/lib/autonomous-org/governor'
import { evaluationStats, runEvaluation, listBenchmarks } from '@/lib/evaluation/runner'
import { listPendingConflicts, conflictResolutionStats, resolveConflict } from '@/lib/conflict-resolution/engine'
import { gcStats, consolidateEpisodicToProcedural } from '@/lib/cognitive-gc/curator'
import { classifyTask, planRouting } from '@/lib/cognitive-router/router'
import { searchSkills, skillRegistryStats } from '@/lib/skill-registry/registry'
import { detectSkillGaps } from '@/lib/skill-synthesis/pipeline'
import { extractDocument } from '@/lib/knowledge-extraction/extractor'
import { semanticMemorySearch } from '@/lib/memory-fabric/fabric'
import { llmHealthCheck } from '@/lib/llm-client/client'
import { createProvenance } from '@/lib/governance'
import { eventMeshHealth } from '@/lib/event-mesh/mesh'

// === Tipi JSON-RPC ===================================================

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// === Tool definitions ================================================

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const TOOLS: ToolDef[] = [
  {
    name: 'sota_mesh_stats',
    description: 'Get Event Mesh stats: backend, subscribers, health',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_world_model_capture',
    description: 'Capture a new WorldState snapshot of the system',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_world_model_latest',
    description: 'Get the latest captured WorldState with metrics and anomalies',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_world_model_predict',
    description: 'Create a prediction based on the latest WorldState',
    inputSchema: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        probability: { type: 'number', minimum: 0, maximum: 1 },
        horizon: { type: 'string', enum: ['1h', '24h', '7d', '30d', '90d'] },
      },
      required: ['statement', 'probability', 'horizon'],
    },
  },
  {
    name: 'sota_digital_twin_whatif',
    description: 'Run a what-if simulation preset (6 available: double-concurrency, local-only-routing, api-only-routing, remove-reflective-agent, reduce-memory-budget-50, disable-consolidation)',
    inputSchema: {
      type: 'object',
      properties: {
        presetName: { type: 'string', enum: WHAT_IF_PRESETS.map((p) => p.name) },
      },
      required: ['presetName'],
    },
  },
  {
    name: 'sota_autonomous_org_proposals',
    description: 'List pending autonomous organization proposals awaiting Human Approval',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_autonomous_org_approve',
    description: 'Approve a pending autonomous org proposal (executes the action)',
    inputSchema: {
      type: 'object',
      properties: {
        proposalUri: { type: 'string' },
        approvedBy: { type: 'string', description: 'User URI (e.g. user://admin)' },
      },
      required: ['proposalUri', 'approvedBy'],
    },
  },
  {
    name: 'sota_agent_mesh_topology',
    description: 'Get the hierarchical agent mesh topology (10 agents in 3 tiers)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_evaluation_stats',
    description: 'Get evaluation layer stats: total evaluations, benchmarks, avg score',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_conflict_resolution_list',
    description: 'List pending knowledge claim conflicts',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_conflict_resolution_resolve',
    description: 'Resolve a conflict using one of 5 strategies (higher-confidence, more-evidence, more-reliable-source, formal-proof, human-decision)',
    inputSchema: {
      type: 'object',
      properties: {
        conflictUri: { type: 'string' },
        strategy: { type: 'string', enum: ['higher-confidence', 'more-evidence', 'more-reliable-source', 'formal-proof', 'human-decision'] },
        resolvedBy: { type: 'string' },
        manualWinnerUri: { type: 'string', description: 'Required for human-decision strategy' },
      },
      required: ['conflictUri', 'strategy', 'resolvedBy'],
    },
  },
  {
    name: 'sota_cognitive_gc_stats',
    description: 'Get memory stats by layer and tier (hot/warm/cold)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_cognitive_gc_consolidate',
    description: 'Run memory consolidation (episodic → procedural)',
    inputSchema: {
      type: 'object',
      properties: {
        agentUri: { type: 'string' },
        minClusterSize: { type: 'number', default: 3 },
      },
    },
  },
  {
    name: 'sota_cognitive_router_classify',
    description: 'Classify a task prompt into Simple/Medium/Complex/Critical with domain detection',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
    },
  },
  {
    name: 'sota_skill_registry_search',
    description: 'Search skills by query (matches name, description, tags)',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number', default: 10 } },
      required: ['query'],
    },
  },
  {
    name: 'sota_skill_synthesis_detect',
    description: 'Detect skill gaps from recent failed tasks',
    inputSchema: {
      type: 'object',
      properties: {
        daysWindow: { type: 'number', default: 7 },
        minOccurrences: { type: 'number', default: 3 },
      },
    },
  },
  {
    name: 'sota_knowledge_extraction',
    description: 'Extract a document into the Context Graph (chunks → entities → relations → embeddings)',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string' },
        content: { type: 'string', description: 'Base64-encoded content' },
        mimeType: { type: 'string' },
        source: { type: 'string', enum: ['upload', 'git', 'web', 'email', 'ticket'] },
      },
      required: ['uri', 'content', 'mimeType', 'source'],
    },
  },
  {
    name: 'sota_memory_search',
    description: 'Semantic search across memory fabric (episodic, semantic, procedural, reasoning layers)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        agentUri: { type: 'string' },
        topK: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'sota_llm_health',
    description: 'Check if the LLM (ZAI SDK / GLM) is available',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sota_context_graph_stats',
    description: 'Get Context Graph stats: total nodes, edges, by entity type',
    inputSchema: { type: 'object', properties: {} },
  },
]

// === Tool executor ===================================================

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const provenance = createProvenance({
    agent: 'agent://mcp-server',
    source: 'external-api',
    confidence: 1.0,
  })

  switch (name) {
    case 'sota_mesh_stats':
      return await eventMeshHealth()

    case 'sota_world_model_capture':
      return await captureWorldState({ provenance })

    case 'sota_world_model_latest':
      return await getLatestWorldState()

    case 'sota_world_model_predict': {
      const latest = await getLatestWorldState()
      if (!latest) throw new Error('No WorldState available. Call sota_world_model_capture first.')
      return await createPrediction({
        statement: args.statement as string,
        probability: args.probability as number,
        horizon: args.horizon as '1h' | '24h' | '7d' | '30d' | '90d',
        basedOnWorldStateUri: latest.uri,
        provenance,
      })
    }

    case 'sota_digital_twin_whatif':
      return await runWhatIf(args.presetName as string, provenance)

    case 'sota_autonomous_org_proposals':
      return await listPendingProposals(50)

    case 'sota_autonomous_org_approve':
      return await approveProposal({
        proposalUri: args.proposalUri as string,
        approvedBy: args.approvedBy as string,
        provenance,
      })

    case 'sota_agent_mesh_topology':
      return await meshStats()

    case 'sota_evaluation_stats':
      return await evaluationStats()

    case 'sota_conflict_resolution_list':
      return await listPendingConflicts()

    case 'sota_conflict_resolution_resolve':
      return await resolveConflict({
        conflictUri: args.conflictUri as string,
        strategy: args.strategy as 'higher-confidence' | 'more-evidence' | 'more-reliable-source' | 'formal-proof' | 'human-decision',
        resolvedBy: args.resolvedBy as string,
        manualWinnerUri: args.manualWinnerUri as string | undefined,
        provenance,
      })

    case 'sota_cognitive_gc_stats':
      return await gcStats()

    case 'sota_cognitive_gc_consolidate':
      return await consolidateEpisodicToProcedural({
        agentUri: args.agentUri as string | undefined,
        minClusterSize: args.minClusterSize as number | undefined,
      })

    case 'sota_cognitive_router_classify':
      return await classifyTask(args.prompt as string, { useLLM: false }) // MCP calls use rule-based to avoid LLM rate limits

    case 'sota_skill_registry_search':
      return await searchSkills(args.query as string, { limit: args.limit as number | undefined })

    case 'sota_skill_synthesis_detect':
      return await detectSkillGaps({
        daysWindow: args.daysWindow as number | undefined,
        minOccurrences: args.minOccurrences as number | undefined,
      })

    case 'sota_knowledge_extraction': {
      const result = await extractDocument({
        uri: args.uri as string,
        content: Buffer.from(args.content as string, 'base64'),
        mimeType: args.mimeType as string,
        source: args.source as string,
        provenance,
      })
      return {
        chunks: result.chunks.length,
        entities: result.entities.length,
        relations: result.relations.length,
        graphNodesCreated: result.graphNodesCreated,
        embeddingsStored: result.embeddingsStored,
      }
    }

    case 'sota_memory_search':
      return await semanticMemorySearch(
        args.query as string,
        args.agentUri as string | undefined,
        (args.topK as number) || 5,
      )

    case 'sota_llm_health':
      return await llmHealthCheck()

    case 'sota_context_graph_stats': {
      const [totalNodes, totalEdges, byType] = await Promise.all([
        db.graphNode.count(),
        db.graphEdge.count(),
        db.graphNode.groupBy({ by: ['entityType'], _count: true }),
      ])
      return {
        totalNodes,
        totalEdges,
        nodesByType: byType.reduce((acc, n) => ({ ...acc, [n.entityType]: n._count }), {} as Record<string, number>),
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// === JSON-RPC handlers ===============================================

function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> | JsonRpcResponse {
  const { id, method, params } = req

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'sota-agentic-os-mcp',
            version: '5.4.0',
            description: 'SOTA Agentic OS — MCP server exposing Fase 1-4 modules (Context Graph, World Model, Digital Twin, Autonomous Org, etc.)',
          },
        },
      }

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS,
        },
      }

    case 'tools/call':
      return (async () => {
        const p = params as { name: string; arguments?: Record<string, unknown> }
        if (!p?.name) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' },
          }
        }
        try {
          const result = await executeTool(p.name, p.arguments || {})
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          }
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
            },
          }
        }
      })()

    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            { uri: 'sota://world-state/latest', name: 'Latest WorldState', description: 'Most recent system snapshot' },
            { uri: 'sota://proposals/pending', name: 'Pending Proposals', description: 'Autonomous Org proposals awaiting approval' },
            { uri: 'sota://conflicts/pending', name: 'Pending Conflicts', description: 'Knowledge claim conflicts' },
            { uri: 'sota://mesh/topology', name: 'Agent Mesh', description: 'Hierarchical agent mesh topology' },
            { uri: 'sota://skills/all', name: 'Skill Registry', description: 'All registered skills' },
          ],
        },
      }

    case 'resources/read':
      return (async () => {
        const p = params as { uri: string }
        if (!p?.uri) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing uri' } }
        }
        try {
          let content: unknown
          switch (p.uri) {
            case 'sota://world-state/latest':
              content = await getLatestWorldState()
              break
            case 'sota://proposals/pending':
              content = await listPendingProposals(50)
              break
            case 'sota://conflicts/pending':
              content = await listPendingConflicts()
              break
            case 'sota://mesh/topology':
              content = await meshStats()
              break
            case 'sota://skills/all':
              content = await skillRegistryStats()
              break
            default:
              return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${p.uri}` } }
          }
          return {
            jsonrpc: '2.0',
            id,
            result: { contents: [{ uri: p.uri, text: JSON.stringify(content, null, 2) }] },
          }
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
          }
        }
      })()

    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'analyze-system-health',
              description: 'Analyze overall system health using World Model + Event Mesh stats',
              arguments: [],
            },
            {
              name: 'propose-optimization',
              description: 'Generate optimization proposals based on current WorldState anomalies',
              arguments: [],
            },
          ],
        },
      }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
  }
}

// === HTTP entry point ================================================

export async function POST(req: Request) {
  try {
    const body = await req.json() as JsonRpcRequest | JsonRpcRequest[]

    // Batch request support
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((r) => Promise.resolve(handleRequest(r))))
      return NextResponse.json(responses)
    }

    const response = await handleRequest(body)
    return NextResponse.json(response)
  } catch (err) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
        data: err instanceof Error ? err.message : String(err),
      },
    }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'sota-agentic-os-mcp',
    version: '5.4.0',
    protocolVersion: '2024-11-05',
    tools: TOOLS.length,
    description: 'MCP server exposing SOTA Agentic OS Fase 1-4 modules. Use POST with JSON-RPC 2.0 requests.',
    availableMethods: ['initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'prompts/list'],
    toolNames: TOOLS.map((t) => t.name),
  })
}
