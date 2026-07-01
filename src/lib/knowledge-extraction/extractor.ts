/**
 * Knowledge Extraction Engine — Fase 2.2
 *
 * Pipeline: PDF/Email/Ticket/Repo/Wiki → OCR/Extract → Chunking →
 *           Entity/Relation Extraction → Embedding → Context Graph
 *
 * Strategia open-source senza dipendenze esterne obbligatorie:
 *   - Text extractor: pluggable (kreuzberg in produzione, raw text in dev)
 *   - Chunking: algoritmo sliding-window con overlap (semantico-aware)
 *   - Entity extraction: regex + keyword heuristics (spaCy opzionale)
 *   - Relation extraction: co-occurrence + pattern matching
 *   - Embedding: riusa @/lib/embeddings (MiniLM-like locale)
 *   - Context Graph: riusa @/lib/graph-age (createNode + createEdge)
 *
 * Tutto asincrono, integrabile con Event Mesh (Fase 2.1):
 *   DocumentUploaded → trigger extraction → ClaimsCreated/CodeChanged events
 */

import { embed } from '@/lib/embeddings'
import { createNode, createEdge } from '@/lib/graph-age'
import { createProvenance, type Provenance } from '@/lib/governance'
import { storeEmbedding } from '@/lib/vector-store'
import { publishDocumentUploaded, publishClaimCreated } from '@/lib/event-mesh/publishers'

// === Tipi ============================================================

export interface ExtractedDocument {
  uri: string
  mimeType: string
  sizeBytes: number
  source: string // 'upload' | 'git' | 'web' | 'email' | 'ticket'
  rawText: string
  extractedAt: string
}

export interface Chunk {
  id: string
  documentUri: string
  index: number
  content: string
  startOffset: number
  endOffset: number
  tokenEstimate: number
}

export interface ExtractedEntity {
  type: 'Agent' | 'Task' | 'Skill' | 'Tool' | 'Concept' | 'Metric'
  name: string
  mentions: number
  firstSeenChunk: number
  confidence: number
}

export interface ExtractedRelation {
  fromEntity: string
  toEntity: string
  relationType: string
  evidence: string
  confidence: number
}

export interface ExtractionResult {
  document: ExtractedDocument
  chunks: Chunk[]
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
  graphNodesCreated: number
  graphEdgesCreated: number
  embeddingsStored: number
}

// === Text extractors =================================================

export type TextExtractor = (input: { content: Buffer; mimeType: string }) => Promise<string>

const defaultTextExtractor: TextExtractor = async ({ content, mimeType }) => {
  // Per file di testo semplice, ritorna il contenuto decodificato.
  // Per PDF/docx/binari, in produzione si plugga kreuzberg/OCRmyPDF.
  if (mimeType.startsWith('text/')) {
    return content.toString('utf-8')
  }
  // Best-effort: prova utf-8 e scarta bytes non validi
  return content.toString('utf-8').replace(/\ufffd/g, ' ')
}

// === Chunking ========================================================

export interface ChunkingOptions {
  targetTokens?: number  // default 256
  overlapTokens?: number // default 32
  maxChunks?: number     // default 1000 (safety cap)
}

/**
 * Stima token come ~4 caratteri. Sufficiente per chunking.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Sliding-window chunking con overlap.
 * Per testi strutturati prova a spezzare su paragraph/heading prima.
 */
