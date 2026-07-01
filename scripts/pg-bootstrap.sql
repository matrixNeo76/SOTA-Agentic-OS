-- ============================================================
-- SOTA Agentic OS — PostgreSQL bootstrap (Fase 1.1)
-- Eseguito automaticamente da docker-entrypoint-initdb.d al primo avvio.
-- Idempotente: usa IF NOT EXISTS dove possibile.
-- ============================================================

-- 1. pgvector: storage vettoriale nativo per embeddings (Fase 1.4 GraphRAG, Fase 1.5 Memory Fabric)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Apache AGE: graph database su Postgres (Fase 1.2 Universal Context Graph)
-- Richiede AgensGraph o AGE installato. Se l'estensione non è disponibile, il runtime
-- ricade sul path relazionale (GraphNode/GraphEdge).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'age'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS age;
    -- Crea il graph "sota" se non esiste. LOAD è necessario in ogni sessione che usa AGE.
    LOAD 'age';
    SET search_path = ag_catalog, "$user", public;
    PERFORM ag_catalog.create_graph('sota');
    RAISE NOTICE 'Apache AGE abilitato + graph "sota" creato';
  ELSE
    RAISE NOTICE 'Apache AGE non disponibile — fallback relazionale attivo';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skip AGE setup: %', SQLERRM;
END $$;

-- 3. Indici GIN su JSONB per query su attributes (GraphNode.attributes, MemoryEntry.embedding)
CREATE INDEX IF NOT EXISTS idx_graph_node_attributes_gin
  ON "GraphNode" USING GIN (attributes::jsonb);

CREATE INDEX IF NOT EXISTS idx_graph_edge_properties_gin
  ON "GraphEdge" USING GIN (properties::jsonb);

-- 4. Indici B-tree essenziali per performance (idempotenti)
CREATE INDEX IF NOT EXISTS idx_episodic_memory_timestamp ON "EpisodicMemory"(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_log_timestamp ON "AgentLog"(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cost_entry_timestamp ON "CostEntry"(timestamp DESC);

-- 5. Funzione utility: cosine similarity via pgvector (usata dal runtime se provider=postgres)
-- Il runtime chiama questa funzione via $queryRaw per evitare SQL injection.
CREATE OR REPLACE FUNCTION sota_cosine_search(
  p_table text,
  p_column text,
  p_query vector,
  p_topk int DEFAULT 5,
  p_filter text DEFAULT NULL
) RETURNS TABLE(uri text, score float8)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  stmt text;
BEGIN
  -- Costruisci dinamicamente la query. p_table/p_column sono allow-listed dal runtime.
  stmt := format(
    'SELECT entity_uri AS uri, 1 - (%I <=> $1) AS score FROM %I',
    p_column, p_table
  );
  IF p_filter IS NOT NULL AND p_filter <> '' THEN
    stmt := stmt || ' WHERE ' || p_filter;
  END IF;
  stmt := stmt || ' ORDER BY %I <=> $1 LIMIT $2';
  stmt := format(stmt, p_column);

  RETURN QUERY EXECUTE stmt USING p_query, p_topk;
END;
$$;

COMMENT ON FUNCTION sota_cosine_search IS
  'Fase 1.4 GraphRAG — cosine similarity via pgvector. Chiamata solo dal runtime TypeScript.';
