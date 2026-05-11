# Kubernetes Deviation Dashboard

A full-stack Kubernetes deviation management platform with cluster and application lifecycle tracking, brownfield deviation analysis, and AI-powered chat assistant.

## Pre-Requisites

Before running this project, ensure the following are installed and configured:

### 1. System Requirements

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| **WSL2 (Ubuntu)** | 22.04 or 24.04 | `wsl --list --verbose` (from Windows) |
| **Docker Desktop** | Latest | `docker --version` |
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **Python** | 3.10+ | `python3 --version` |
| **kind** | 0.20+ | `kind --version` |
| **kubectl** | 1.27+ | `kubectl version --client` |

### 2. Python Virtual Environment

```bash
# Create venv (one-time)
python3 -m venv ~/.venvs/artifact-mcp

# Activate
source ~/.venvs/artifact-mcp/bin/activate

# Install dependencies
pip install mcp fastapi uvicorn httpx python-dotenv
```

### 3. Environment File (`.env`)

API keys and LLM config are loaded from a `.env` file at the project root. This file is **gitignored** and never committed.

```bash
# Create from template
cp .env.example .env
```

Edit `.env` and fill in the providers you want to use:

```env
# OpenAI — get key from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-...

# Google Gemini — get key from https://aistudio.google.com/apikey
GEMINI_API_KEY=AIza...

# Local LLM (Ollama) — no key needed, just the URL
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

> **Note:** At least one provider must be configured for the AI chat to work. The local Ollama option requires no API key but needs Ollama installed (see below).

### 4. Ollama (Optional — for local LLM)

```bash
# Install Ollama
sudo apt-get install -y zstd   # required dependency
curl -fsSL https://ollama.com/install.sh | sh

# Pull the Gemma 3 1B model (lightweight, fast on CPU)
ollama pull gemma3:1b

# Start Ollama (runs on port 11434)
ollama serve
```

### 5. kind Clusters

Clusters are created via the Greenfield tab in the UI or via CLI:

```bash
cd MCP_Agents
python3 Artifact_mcp.py deploy \
  --input cluster_input.json \
  --output-dir ./generated-kind-configs \
  --recreate --verbose
```

---

## Project Structure

This project contains the Artifact MCP server used to generate kind cluster config YAML files and (optionally) deploy clusters from those generated artifacts.

## Files

- `Artifact_mcp.py`: MCP/CLI server script
- `cluster_input.json`: expected input
- `cluster_input_new.json`: candidate input for deviation checks
- `generated-kind-configs/`: generated YAML output
- `artifact_mcp.log`: MCP server runtime log

## Quick Health Checks

Check if kind clusters exist:

```bash
kind get clusters
```

Check node readiness for all clusters:

```bash
for c in c1 c2 c3 c4; do
  echo "=== kind-$c ==="
  kubectl --context kind-$c get nodes -o wide || true
done
```

Check Artifact MCP server process and endpoint:

```bash
pgrep -af "Artifact_mcp.py serve" || true
curl -I http://127.0.0.1:8765/sse
```

## Generate Config Files

```bash
python3 Artifact_mcp.py generate \
  --input cluster_input.json \
  --output-dir ./generated-kind-configs
```

## Deploy/Rebuild Clusters with Live Debug Output

Use `--verbose` to print progress messages for each step:

```bash
python3 Artifact_mcp.py deploy \
  --input cluster_input.json \
  --output-dir ./generated-kind-configs \
  --recreate \
  --verbose
```

What `--verbose` shows:

- cluster start banner
- delete step (when `--recreate` is used)
- create step and streamed kind output
- resource limit update step
- per-cluster success/failure
- final summary

## Save Progress Logs to a File

```bash
python3 Artifact_mcp.py deploy \
  --input cluster_input.json \
  --output-dir ./generated-kind-configs \
  --recreate \
  --verbose 2>&1 | tee rebuild.log
```

## Common Recovery Steps

If API server is unreachable (`connection refused`):

1. Ensure Docker is running and accessible.
2. Rebuild clusters from input file.
3. Re-check contexts and node status.

Commands:

```bash
python3 Artifact_mcp.py deploy \
  --input cluster_input.json \
  --output-dir ./generated-kind-configs \
  --recreate \
  --verbose