export function chunkText(text: string, options: ChunkingOptions = {}): Omit<Chunk, 'id' | 'documentUri'>[] {
  const target = options.targetTokens ?? 256
  const overlap = options.overlapTokens ?? 32
  const maxChunks = options.maxChunks ?? 1000

  const targetChars = target * 4
  const overlapChars = overlap * 4

  // Prova prima a spezzare su doppio newline (paragraph)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
  const chunks: Array<{ content: string; startOffset: number; endOffset: number; index: number; tokenEstimate: number }> = []

  let current = ''
  let currentStart = 0
  let cursor = 0
  let index = 0

  for (const para of paragraphs) {
    const paraStart = text.indexOf(para, cursor)
    if (current.length + para.length + 2 > targetChars && current.length > 0) {
      // Flush current chunk
      chunks.push({
        content: current,
        startOffset: currentStart,
        endOffset: currentStart + current.length,
        index,
        tokenEstimate: estimateTokens(current),
      })
      index++
      if (index >= maxChunks) break

      // Inizia nuovo chunk con overlap (paragrafo precedente troncato)
      const overlapText = current.slice(-overlapChars)
      current = overlapText + '\n\n' + para
      currentStart = paraStart - overlapText.length
    } else {
      if (current.length === 0) {
        current = para
        currentStart = paraStart
      } else {
        current += '\n\n' + para
      }
    }
    cursor = paraStart + para.length
  }

  // Flush finale
  if (current.length > 0 && index < maxChunks) {
    chunks.push({
      content: current,
      startOffset: currentStart,
      endOffset: currentStart + current.length,
      index,
      tokenEstimate: estimateTokens(current),
    })
  }

  return chunks
}

// === Entity extraction ==============================================

// Dizionari minimi per entity extraction.
// In produzione questi possono essere arricchiti con NER via spaCy.
const ENTITY_PATTERNS: Record<ExtractedEntity['type'], RegExp[]> = {
  Agent: [
    /\b(?:agent|agente)[:\s]+([a-z][a-z0-9_-]+)/gi,
    /\b(planner|orchestrator|curator|controller|verifier|reflective|router)\b/gi,
  ],
  Task: [
    /\b(?:task|compito)[:\s]+([a-z][a-z0-9_-]+)/gi,
    /\b(genera|esegui|analizza|verifica|valida)\b/gi,
  ],
  Skill: [
    /\b(?:skill|abilità)[:\s]+([a-z][a-z0-9_-]+)/gi,
    /\b(code-review|deployment|testing|debugging|refactoring)\b/gi,
  ],
  Tool: [
    /\b(?:tool|strumento)[:\s]+([a-z][a-z0-9_-]+)/gi,
    /\b(git|docker|kubernetes|npm|bun|pytest|vitest)\b/gi,
  ],
  Concept: [
    /\b(memory|memoria|graph|grafo|embeddings?|vectors?|vettori?|context|contesto)\b/gi,
    /\b(memory fabric|context graph|graphrag|erl|acts|dynamo)\b/gi,
  ],
  Metric: [
    /\b(\d+(?:\.\d+)?%)\b/g,
    /\b(\d+\s*(?:ms|tokens?|kb|mb))\b/gi,
  ],
}

export function extractEntities(chunks: Chunk[]): ExtractedEntity[] {
  const entityMap = new Map<string, ExtractedEntity>()

  for (const chunk of chunks) {
    const text = chunk.content
    for (const [type, patterns] of Object.entries(ENTITY_PATTERNS)) {
      for (const pattern of patterns) {
        const matches = text.matchAll(pattern)
        for (const match of matches) {
          // Per pattern con gruppo: usa il gruppo; altrimenti usa il match intero
          const name = (match[1] || match[0]).toLowerCase().trim()
          if (!name || name.length < 2) continue

          const key = `${type}:${name}`
          const existing = entityMap.get(key)
          if (existing) {
            existing.mentions++
          } else {
            entityMap.set(key, {
              type: type as ExtractedEntity['type'],
              name,
              mentions: 1,
              firstSeenChunk: chunk.index,
              // Confidence decay: prime menzioni più affidabili
              confidence: Math.min(1.0, 0.5 + 0.1 * Math.log(chunks.length)),
            })
          }
        }
      }
    }
  }

  return Array.from(entityMap.values())
    .filter((e) => e.mentions >= 1)
    .sort((a, b) => b.mentions - a.mentions)
}

// === Relation extraction =============================================

/**
 * Estrae relazioni semplici da co-occorrenza in stesso chunk.
 * Pattern espliciti:
 *   - "X usa Y" → USES
 *   - "X genera Y" → GENERATES
 *   - "X dipende da Y" → DEPENDS_ON
 *   - "X è un Y" → IS_A
 * Altrimenti: co-occurrence entro 200 char → RELATED_TO
 */
