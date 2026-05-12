#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"

VENV_DIR="${VENV_DIR:-$HOME/.venvs/artifact-mcp}"
PYTHON_BIN="${PYTHON_BIN:-$VENV_DIR/bin/python3}"
UVICORN_BIN="${UVICORN_BIN:-$VENV_DIR/bin/uvicorn}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Missing required command: $1"
    exit 1
  fi
}

need_cmd ss
need_cmd curl
need_cmd npm
need_cmd kind
need_cmd kubectl
need_cmd docker

is_port_listening() {
  local port="$1"
  ss -ltn | grep -q ":${port} "
}

start_service() {
  local name="$1"
  local port="$2"
  local cmd="$3"
  local pid_file="$RUN_DIR/${name}.pid"
  local log_file="$LOG_DIR/${name}.log"

  if is_port_listening "$port"; then
    echo "[SKIP] $name already listening on port $port"
    return 0
  fi

  echo "[START] $name on port $port"
  nohup bash -lc "$cmd" >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"

  for _ in $(seq 1 25); do
    if is_port_listening "$port"; then
      echo "[OK] $name started (pid=$pid)"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] $name did not start. Check log: $log_file"
  return 1
}

echo "[INFO] Root: $ROOT_DIR"
echo "[INFO] Logs: $LOG_DIR"

# ── Auto-install missing dependencies ────────────────────────────────────────

# Python venv
if [[ ! -x "$PYTHON_BIN" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERROR] Python not found at $PYTHON_BIN and system python3 is unavailable"
    exit 1
  fi
  echo "[INFO] Python venv not found — creating at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
  PYTHON_BIN="$VENV_DIR/bin/python3"
fi

# Python packages
if ! "$PYTHON_BIN" -c "import mcp, fastapi, uvicorn, httpx" 2>/dev/null; then
  echo "[INFO] Installing Python packages..."
  "$(dirname "$PYTHON_BIN")/pip" install --quiet --upgrade pip
  "$(dirname "$PYTHON_BIN")/pip" install --quiet mcp fastapi uvicorn httpx python-dotenv
fi
UVICORN_BIN="$(dirname "$PYTHON_BIN")/uvicorn"

if [[ ! -x "$UVICORN_BIN" ]]; then
  echo "[ERROR] Uvicorn not found at $UVICORN_BIN"
  exit 1
fi

# kind
if ! command -v kind >/dev/null 2>&1; then
  echo "[INFO] Installing kind..."
  _ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
  curl -fsSL -o /tmp/kind "https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-${_ARCH}"
  chmod +x /tmp/kind
  sudo mv /tmp/kind /usr/local/bin/kind 2>/dev/null || { mkdir -p "$HOME/.local/bin"; mv /tmp/kind "$HOME/.local/bin/kind"; export PATH="$HOME/.local/bin:$PATH"; }
fi

# kubectl
if ! command -v kubectl >/dev/null 2>&1; then
  echo "[INFO] Installing kubectl..."
  _ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
  curl -fsSL -o /tmp/kubectl "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/${_ARCH}/kubectl"
  chmod +x /tmp/kubectl
  sudo mv /tmp/kubectl /usr/local/bin/kubectl 2>/dev/null || { mkdir -p "$HOME/.local/bin"; mv /tmp/kubectl "$HOME/.local/bin/kubectl"; export PATH="$HOME/.local/bin:$PATH"; }
fi

# Docker socket permissions (WSL2 / Codespaces)
if [[ -S /var/run/docker.sock ]]; then
  chmod 666 /var/run/docker.sock >/dev/null 2>&1 || sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
fi

# .env file
if [[ ! -f "$ROOT_DIR/.env" ]] && [[ -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "[INFO] Created .env from template — edit it to add API keys"
fi

# Frontend dependencies
echo "[INFO] Installing frontend dependencies (if needed)"
(
  cd "$ROOT_DIR/webapp"
  npm install --silent
)

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

start_service \
  "backend_api" \
  "8000" \
  "cd '$ROOT_DIR' && '$UVICORN_BIN' webapp.backend.main:app --host 127.0.0.1 --port 8000 --reload"

start_service \
  "frontend_web" \
  "3000" \
  "cd '$ROOT_DIR/webapp' && npm run dev -- --host 127.0.0.1 --port 3000"

echo
echo "[INFO] Service endpoint checks"
check_url() {
  local label="$1"
  local url="$2"
  local mode="${3:-get}"
  local code
  if [[ "$mode" == "head" ]]; then
    code="$(curl --max-time 5 -s -I -o /dev/null -w "%{http_code}" "$url" || true)"
  else
    code="$(curl --max-time 5 -s -o /dev/null -w "%{http_code}" "$url" || true)"
  fi
  echo "- $label -> $code ($url)"
}

check_url "Backend releases" "http://127.0.0.1:8000/api/releases"
check_url "Backend clusters" "http://127.0.0.1:8000/api/clusters"
check_url "Frontend" "http://127.0.0.1:3000/"
check_url "Artifact MCP SSE" "http://127.0.0.1:8765/sse" "head"
check_url "Deployment MCP SSE" "http://127.0.0.1:8766/sse" "head"
check_url "Deviation MCP SSE" "http://127.0.0.1:8767/sse" "head"

echo
echo "[DONE] All start attempts complete."
echo "Logs are under: $LOG_DIR"
