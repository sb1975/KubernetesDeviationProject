#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# stop.sh — Stop all services and destroy kind clusters
#
# Usage:
#   ./stop.sh           # Stops services and deletes all running kind clusters
#   ./stop.sh c1 c2 c3  # Stops services and deletes specified clusters
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail() { echo -e "${RED}[FAIL]${NC}  $1"; }
info() { echo -e "        $1"; }

echo "============================================="
echo " Kubernetes Deviation Dashboard — Stop All"
echo "============================================="
echo

# ── Step 1: Stop all services ──────────────────────────────────────────────

echo "── Step 1: Stopping services ──"

SERVICES=("frontend_web" "backend_api" "deviation_mcp" "deployment_mcp" "artifact_mcp")

for service in "${SERVICES[@]}"; do
  pid_file="$RUN_DIR/${service}.pid"
  if [[ -f "$pid_file" ]]; then
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      rm "$pid_file"
      ok "Stopped $service (pid=$pid)"
    else
      warn "$service (pid=$pid) not running"
      rm "$pid_file"
    fi
  else
    warn "$service pid file not found"
  fi
done

echo

# ── Step 2: Destroy kind clusters ──────────────────────────────────────────

echo "── Step 2: Destroying kind clusters ──"

if ! command -v kind >/dev/null 2>&1; then
  warn "kind command not found — cannot delete clusters"
else
  # Determine cluster names: from args, from clusters.json, or from running clusters
  if [[ $# -gt 0 ]]; then
    # Use command-line arguments
    CLUSTERS=("$@")
    info "Using cluster names from command-line arguments: ${CLUSTERS[*]}"
  elif [[ -f "$ROOT_DIR/MCP_Agents/input/clusters.json" ]]; then
    # Read from clusters.json (user-created clusters from webpage)
    if command -v jq >/dev/null 2>&1; then
      mapfile -t CLUSTERS < <(jq -r '.clusters[]' "$ROOT_DIR/MCP_Agents/input/clusters.json" 2>/dev/null || echo "")
      if [[ ${#CLUSTERS[@]} -gt 0 ]]; then
        info "Found ${#CLUSTERS[@]} cluster(s) in clusters.json: ${CLUSTERS[*]}"
      else
        info "No clusters found in clusters.json, checking running clusters..."
        mapfile -t CLUSTERS < <(kind get clusters 2>/dev/null || echo "")
      fi
    else
      warn "jq not found, checking running clusters..."
      mapfile -t CLUSTERS < <(kind get clusters 2>/dev/null || echo "")
    fi
  else
    # Fall back to all currently running kind clusters
    mapfile -t CLUSTERS < <(kind get clusters 2>/dev/null || echo "")
    if [[ ${#CLUSTERS[@]} -gt 0 ]]; then
      info "Found ${#CLUSTERS[@]} running cluster(s): ${CLUSTERS[*]}"
    else
      info "No running clusters found"
    fi
  fi

  # Delete each cluster
  for cluster in "${CLUSTERS[@]}"; do
    if [[ -n "$cluster" ]]; then
      kind delete cluster --name "$cluster" 2>/dev/null && ok "Deleted cluster $cluster" || fail "Failed to delete cluster $cluster"
    fi
  done

  # Clear clusters.json after deletion
  if [[ -f "$ROOT_DIR/MCP_Agents/input/clusters.json" ]] && command -v jq >/dev/null 2>&1; then
    echo '{"schema_version": "1.0", "clusters": []}' > "$ROOT_DIR/MCP_Agents/input/clusters.json"
    ok "Cleared clusters.json"
  fi
fi

echo

# ── Step 3: Cleanup (optional) ─────────────────────────────────────────────

echo "── Step 3: Cleanup ──"

echo "Removing generated kind config YAML files..."
mapfile -t YAML_FILES < <(find "$ROOT_DIR/MCP_Agents" -maxdepth 2 -type f -name '*.yaml' \( -path '*/generated-kind-configs-*/*' -o -path '*/generated-kind-configs/*' \) 2>/dev/null || true)
if [[ ${#YAML_FILES[@]} -gt 0 ]]; then
  for yaml_file in "${YAML_FILES[@]}"; do
    rm -f "$yaml_file"
  done
  ok "Removed ${#YAML_FILES[@]} generated YAML file(s)"
else
  info "No generated YAML files found"
fi

if [[ -d "$RUN_DIR" ]]; then
  rm -rf "$RUN_DIR"
  ok "Cleared .run directory"
fi

if [[ -d "$LOG_DIR" ]]; then
  ok "Logs preserved in $LOG_DIR (for debugging)"
fi

echo
echo "[DONE] All services stopped and clusters destroyed."
