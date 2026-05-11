#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restart.sh — Restart individual services or all services
#
# Usage:
#   ./restart.sh              # Restart ALL services
#   ./restart.sh backend      # Restart backend API only (e.g. after .env change)
#   ./restart.sh frontend     # Restart frontend / GUI only
#   ./restart.sh mcp          # Restart all 3 MCP agents
#   ./restart.sh ollama       # Restart Ollama (local LLM)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"

PYTHON_BIN="${PYTHON_BIN:-$HOME/.venvs/artifact-mcp/bin/python3}"
UVICORN_BIN="${UVICORN_BIN:-$HOME/.venvs/artifact-mcp/bin/uvicorn}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail() { echo -e "${RED}[FAIL]${NC}  $1"; }
info() { echo -e "        $1"; }

mkdir -p "$RUN_DIR" "$LOG_DIR"

stop_service() {
  local name="$1"
  local pid_file="$RUN_DIR/${name}.pid"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      # Wait up to 5s for graceful shutdown
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      # Force kill if still alive
      kill -9 "$pid" 2>/dev/null || true
      ok "Stopped $name (pid=$pid)"
    else
      info "$name was not running (stale pid=$pid)"
    fi
    rm -f "$pid_file"
  else
    info "$name has no PID file"
  fi
}

is_port_listening() {
  ss -ltn | grep -q ":${1} "
}

start_service() {
  local name="$1"
  local port="$2"
  local cmd="$3"
  local log_file="$LOG_DIR/${name}.log"
  local pid_file="$RUN_DIR/${name}.pid"

  echo "[START] $name on port $port"
  nohup bash -lc "$cmd" >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"

  for _ in $(seq 1 25); do
    if is_port_listening "$port"; then
      ok "$name started (pid=$pid)"
      return 0
    fi
    sleep 1
  done

  fail "$name did not start. Check log: $log_file"
  return 1
}

# ── Service definitions ──────────────────────────────────────────────────────

restart_backend() {
  echo "── Restarting Backend API (port 8000) ──"
  stop_service "backend_api"
  # Kill anything else on port 8000
  local stale_pid
  stale_pid=$(lsof -ti:8000 2>/dev/null || true)
  if [[ -n "$stale_pid" ]]; then
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi
  start_service \
    "backend_api" \
    "8000" \
    "cd '$ROOT_DIR' && '$UVICORN_BIN' webapp.backend.main:app --host 127.0.0.1 --port 8000 --reload"
  echo
}

restart_frontend() {
  echo "── Restarting Frontend GUI (port 3000) ──"
  stop_service "frontend_web"
  local stale_pid
  stale_pid=$(lsof -ti:3000 2>/dev/null || true)
  if [[ -n "$stale_pid" ]]; then
    kill "$stale_pid" 2>/dev/null || true
    sleep 1
  fi
  start_service \
    "frontend_web" \
    "3000" \
    "cd '$ROOT_DIR/webapp' && npm run dev -- --host 127.0.0.1 --port 3000"
  echo
}

restart_mcp() {
  echo "── Restarting MCP Agents ──"
  for svc in artifact_mcp deployment_mcp deviation_mcp; do
    stop_service "$svc"
  done
  # Kill anything on MCP ports
  for port in 8765 8766 8767; do
    local stale_pid
    stale_pid=$(lsof -ti:$port 2>/dev/null || true)
    [[ -n "$stale_pid" ]] && kill "$stale_pid" 2>/dev/null || true
  done
  sleep 1
  start_service \
    "artifact_mcp" \
    "8765" \
    "cd '$ROOT_DIR/MCP_Agents' && '$PYTHON_BIN' Artifact_mcp.py serve --transport sse --host 127.0.0.1 --port 8765"
  start_service \
    "deployment_mcp" \
    "8766" \
    "cd '$ROOT_DIR/MCP_Agents' && '$PYTHON_BIN' Deployment_mcp.py serve --transport sse --host 127.0.0.1 --port 8766"
  start_service \
    "deviation_mcp" \
    "8767" \
    "cd '$ROOT_DIR/MCP_Agents' && '$PYTHON_BIN' Deviation_mcp.py serve --transport sse --host 127.0.0.1 --port 8767"
  echo
}

restart_ollama() {
  echo "── Restarting Ollama ──"
  pkill -f "ollama serve" 2>/dev/null || true
  sleep 2
  if command -v ollama >/dev/null 2>&1; then
    nohup ollama serve >/dev/null 2>&1 &
    sleep 3
    if curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "Ollama is running"
    else
      warn "Ollama started but not responding yet"
    fi
  else
    warn "Ollama not installed — skipping"
  fi
  echo
}

restart_all() {
  echo "============================================="
  echo " Restarting All Services"
  echo "============================================="
  echo
  restart_mcp
  restart_backend
  restart_frontend
  restart_ollama
  echo "============================================="
  echo " All services restarted!"
  echo " Dashboard: http://localhost:3000"
  echo "============================================="
}

# ── Main ──────────────────────────────────────────────────────────────────────

TARGET="${1:-all}"

case "$TARGET" in
  backend|api)
    restart_backend
    info "Tip: The backend reloads .env on restart — new API keys are now active."
    ;;
  frontend|gui|ui)
    restart_frontend
    ;;
  mcp|agents)
    restart_mcp
    ;;
  ollama|llm)
    restart_ollama
    ;;
  all)
    restart_all
    ;;
  *)
    echo "Usage: $0 [backend|frontend|mcp|ollama|all]"
    echo
    echo "  backend   Restart the FastAPI backend (picks up .env changes)"
    echo "  frontend  Restart the React GUI"
    echo "  mcp       Restart all 3 MCP agents"
    echo "  ollama    Restart the local LLM server"
    echo "  all       Restart everything (default)"
    exit 1
    ;;
esac
