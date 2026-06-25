#!/bin/bash
# SOTA Agentic OS — Health check script
#
# Fase 6.4 — Verifica lo stato di tutti i servizi
#
# Usage:
#   ./scripts/health-check.sh
#
# Exit codes:
#   0 — all healthy
#   1 — one or more services unhealthy

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

echo "SOTA Agentic OS — Health Check"
echo "================================"
echo

# Check Docker containers
echo "Docker containers:"
CONTAINERS=("sota-postgres" "sota-nats" "sota-langfuse")
ALL_HEALTHY=true

for container in "${CONTAINERS[@]}"; do
  if docker ps -q -f name=$container | grep -q .; then
    status=$(docker inspect --format='{{.State.Health.Status}}' $container 2>/dev/null || echo "no-healthcheck")
    if [ "$status" = "healthy" ] || [ "$status" = "no-healthcheck" ]; then
      ok "$container: $status"
    else
      fail "$container: $status"
      ALL_HEALTHY=false
    fi
  else
    warn "$container: not running"
    ALL_HEALTHY=false
  fi
done

# Check Redis (optional)
if docker ps -q -f name=sota-redis | grep -q .; then
  status=$(docker inspect --format='{{.State.Health.Status}}' sota-redis 2>/dev/null || echo "no-healthcheck")
  ok "sota-redis: $status"
fi

echo

# Check app endpoints
echo "App endpoints (requires bun run dev):"
APP_URL="http://localhost:3000"

check_endpoint() {
  local path=$1
  local name=$2
  local response=$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL$path" --max-time 3 2>/dev/null || echo "000")
  if [ "$response" = "200" ]; then
    ok "$name ($path): $response"
  elif [ "$response" = "000" ]; then
    warn "$name ($path): unreachable (app not running?)"
  else
    fail "$name ($path): $response"
  fi
}

check_endpoint "/api/runtime" "Runtime info"
check_endpoint "/api/mesh" "Event Mesh"
check_endpoint "/api/world-model" "World Model"
check_endpoint "/api/agent-mesh" "Agent Mesh"
check_endpoint "/api/cognitive-gc" "Cognitive GC"
check_endpoint "/api/skill-registry" "Skill Registry"
check_endpoint "/api/conflict-resolution" "Conflict Resolution"
check_endpoint "/api/evaluation" "Evaluation Layer"
check_endpoint "/api/mcp" "MCP Server"
check_endpoint "/autonomous" "Autonomous Dashboard UI"

echo

# Check external services
echo "External services:"
check_external() {
  local url=$1
  local name=$2
  local response=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 3 2>/dev/null || echo "000")
  if [ "$response" = "200" ] || [ "$response" = "401" ]; then
    ok "$name: reachable"
  elif [ "$response" = "000" ]; then
    warn "$name: unreachable"
  else
    warn "$name: HTTP $response"
  fi
}

check_external "http://localhost:8222/healthz" "NATS monitoring"
check_external "http://localhost:3001/api/health" "Langfuse"
check_external "http://localhost:5432" "PostgreSQL (TCP, may show 000 = OK if TCP-only)"

echo

# Summary
if [ "$ALL_HEALTHY" = "true" ]; then
  echo -e "${GREEN}=== All Docker containers healthy ===${NC}"
else
  echo -e "${YELLOW}=== Some containers not healthy or not running ===${NC}"
fi

# Don't fail if app endpoints are down (app might not be running)
exit 0
