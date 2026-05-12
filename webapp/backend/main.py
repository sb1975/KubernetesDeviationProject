#!/usr/bin/env python3
"""FastAPI backend — bridges React webapp to MCP agents."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx

# Load .env from project root (keys stay local, never sent to browser)
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"
if _ENV_FILE.exists():
    with _ENV_FILE.open() as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _v = _v.strip().strip('"').strip("'")
                os.environ.setdefault(_k.strip(), _v)

# Add MCP_Agents to path so we can import agent logic directly
MCP_AGENTS = Path(__file__).parent.parent.parent / "MCP_Agents"
sys.path.insert(0, str(MCP_AGENTS))

from releases import RELEASES, RELEASE_ORDER, update_release_definition  # noqa: E402
from Deployment_mcp import (  # noqa: E402
    get_releases,
    get_cluster_status,
    deploy_cluster,
    delete_cluster,
    deploy_app,
    upgrade_app,
    scale_app,
    list_apps_in_cluster,
    fix_app,
)
from Deviation_mcp import (  # noqa: E402
    analyze_cluster_deviation,
    scan_all_clusters,
    compare_releases,
    analyze_app_deviation,
    scan_cluster_apps,
)

app = FastAPI(title="K8s Deviation Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request models ───────────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    cluster_name: str
    release: str
    pod_subnet: str = "10.244.0.0/16"
    service_subnet: str = "10.96.0.0/12"
    host_port: int = 30000
    recreate: bool = False
    verbose: bool = False


class DeviationRequest(BaseModel):
    cluster_name: str
    target_release: str


class ReleaseDiffRequest(BaseModel):
    from_release: str
    to_release: str


class ReleaseAppSpec(BaseModel):
    name: str
    namespace: str = "default"
    kind: str = "Deployment"
    image: str
    replicas: int
    service_type: str = "ClusterIP"
    service_port: int


class ReleaseUpdateRequest(BaseModel):
    kubernetes_version: str
    kind_image: str
    cpus: float
    memory: str
    description: str
    changes: list[str] = []
    applications: list[ReleaseAppSpec] | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    provider: str = "openai"   # "openai", "gemini", or "local"
    model: str | None = None


class AppDeployRequest(BaseModel):
    cluster_name: str
    app_spec: dict[str, Any]
    verbose: bool = False


class AppUpgradeRequest(BaseModel):
    cluster_name: str
    app_name: str
    namespace: str = "default"
    new_image: str
    verbose: bool = False


class AppScaleRequest(BaseModel):
    cluster_name: str
    app_name: str
    namespace: str = "default"
    replicas: int
    verbose: bool = False


class AppDeviationRequest(BaseModel):
    cluster_name: str
    app_name: str
    target_release: str


class AppScanRequest(BaseModel):
    cluster_name: str
    target_release: str


class AppFixRequest(BaseModel):
    cluster_name: str
    app_name: str
    namespace: str = "default"
    expected_image: str
    expected_replicas: int
    app_found: bool


# ─── Releases ─────────────────────────────────────────────────────────────────

@app.get("/api/releases")
def api_get_releases() -> dict[str, Any]:
    return get_releases()


@app.post("/api/releases/diff")
def api_release_diff(body: ReleaseDiffRequest) -> dict[str, Any]:
    return compare_releases(body.from_release, body.to_release)


@app.put("/api/releases/{release_name}")
def api_update_release(release_name: str, body: ReleaseUpdateRequest) -> dict[str, Any]:
    try:
        updated = update_release_definition(
            release_name,
            cluster_fields={
                "name": release_name,
                "kubernetes_version": body.kubernetes_version,
                "kind_image": body.kind_image,
                "cpus": body.cpus,
                "memory": body.memory,
                "description": body.description,
                "changes": body.changes,
            },
            applications=[a.model_dump() for a in body.applications] if body.applications is not None else None,
        )
        return {"release": release_name, "updated": updated}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Clusters ─────────────────────────────────────────────────────────────────

@app.get("/api/clusters")
def api_cluster_status() -> dict[str, Any]:
    return get_cluster_status()


# ─── Greenfield — deploy ──────────────────────────────────────────────────────

@app.post("/api/greenfield/deploy")
def api_deploy(body: DeployRequest) -> dict[str, Any]:
    try:
        return deploy_cluster(
            cluster_name=body.cluster_name,
            release=body.release,
            pod_subnet=body.pod_subnet,
            service_subnet=body.service_subnet,
            host_port=body.host_port,
            recreate=body.recreate,
            verbose=body.verbose,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/greenfield/cluster/{cluster_name}")
def api_delete_cluster(cluster_name: str) -> dict[str, Any]:
    try:
        return delete_cluster(cluster_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Brownfield — deviation ────────────────────────────────────────────────────

@app.post("/api/brownfield/analyze")
def api_analyze(body: DeviationRequest) -> dict[str, Any]:
    try:
        return analyze_cluster_deviation(body.cluster_name, body.target_release)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/brownfield/scan/{target_release}")
def api_scan(target_release: str) -> dict[str, Any]:
    try:
        return scan_all_clusters(target_release)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Chat — LLM proxy ─────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are the built-in AI assistant for the **Kubernetes Deviation Dashboard**, \
a web application that manages multi-version Kubernetes clusters and their applications.

## Application Overview
This dashboard runs on WSL2 (Ubuntu) and manages "kind" (Kubernetes IN Docker) clusters \
across 4 release baselines (R1–R4), each pinned to a specific Kubernetes version:
  - R1 → k8s 1.27  |  R2 → k8s 1.28  |  R3 → k8s 1.29  |  R4 → k8s 1.30

## Architecture
- **Frontend**: React 18 + Vite on port 3000
- **Backend**: FastAPI on port 8000 (proxied from frontend via /api/*)
- **MCP Agents**: Artifact (8765), Deployment (8766), Deviation (8767) — SSE transport
- **Local LLM**: Ollama + TinyLlama on port 11434
- **Config files**: `input/` (deployment intent) and `release/` (baselines) directories under MCP_Agents/

## Two Main Tabs

### 🖥️ Clusters Tab
**Greenfield — Deploy**: Deploy new kind clusters by selecting a release (R1–R4) and configuring \
cluster name, subnets, and host port. Shows running clusters with version and release badge.
**Brownfield — Deviations**: Compare a running cluster against a target release to detect \
version, CPU, and memory deviations. Shows remediation commands. Also supports release-to-release diff.

### 📦 Applications Tab
**Greenfield — Deploy**: Select a cluster and release, then deploy applications (nginx, httpd, memcached) \
defined in that release. Shows currently deployed apps with release detection badges.
**Brownfield — Deviations**: Scan all apps defined in a release against what's actually running. \
Detects image mismatches, replica mismatches, and missing apps. Offers per-app "Fix" buttons and "Fix All".

## Release Application Baselines (per release)
Each release defines expected app versions. Examples for nginx:
  R1: nginx:1.24.0-alpine  |  R2: nginx:1.25.5-alpine  |  R3: nginx:1.26.2-alpine  |  R4: nginx:1.27.0-alpine
Other apps: httpd (2.4.57→2.4.60), memcached (1.6.21→1.6.29)

## Key Concepts
- **Greenfield**: First-time deployment of clusters or apps from scratch.
- **Brownfield**: Analyzing existing running clusters/apps against expected release baselines, \
  detecting deviations, and remediating them.
- **Deviation**: Any difference between what's running and what the release baseline specifies \
  (wrong k8s version, wrong image, wrong replica count, missing app, etc.)
- **Release badge**: UI shows which release a cluster or app matches based on its version/image.

## Common User Tasks
1. **Deploy a cluster**: Clusters tab → Greenfield → select release → fill form → Deploy
2. **Check cluster health**: Clusters tab → Greenfield → "Running Clusters" section
3. **Find deviations**: Clusters/Apps tab → Brownfield → select cluster + release → Scan/Analyze
4. **Fix app deviations**: Apps tab → Brownfield → Scan → click "Fix" or "Fix All"
5. **Deploy apps**: Apps tab → Greenfield → select cluster + release → check apps → Deploy

## Troubleshooting
- **"No clusters running"**: Check Docker is running, then run `./start.sh` or deploy via Greenfield.
- **Docker permission error**: Run `sudo chmod 666 /var/run/docker.sock`
- **Backend not responding**: Check `http://127.0.0.1:8000/api/releases` or restart with `./start.sh`
- **Service startup**: Use `./start.sh` from the project root to start all 6 services.
- **Logs**: Check `.logs/` directory (backend_api.log, frontend_web.log, etc.)

## CLI Commands
- `kind get clusters` — list running clusters
- `kubectl --context kind-<name> get nodes` — check cluster nodes
- `kubectl --context kind-<name> get deployments` — list deployed apps
- `./start.sh` — start all services (idempotent, skips running ones)

Be concise, practical, and helpful. Provide exact commands when relevant. \
When explaining UI steps, reference the tab names and button labels. \
If you don't know something specific about the running state, suggest the user \
check via the dashboard UI or relevant kubectl commands.\
"""

