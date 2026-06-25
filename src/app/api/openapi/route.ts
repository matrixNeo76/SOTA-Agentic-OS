/**
 * GET /api/openapi — OpenAPI 3.0 spec generata dalle route
 *
 * IO-4: Permette client autogenerati (SDK TS/Python) e documentazione interattiva.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'SOTA Agentic OS API',
      version: '1.0.0',
      description: 'Cognitive Operating System — Runtime executor, Context Graph, Memory Fabric, Governance, MCP server',
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local dev' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Bearer sak_<keyId>_<secret>',
        },
        CookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'sota_session',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { CookieAuth: [] }],
    paths: {
      // === Runs ===
      '/api/runs/list': {
        get: {
          summary: 'List workflow runs',
          tags: ['Runs'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'List of runs' } },
        },
      },
      '/api/runs/detail': {
        get: {
          summary: 'Get run detail',
          tags: ['Runs'],
          parameters: [{ name: 'planId', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Run detail' } },
        },
      },
      // === MCP ===
      '/api/mcp': {
        post: {
          summary: 'MCP JSON-RPC 2.0 endpoint (27 tools)',
          tags: ['MCP'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'JSON-RPC response' } },
        },
        get: {
          summary: 'MCP server info + tool list',
          tags: ['MCP'],
          responses: { '200': { description: 'Server info' } },
        },
      },
      // === Memory ===
      '/api/cognitive-gc': {
        get: { summary: 'Memory stats', tags: ['Memory'], responses: { '200': { description: 'Stats' } } },
      },
      '/api/admin/memory': {
        get: { summary: 'Context Graph browser', tags: ['Memory'], responses: { '200': { description: 'Graph stats' } } },
        post: { summary: 'Semantic memory search', tags: ['Memory'], responses: { '200': { description: 'Search results' } } },
      },
      // === Agents ===
      '/api/agent-mesh': {
        get: { summary: 'Mesh topology', tags: ['Agents'], responses: { '200': { description: 'Topology' } } },
        post: { summary: 'Bootstrap/delegate/escalate', tags: ['Agents'], responses: { '200': { description: 'Action result' } } },
      },
      '/api/autonomous-org': {
        get: { summary: 'Pending proposals', tags: ['Agents'], responses: { '200': { description: 'Proposals' } } },
        post: { summary: 'Create/approve/reject proposal', tags: ['Agents'], responses: { '200': { description: 'Result' } } },
      },
      // === Governance ===
      '/api/conflict-resolution': {
        get: { summary: 'Pending conflicts', tags: ['Governance'], responses: { '200': { description: 'Conflicts' } } },
        post: { summary: 'Resolve conflict', tags: ['Governance'], responses: { '200': { description: 'Resolution' } } },
      },
      // === Skills ===
      '/api/skill-registry': {
        get: { summary: 'List skills', tags: ['Skills'], responses: { '200': { description: 'Skills' } } },
        post: { summary: 'Register/search skill', tags: ['Skills'], responses: { '200': { description: 'Result' } } },
      },
      '/api/skills/export': {
        get: { summary: 'Export skill as SKILL.md or JSON', tags: ['Skills'], responses: { '200': { description: 'Skill export' } } },
      },
      '/api/skills/import': {
        post: { summary: 'Import external skill', tags: ['Skills'], responses: { '200': { description: 'Import result' } } },
      },
      '/api/skills/discover': {
        get: { summary: 'Skill discovery catalog', tags: ['Skills'], responses: { '200': { description: 'Catalog' } } },
      },
      // === System ===
      '/api/runtime': {
        get: { summary: 'Runtime info (DB provider, extensions)', tags: ['System'], responses: { '200': { description: 'Runtime info' } } },
      },
      '/api/admin/settings': {
        get: { summary: 'System settings', tags: ['Admin'], responses: { '200': { description: 'Settings' } } },
      },
      '/api/admin/api-keys': {
        get: { summary: 'List API keys', tags: ['Admin'], responses: { '200': { description: 'Keys' } } },
        post: { summary: 'Create/revoke API key', tags: ['Admin'], responses: { '200': { description: 'Result' } } },
      },
    },
    tags: [
      { name: 'Runs', description: 'Workflow execution' },
      { name: 'MCP', description: 'Model Context Protocol server' },
      { name: 'Memory', description: 'Memory Fabric + Context Graph' },
      { name: 'Agents', description: 'Agent mesh + Autonomous Org' },
      { name: 'Governance', description: 'Conflicts + HITL' },
      { name: 'Skills', description: 'Skill registry + export/import' },
      { name: 'System', description: 'Runtime + health' },
      { name: 'Admin', description: 'Admin & Settings (admin-only)' },
    ],
  }

  return NextResponse.json(spec)
}
