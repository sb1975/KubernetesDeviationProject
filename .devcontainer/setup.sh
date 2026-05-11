#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# .devcontainer/setup.sh — Runs automatically when Codespace is created
#
# Installs kind, creates Python venv, installs dependencies, sets up .env
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
info() { echo -e "${YELLOW}[INFO]${NC}  $1"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.venvs/artifact-mcp"

echo "============================================="
echo " Kubernetes Deviation Dashboard — Setup"
echo "============================================="
echo

# ── 1. Install kind ──────────────────────────────────────────────────────────
info "Installing kind..."
if command -v kind >/dev/null 2>&1; then
  ok "kind already installed: $(kind --version)"
else
  KIND_VERSION="v0.23.0"
  ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
  curl -fsSL -o /tmp/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${ARCH}"
  chmod +x /tmp/kind
  sudo mv /tmp/kind /usr/local/bin/kind
  ok "kind installed: $(kind --version)"
fi

# ── 2. Python virtual environment ───────────────────────────────────────────
info "Setting up Python venv at $VENV_DIR..."
if [[ -x "$VENV_DIR/bin/python3" ]]; then
  ok "Python venv already exists"
else
  python3 -m venv "$VENV_DIR"
  ok "Created Python venv"
fi

info "Installing Python dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet mcp fastapi uvicorn httpx python-dotenv
ok "Python dependencies installed"

# ── 3. Frontend dependencies ────────────────────────────────────────────────
info "Installing frontend (npm) dependencies..."
(cd "$ROOT_DIR/webapp" && npm install --silent)
ok "Frontend dependencies installed"

# ── 4. Environment file ─────────────────────────────────────────────────────
if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  info "Created .env from template — edit it to add your API keys"
  info "  File: $ROOT_DIR/.env"
  info "  Then run: ./restart.sh backend"
else
  ok ".env file already exists"
fi

# ── 5. Make scripts executable ───────────────────────────────────────────────
chmod +x "$ROOT_DIR/start.sh" "$ROOT_DIR/restart.sh" "$ROOT_DIR/recover.sh"
ok "Scripts are executable"

echo
echo "============================================="
echo " Setup complete!"
echo ""
echo " Next steps:"
echo "   1. Edit .env to add your API keys (OpenAI / Gemini)"
echo "   2. Run: ./start.sh"
echo "   3. Open the forwarded port 3000 in your browser"
echo "============================================="