export function extractRelations(chunks: Chunk[], entities: ExtractedEntity[]): ExtractedRelation[] {
  const entityNames = entities.map((e) => e.name)
  const relations: ExtractedRelation[] = []
  const seen = new Set<string>()

  const explicitPatterns: Array<{ regex: RegExp; type: string }> = [
    { regex: /(\w+)\s+(?:usa|use|uses)\s+(\w+)/gi, type: 'USES' },
    { regex: /(\w+)\s+(?:genera|generate|generates)\s+(\w+)/gi, type: 'GENERATES' },
    { regex: /(\w+)\s+(?:dipende da|depends on|depend on)\s+(\w+)/gi, type: 'DEPENDS_ON' },
    { regex: /(\w+)\s+(?:è un|is a|is an)\s+(\w+)/gi, type: 'IS_A' },
    { regex: /(\w+)\s+(?:esegue|execute|executes|runs)\s+(\w+)/gi, type: 'EXECUTES' },
  ]

  for (const chunk of chunks) {
    // 1. Pattern espliciti
    for (const { regex, type } of explicitPatterns) {
      const matches = chunk.content.matchAll(regex)
      for (const match of matches) {
        const from = match[1]?.toLowerCase()
        const to = match[2]?.toLowerCase()
        if (!from || !to) continue
        if (!entityNames.includes(from) || !entityNames.includes(to)) continue

        const key = `${from}-${type}-${to}`
        if (seen.has(key)) continue
        seen.add(key)

        relations.push({
          fromEntity: from,
          toEntity: to,
          relationType: type,
          evidence: match[0],
          confidence: 0.7,
        })
      }
    }

    // 2. Co-occurrence entro finestra di 200 char
    for (let i = 0; i < entityNames.length; i++) {
      for (let j = i + 1; j < entityNames.length; j++) {
        const a = entityNames[i]!
        const b = entityNames[j]!
        const regexA = new RegExp(`\\b${escapeRegex(a)}\\b`, 'gi')
        const regexB = new RegExp(`\\b${escapeRegex(b)}\\b`, 'gi')

        const matchesA = [...chunk.content.matchAll(regexA)]
        const matchesB = [...chunk.content.matchAll(regexB)]

        if (matchesA.length > 0 && matchesB.length > 0) {
          // Verifica distanza minima
          for (const ma of matchesA) {
            for (const mb of matchesB) {
              const dist = Math.abs(ma.index! - mb.index!)
              if (dist < 200) {
                const key = `${a}-RELATED_TO-${b}`
                if (seen.has(key)) break
                seen.add(key)
                relations.push({
                  fromEntity: a,
                  toEntity: b,
                  relationType: 'RELATED_TO',
                  evidence: chunk.content.slice(Math.min(ma.index!, mb.index!), Math.max(ma.index!, mb.index!) + 50),
                  confidence: 0.4,
                })
                break
              }
            }
          }
        }
      }
    }
  }

  return relations
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// === Pipeline orchestrator ==========================================

export async function extractDocument(params: {
  uri: string
  content: Buffer
  mimeType: string
  source: string
  extractor?: TextExtractor
  provenance: Provenance
  chunking?: ChunkingOptions
}): Promise<ExtractionResult> {
  const extractor = params.extractor || defaultTextExtractor

  // 1. Extract text
  const rawText = await extractor({ content: params.content, mimeType: params.mimeType })

  const document: ExtractedDocument = {
    uri: params.uri,
    mimeType: params.mimeType,
    sizeBytes: params.content.byteLength,
    source: params.source,
    rawText,
    extractedAt: new Date().toISOString(),
  }

  // Pubblica evento DocumentUploaded (Fase 2.1)
  await publishDocumentUploaded(document.uri, document.mimeType, document.sizeBytes, params.provenance)

  // 2. Chunking
  const chunkResults = chunkText(rawText, params.chunking)
  const chunks: Chunk[] = chunkResults.map((c) => ({
    id: `${params.uri}#chunk-${c.index}`,
    documentUri: params.uri,
    ...c,
  }))

  // 3. Entity + Relation extraction
  const entities = extractEntities(chunks)
  const relations = extractRelations(chunks, entities)

  // 4. Persistenza su Context Graph (Fase 1.2)
  let graphNodesCreated = 0
  let graphEdgesCreated = 0

  // Nodo Document
  try {
    await createNode({
      type: 'Document',
      identifier: extractIdentifier(params.uri),
      attributes: {
        title: params.uri,
        source: params.source,
        mimeType: params.mimeType,
        sizeBytes: document.sizeBytes,
        chunks: chunks.length,
      },
      provenance: params.provenance,
    })
    graphNodesCreated++
  } catch (err) {
    // Nodo Document già esistente: ok, prosegui
  }

  // Nodi Claim per ogni entità rilevante
  for (const entity of entities.slice(0, 50)) { // top 50
    if (entity.mentions < 2) continue
    try {
      const claimUri = `claim://${entity.type.toLowerCase()}/${entity.name}`
      await createNode({
        type: 'Claim',
        identifier: `${entity.type.toLowerCase()}/${entity.name}`,
        attributes: {
          statement: `${entity.type} "${entity.name}" menzionato in ${params.uri}`,
          confidence: entity.confidence,
          mentions: entity.mentions,
          sourceDocument: params.uri,
        },
        provenance: params.provenance,
      })
      graphNodesCreated++

      // Edge Document -[MENTIONS]-> Claim
      try {
        await createEdge({
          fromUri: params.uri,
          toUri: claimUri,
          relationType: 'MENTIONS',
          createdByAgent: params.provenance.createdByAgent,
        })
        graphEdgesCreated++
      } catch (e: any) {
        // B6: log instead of silent swallow
        console.debug(`[extractor] Edge MENTIONS create failed for ${claimUri}:`, e?.message)
      }

      // Pubblica ClaimCreated event (Fase 2.8 conflict resolution input)
      await publishClaimCreated(claimUri, `${entity.type} ${entity.name}`, entity.confidence, params.provenance)
    } catch (e: any) {
      // B6: log instead of silent swallow
      console.debug(`[extractor] Claim node create failed for ${entity.name}:`, e?.message)
    }
  }

  // Edges per relazioni
  for (const rel of relations.slice(0, 100)) {
    const fromUri = `claim://concept/${rel.fromEntity}`
    const toUri = `claim://concept/${rel.toEntity}`
    try {
      await createEdge({
        fromUri,
        toUri,
        relationType: rel.relationType,
        createdByAgent: params.provenance.createdByAgent,
        properties: { confidence: rel.confidence, evidence: rel.evidence },
      })
      graphEdgesCreated++
    } catch (e: any) {
      // B6: log instead of silent swallow
      console.debug(`[extractor] Edge ${rel.relationType} create failed for ${rel.fromEntity}->${rel.toEntity}:`, e?.message)
    }
  }

  // 5. Embeddings per chunk (per GraphRAG di Fase 1.4)
  let embeddingsStored = 0
  for (const chunk of chunks.slice(0, 100)) { // cap a 100 chunk per doc
    const chunkEmbedding = embed(chunk.content)
    await storeEmbedding({
      entityUri: chunk.id,
      entityType: 'Chunk',
      embedding: chunkEmbedding,
    })
    embeddingsStored++
  }

  return {
    document,
    chunks,
    entities,
    relations,
    graphNodesCreated,
    graphEdgesCreated,
    embeddingsStored,
  }
}

function extractIdentifier(uri: string): string {
  // Estrae l'ultima parte dell'URI come identificatore
  const parts = uri.split(/[:/]/).filter(Boolean)
  return parts[parts.length - 1] || 'unknown'
}

// === Default provenance for extraction ===============================

export function extractionProvenance(agentUri: string = 'agent://extractor'): Provenance {
  return createProvenance({
    agent: agentUri,
    source: 'document-extraction',
    confidence: 0.7, // confidence media per contenuto estratto automaticamente
  })
}