```

If Docker permission errors appear:

```bash
sudo chmod 666 /var/run/docker.sock
```

## Deviation Check Example

Compare expected and candidate inputs:

```bash
diff -u cluster_input.json cluster_input_new.json
```

Then regenerate/deploy only after deviations are approved.

## Web Dashboard (React + FastAPI)

The web UI is now available and wired to Deployment/Deviation logic.

- Frontend: `../webapp` (Vite on port 3000)
- Backend: `../webapp/backend/main.py` (FastAPI on port 8000)
- MCP logic imported directly from this folder (`MCP_Agents`)

### Components Implemented

- `ClusterPanel.jsx`: top-level Clusters tab with Greenfield/Brownfield sub-tabs
- `GreenfieldPanel.jsx`: release-based cluster deployment and delete actions
- `BrownfieldPanel.jsx`: cluster deviation analysis and release-to-release diff
- `AppDeviationPanel.jsx`: top-level Applications tab with Greenfield/Brownfield sub-tabs
- `AppGreenfieldPanel.jsx`: release-based application deployment with release badge detection
- `AppBrownfieldPanel.jsx`: application deviation scan, per-app fix, and bulk "Fix All"
- `ChatBox.jsx`: AI assistant chat — provider selection (no API keys on the UI)

### Start All Services (All-in-One)

From project root (`/home/esudbat/KubernetesDeviationProject`):

```bash
chmod +x ./start.sh
./start.sh
```

What `start.sh` does:

1. Creates runtime directories (`.run`, `.logs`)
2. Installs frontend dependencies if needed
3. Starts or skips (if already running):
  - Artifact MCP (`127.0.0.1:8765`)
  - Deployment MCP (`127.0.0.1:8766`)
  - Deviation MCP (`127.0.0.1:8767`)
  - Backend API (`127.0.0.1:8000`)
  - Frontend Web (`127.0.0.1:3000`)
4. Prints endpoint status codes for each service

Example status lines:

```text
[SKIP] artifact_mcp already listening on port 8765
[START] frontend_web on port 3000
[OK] frontend_web started (pid=...)
- Backend releases -> 200
- Frontend -> 200
- Artifact MCP SSE -> 200
```

### Verify Each Service Is Running

Run these checks from anywhere:

```bash
# Ports
ss -ltnp | grep -E '(:3000|:8000|:8765|:8766|:8767)'

# Backend API
curl -s -o /dev/null -w 'backend /api/releases: %{http_code}\n' http://127.0.0.1:8000/api/releases
curl -s -o /dev/null -w 'backend /api/clusters: %{http_code}\n' http://127.0.0.1:8000/api/clusters

# Frontend
curl -s -o /dev/null -w 'frontend /: %{http_code}\n' http://127.0.0.1:3000/

# MCP servers (SSE endpoints)
curl -s -I -o /dev/null -w 'artifact_mcp /sse: %{http_code}\n' http://127.0.0.1:8765/sse
curl -s -I -o /dev/null -w 'deployment_mcp /sse: %{http_code}\n' http://127.0.0.1:8766/sse
curl -s -I -o /dev/null -w 'deviation_mcp /sse: %{http_code}\n' http://127.0.0.1:8767/sse
```

Expected result: HTTP `200` for all checks.

### Verify Web UI End-to-End

Open UI at: `http://localhost:3000`

Quick UI validation flow:

1. **Greenfield tab**
  - Click Refresh in Running Clusters
  - Confirm `c1/c2/c3` appear with versions
2. **Brownfield tab**
  - Select cluster and target release
  - Click Analyze Deviations and confirm report appears
3. **Applications tab**
  - Select cluster, app `nginx`, target release
  - Click Analyze App Deviation
  - Confirm compliance/deviation with remediation output
4. **Chat panel**
  - Select a provider from the dropdown (shows ✓ if configured)
  - Send a test prompt and confirm assistant reply

### AI Chat / LLM Configuration

API keys are **never exposed on the web UI**. They are loaded server-side from a `.env` file at the project root.

#### Supported Providers

| Provider | Model (default) | Requires |
|----------|----------------|----------|
| OpenAI (GPT) | `gpt-4o-mini` | `OPENAI_API_KEY` in `.env` |
| Google Gemini | `gemini-2.5-flash` | `GEMINI_API_KEY` in `.env` |
| Local LLM (Gemma/Ollama) | `gemma3:4b` | Ollama running locally |

#### Setup Steps

1. **Copy the example env file**:

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** and add your keys (this file is gitignored):

   ```bash
   # OpenAI — get key from https://platform.openai.com/api-keys
   OPENAI_API_KEY=sk-proj-...

   # Google Gemini — get key from https://aistudio.google.com/apikey
   GEMINI_API_KEY=AIza...

   # Local LLM (Ollama) — no key needed, just the URL
   OLLAMA_BASE_URL=http://127.0.0.1:11434
   ```

