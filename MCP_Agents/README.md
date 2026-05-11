# Artifact MCP - Cluster Rebuild and Debug Guide

This folder contains the Artifact MCP server used to generate kind cluster config YAML files and (optionally) deploy clusters from those generated artifacts.

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

- `ChatBox.jsx`: provider-based LLM chat (`openai`/`gemini`) via `/api/chat`
- `GreenfieldPanel.jsx`: release-based cluster deployment and delete actions
- `BrownfieldPanel.jsx`: cluster deviation analysis and release-to-release diff
- `AppDeviationPanel.jsx`: application-level deviation detection (image, replicas) for apps deployed on clusters

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
  - Choose provider and key
  - Send a test prompt and confirm assistant reply

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