@app.get("/api/chat/providers")
def api_chat_providers() -> dict[str, Any]:
    """Return available LLM providers based on configured env keys."""
    providers = []
    if os.environ.get("OPENAI_API_KEY"):
        providers.append({"value": "openai", "label": "OpenAI (GPT)", "ready": True})
    else:
        providers.append({"value": "openai", "label": "OpenAI (GPT)", "ready": False})

    if os.environ.get("GEMINI_API_KEY"):
        providers.append({"value": "gemini", "label": "Google Gemini", "ready": True})
    else:
        providers.append({"value": "gemini", "label": "Google Gemini", "ready": False})

    # Local LLM (Ollama) — shown only if reachable
    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    ollama_ready = False
    try:
        import urllib.request
        req = urllib.request.Request(f"{ollama_url}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=2):
            ollama_ready = True
    except Exception:
        pass
    providers.append({"value": "local", "label": "Local LLM (TinyLlama/Ollama)", "ready": ollama_ready, "url": ollama_url})

    return {"providers": providers}


@app.post("/api/chat")
async def api_chat(body: ChatRequest) -> dict[str, Any]:
    # Prepend the system context so the LLM knows the app inside-out
    system_msg = ChatMessage(role="system", content=_SYSTEM_PROMPT)
    all_messages = [system_msg] + list(body.messages)

    if body.provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured in .env")
        model = body.model or "gpt-4o-mini"
        payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in all_messages],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()
        return {"reply": data["choices"][0]["message"]["content"]}

    elif body.provider == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=400, detail="GEMINI_API_KEY not configured in .env")
        model = body.model or "gemini-2.5-flash"
        contents = []
        for m in all_messages:
            role = "user" if m.role in ("user", "system") else "model"
            contents.append({"role": role, "parts": [{"text": m.content}]})

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        payload = {"contents": contents}
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()
        try:
            reply = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise HTTPException(status_code=500, detail=f"Unexpected Gemini response: {e}")
        return {"reply": reply}

    elif body.provider == "local":
        ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        model = body.model or os.environ.get("OLLAMA_MODEL", "tinyllama:latest")
        payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in all_messages],
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(f"{ollama_url}/api/chat", json=payload)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail=f"Cannot reach Ollama at {ollama_url}. Is it running? Try: ollama serve",
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()
        reply = data.get("message", {}).get("content", "")
        if not reply:
            raise HTTPException(status_code=500, detail="Empty response from Ollama")
        return {"reply": reply}

    raise HTTPException(status_code=400, detail=f"Unknown provider '{body.provider}'")