3. **For local LLM (Gemma via Ollama)**:

   ```bash
   # Install Ollama (if not already installed)
   curl -fsSL https://ollama.com/install.sh | sh

   # Pull the Gemma 3 4B model
   ollama pull gemma3:4b

   # Start Ollama server (if not already running)
   ollama serve
   ```

4. **Restart the backend** to pick up new keys:

   ```bash
   # If using start.sh, kill the old backend and re-run
   kill $(cat .run/backend_api.pid) 2>/dev/null
   ./start.sh
   ```

5. **Verify providers** in the UI:
   - Open `http://localhost:3000`
   - In the Chat panel, the dropdown shows `✓` next to configured providers
   - Unconfigured providers show `(not configured)`

#### Security Notes

- `.env` is in `.gitignore` — it is **never committed** to git
- `.env.example` is committed as a template (no real keys)
- API keys are only used server-side in the FastAPI backend
- The browser never sees or sends API keys
- The `/api/chat/providers` endpoint only returns readiness status, not keys

### Service Logs

`start.sh` writes logs here:

```bash
ls -lah /home/esudbat/KubernetesDeviationProject/.logs
tail -n 80 /home/esudbat/KubernetesDeviationProject/.logs/backend_api.log
tail -n 80 /home/esudbat/KubernetesDeviationProject/.logs/frontend_web.log
tail -n 80 /home/esudbat/KubernetesDeviationProject/.logs/artifact_mcp.log
tail -n 80 /home/esudbat/KubernetesDeviationProject/.logs/deployment_mcp.log
tail -n 80 /home/esudbat/KubernetesDeviationProject/.logs/deviation_mcp.log
```

### Common Web Troubleshooting

If backend fails with import error:

```text
ImportError: cannot import name 'compare_releases' from 'releases'
```

Fix: ensure `webapp/backend/main.py` imports `compare_releases` from `Deviation_mcp`, not from `releases.py`.

If frontend appears stuck during install, verify completion with:

```bash
cd /home/esudbat/KubernetesDeviationProject/webapp
ls node_modules | wc -l
npm list --depth=0
```

If clusters are listed but API is unreachable after reboot, restart control-plane containers:

```bash
docker start c1-control-plane c2-control-plane c3-control-plane || true
```

## Application Deviation Management

Beyond cluster versions, the system now tracks application versions and state across releases.

### Release Application Baselines

Each release (R1-R4) defines expected applications and their versions. For example:

```
R1: nginx 1.24.0 (2 replicas)
R2: nginx 1.25.0 (2 replicas)
R3: nginx 1.26.0 (3 replicas)
R4: nginx 1.27.0 (3 replicas)
```

### Application Deviation Checks

Detects and reports:

- **Image mismatch**: wrong nginx version deployed (severity: CRITICAL if major version diff, WARNING if patch)
- **Replica mismatch**: wrong number of instances running
- **App not found**: application not deployed in expected namespace
- Automatic remediation commands to fix each issue

### API Endpoints for Apps

```bash
# Analyze app deviation in cluster vs target release
curl -X POST http://127.0.0.1:8000/api/apps/deviation \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_name": "c1",
    "app_name": "nginx",
    "target_release": "R4"
  }'

# Deploy an app to a cluster
curl -X POST http://127.0.0.1:8000/api/apps/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_name": "c1",
    "app_spec": {
      "name": "nginx",
      "namespace": "default",
      "image": "nginx:1.27.0",
      "replicas": 3
    }
  }'

# Upgrade app image
curl -X POST http://127.0.0.1:8000/api/apps/upgrade \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_name": "c1",
    "app_name": "nginx",
    "namespace": "default",
    "new_image": "nginx:1.27.1"
  }'

# Scale app
curl -X POST http://127.0.0.1:8000/api/apps/scale \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_name": "c1",
    "app_name": "nginx",
    "namespace": "default",
    "replicas": 5
  }'
```

### UI: Applications Tab

The web dashboard includes an **Applications** tab (third tab in Brownfield section) where you can:

- Select a cluster and application
- Pick a target release baseline
- Analyze deviations vs that release
- See live remediation commands
- Identify upgrade paths for apps across releases

---

## Restarting Services

Use `restart.sh` to restart individual services or everything at once. This is the go-to when you update `.env`, change frontend code, or need to bounce a service.

