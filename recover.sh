#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# recover.sh — Post-reboot recovery script
#
# Run this after a laptop/WSL reboot to bring all services back up.
# Usage:  chmod +x recover.sh && ./recover.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail() { echo -e "${RED}[FAIL]${NC}  $1"; }
info() { echo -e "        $1"; }

echo "============================================="
echo " Kubernetes Deviation Dashboard — Recovery"
echo "============================================="
echo

# ── Step 1: Docker ──────────────────────────────────────────────────────────
echo "── Step 1: Docker daemon ──"
if docker info >/dev/null 2>&1; then
  ok "Docker is running"
else
  warn "Docker not reachable — attempting to fix"

  # Fix socket permissions (common WSL2 issue after reboot)
  if [[ -S /var/run/docker.sock ]]; then
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    info "Fixed Docker socket permissions"
  fi

  # Try starting dockerd if not running (systemd or service)
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl start docker 2>/dev/null || true
  elif command -v service >/dev/null 2>&1; then
    sudo service docker start 2>/dev/null || true
  fi

  sleep 2
  if docker info >/dev/null 2>&1; then
    ok "Docker is now running"
  else
    fail "Docker still not reachable — please start Docker Desktop or dockerd manually"
    exit 1
  fi
fi
echo

# ── Step 2: kind cluster containers ────────────────────────────────────────
echo "── Step 2: kind cluster containers ──"
EXPECTED_CLUSTERS="c1 c2 c3"
RUNNING=0
STARTED=0

for cluster in $EXPECTED_CLUSTERS; do
  container="${cluster}-control-plane"
  state=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo "missing")
  if [[ "$state" == "true" ]]; then
    ok "$container is running"
    ((RUNNING++))
  elif [[ "$state" == "false" ]]; then
    warn "$container is stopped — starting it"
    docker start "$container" >/dev/null 2>&1 && ok "Started $container" || fail "Could not start $container"
    ((STARTED++))
  else
    fail "$container not found — you may need to redeploy: ./start.sh or deploy via Greenfield tab"
  fi
done

# Wait for API servers if we restarted containers
if [[ $STARTED -gt 0 ]]; then
  echo
  info "Waiting for Kubernetes API servers to become ready..."
  sleep 5
fi

# Verify kubectl connectivity
for cluster in $EXPECTED_CLUSTERS; do
  if kubectl --context "kind-${cluster}" get nodes >/dev/null 2>&1; then
    ok "kubectl context kind-${cluster} is reachable"
  else
    warn "kind-${cluster} API server not ready yet (may take 15-30s after container start)"
  fi
done
echo

# ── Step 3: Ollama (local LLM) ─────────────────────────────────────────────
echo "── Step 3: Ollama (local LLM) ──"
if curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  ok "Ollama is running"
else
  if command -v ollama >/dev/null 2>&1; then
    warn "Ollama not running — starting it in background"
    nohup ollama serve >/dev/null 2>&1 &
    sleep 3
    if curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "Ollama is now running"
    else
      warn "Ollama started but not responding yet — it may need a few more seconds"
    fi
  else
    info "Ollama not installed — skipping (only needed for local LLM chat)"
  fi
fi
echo

# ── Step 4: Kill stale service processes ────────────────────────────────────
echo "── Step 4: Cleaning stale service processes ──"
RUN_DIR="$ROOT_DIR/.run"
if [[ -d "$RUN_DIR" ]]; then
  for pidfile in "$RUN_DIR"/*.pid; do
    [[ -f "$pidfile" ]] || continue
    svc_name=$(basename "$pidfile" .pid)
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      info "Stopping stale $svc_name (pid=$pid)"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  done
  ok "Cleaned stale PID files"
else
  info "No stale processes found"
fi
echo

# ── Step 5: Start all services ─────────────────────────────────────────────
echo "── Step 5: Starting all services via start.sh ──"
if [[ -x "$ROOT_DIR/start.sh" ]]; then
  bash "$ROOT_DIR/start.sh"
else
  fail "start.sh not found or not executable"
  info "Run: chmod +x $ROOT_DIR/start.sh && $ROOT_DIR/start.sh"
  exit 1
fi

echo
echo "============================================="
echo " Recovery complete!"
echo " Dashboard: http://localhost:3000"
echo "============================================="