# ─── Applications ─────────────────────────────────────────────────────────────

@app.post("/api/apps/deploy")
def api_deploy_app(body: AppDeployRequest) -> dict[str, Any]:
    try:
        return deploy_app(body.cluster_name, body.app_spec, body.verbose)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/apps/upgrade")
def api_upgrade_app(body: AppUpgradeRequest) -> dict[str, Any]:
    try:
        return upgrade_app(
            body.cluster_name,
            body.app_name,
            body.namespace,
            body.new_image,
            body.verbose,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/apps/scale")
def api_scale_app(body: AppScaleRequest) -> dict[str, Any]:
    try:
        return scale_app(
            body.cluster_name,
            body.app_name,
            body.namespace,
            body.replicas,
            body.verbose,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/apps/deviation")
def api_app_deviation(body: AppDeviationRequest) -> dict[str, Any]:
    try:
        return analyze_app_deviation(
            body.cluster_name,
            body.app_name,
            body.target_release,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/apps/scan")
def api_scan_apps(body: AppScanRequest) -> dict[str, Any]:
    try:
        return scan_cluster_apps(body.cluster_name, body.target_release)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/apps/list/{cluster_name}")
def api_list_apps(cluster_name: str, namespace: str = "default") -> dict[str, Any]:
    try:
        return list_apps_in_cluster(cluster_name, namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/apps/fix")
def api_fix_app(body: AppFixRequest) -> dict[str, Any]:
    try:
        return fix_app(
            body.cluster_name,
            body.app_name,
            body.namespace,
            body.expected_image,
            body.expected_replicas,
            body.app_found,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Serve built React static files if present ────────────────────────────────

DIST = Path(__file__).parent.parent / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