### After Updating `.env` (API Keys / LLM Config)

The backend reads `.env` at startup. After editing it, restart just the backend:

```bash
./restart.sh backend
```

The frontend does **not** need a restart — it fetches provider status from the backend on page load. Just **refresh the browser** after restarting the backend.

### Restart Commands

```bash
./restart.sh backend      # Restart backend API only (picks up .env changes)
./restart.sh frontend     # Restart frontend / React GUI only
./restart.sh mcp          # Restart all 3 MCP agents
./restart.sh ollama       # Restart Ollama (local LLM)
./restart.sh              # Restart ALL services
```

Each command stops the old process, clears stale PID files, and starts fresh.

---

## Troubleshooting: After Laptop / WSL Reboot

After a laptop reboot (or WSL restart), several services need to be recovered. Use the **one-command recovery script** or follow the manual steps below.

### One-Command Recovery

```bash
cd /home/esudbat/KubernetesDeviationProject
./recover.sh
```

This script automatically:

1. Checks and fixes Docker socket permissions
2. Restarts stopped kind cluster containers (`c1`, `c2`, `c3`)
3. Waits for Kubernetes API servers to become ready
4. Starts Ollama if installed (for local LLM)
5. Cleans stale PID files from previous sessions
6. Runs `start.sh` to bring up all services (MCP agents, backend, frontend)

### Manual Recovery Steps

If you prefer to recover manually, follow these steps in order:

#### 1. Fix Docker

```bash
# Docker Desktop users: open Docker Desktop from Windows and wait for it to start
# WSL2 users without Docker Desktop:
sudo service docker start
sudo chmod 666 /var/run/docker.sock
```

Verify: `docker ps` should work without errors.

#### 2. Restart kind Cluster Containers

After reboot, kind containers are stopped but still exist:

```bash
# Check status
docker ps -a --filter "name=control-plane" --format "{{.Names}}: {{.Status}}"

# Restart all cluster containers
docker start c1-control-plane c2-control-plane c3-control-plane

# Wait ~10 seconds for API servers to initialize
sleep 10

# Verify connectivity
for c in c1 c2 c3; do
  kubectl --context kind-$c get nodes || echo "$c: NOT READY"
done
```

#### 3. Start Ollama (if using local LLM)

```bash
# Check if running
curl -s http://127.0.0.1:11434/api/tags >/dev/null && echo "Ollama OK" || ollama serve &
```

#### 4. Start All Application Services

```bash
./start.sh
```

This starts MCP agents (ports 8765-8767), backend API (port 8000), and frontend (port 3000).

### Common Issues After Reboot

| Symptom | Cause | Fix |
|---------|-------|-----|
| `permission denied` on Docker commands | Docker socket permissions reset | `sudo chmod 666 /var/run/docker.sock` |
| `connection refused` on kubectl | kind containers are stopped | `docker start c1-control-plane c2-control-plane c3-control-plane` |
| Backend fails to start | Stale PID file | `rm -f .run/*.pid` then `./start.sh` |
| Port already in use | Zombie process from before reboot | `kill $(lsof -t -i:PORT)` then retry |
| Chat shows "not configured" | `.env` file missing or empty | `cp .env.example .env` and fill in keys |
| Chat provider not picking up new API key | Backend needs restart after `.env` edit | `./restart.sh backend` |
| Frontend not reflecting changes | Stale browser cache or frontend not restarted | `./restart.sh frontend` and hard-refresh browser (Ctrl+Shift+R) |
| Ollama chat times out on first message | Model cold start (loading into memory) | Wait ~30s and retry; first request is always slow on CPU |
| `kind get clusters` returns empty | Containers were deleted (not just stopped) | Redeploy via Greenfield tab or `python3 Artifact_mcp.py deploy ...` |

### Verify Everything Is Working

```bash
# Quick health check after recovery
echo "=== Docker ===" && docker ps --format "{{.Names}}: {{.Status}}" | grep control-plane
echo "=== Kubernetes ===" && for c in c1 c2 c3; do kubectl --context kind-$c get nodes -o wide 2>/dev/null || echo "$c: down"; done
echo "=== Services ===" && for p in 3000 8000 8765 8766 8767; do ss -ltn | grep -q ":$p " && echo "Port $p: UP" || echo "Port $p: DOWN"; done
echo "=== Ollama ===" && curl -s http://127.0.0.1:11434/api/tags | head -c 50 2>/dev/null || echo "Not running"
```
