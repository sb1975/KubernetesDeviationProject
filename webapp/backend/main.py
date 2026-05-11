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

# Add MCP_Agents to path so we can import agent logic directly
MCP_AGENTS = Path(__file__).parent.parent.parent / "MCP_Agents"
sys.path.insert(0, str(MCP_AGENTS))

from releases import RELEASES, RELEASE_ORDER  # noqa: E402
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


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    provider: str = "openai"   # "openai" or "gemini"
    api_key: str
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


# ─── Clusters ─────────────────────────────────────────────────────────────────

@app.get("/api/clusters")
def api_cluster_status() -> dict[str, Any]:
    return get_cluster_status()


# ─── Greenfield — deploy ──────────────────────────────────────────────────────

@app.post("/api/greenfield/deploy")
def api_deploy(body: DeployRequest) -> dict[str, Any]:
    return deploy_cluster(
        cluster_name=body.cluster_name,
        release=body.release,
        pod_subnet=body.pod_subnet,
        service_subnet=body.service_subnet,
        host_port=body.host_port,
        recreate=body.recreate,
        verbose=body.verbose,
    )


@app.delete("/api/greenfield/cluster/{cluster_name}")
def api_delete_cluster(cluster_name: str) -> dict[str, Any]:
    return delete_cluster(cluster_name)


# ─── Brownfield — deviation ────────────────────────────────────────────────────

@app.post("/api/brownfield/analyze")
def api_analyze(body: DeviationRequest) -> dict[str, Any]:
    return analyze_cluster_deviation(body.cluster_name, body.target_release)


@app.get("/api/brownfield/scan/{target_release}")
def api_scan(target_release: str) -> dict[str, Any]:
    return scan_all_clusters(target_release)


# ─── Chat — LLM proxy ─────────────────────────────────────────────────────────

@app.post("/api/chat")
async def api_chat(body: ChatRequest) -> dict[str, Any]:
    if body.provider == "openai":
        model = body.model or "gpt-4o-mini"
        payload = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in body.messages],
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {body.api_key}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        data = resp.json()
        return {"reply": data["choices"][0]["message"]["content"]}

    elif body.provider == "gemini":
        model = body.model or "gemini-1.5-flash"
        # Convert messages to Gemini format
        contents = []
        for m in body.messages:
            role = "user" if m.role == "user" else "model"
            contents.append({"role": role, "parts": [{"text": m.content}]})

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={body.api_key}"
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

    raise HTTPException(status_code=400, detail=f"Unknown provider '{body.provider}'")


# ─── Applications ─────────────────────────────────────────────────────────────

@app.post("/api/apps/deploy")
def api_deploy_app(body: AppDeployRequest) -> dict[str, Any]:
    return deploy_app(body.cluster_name, body.app_spec, body.verbose)


@app.post("/api/apps/upgrade")
def api_upgrade_app(body: AppUpgradeRequest) -> dict[str, Any]:
    return upgrade_app(
        body.cluster_name,
        body.app_name,
        body.namespace,
        body.new_image,
        body.verbose,
    )


@app.post("/api/apps/scale")
def api_scale_app(body: AppScaleRequest) -> dict[str, Any]:
    return scale_app(
        body.cluster_name,
        body.app_name,
        body.namespace,
        body.replicas,
        body.verbose,
    )


@app.post("/api/apps/deviation")
def api_app_deviation(body: AppDeviationRequest) -> dict[str, Any]:
    return analyze_app_deviation(
        body.cluster_name,
        body.app_name,
        body.target_release,
    )


@app.post("/api/apps/scan")
def api_scan_apps(body: AppScanRequest) -> dict[str, Any]:
    return scan_cluster_apps(body.cluster_name, body.target_release)


@app.get("/api/apps/list/{cluster_name}")
def api_list_apps(cluster_name: str, namespace: str = "default") -> dict[str, Any]:
    return list_apps_in_cluster(cluster_name, namespace)


@app.post("/api/apps/fix")
def api_fix_app(body: AppFixRequest) -> dict[str, Any]:
    return fix_app(
        body.cluster_name,
        body.app_name,
        body.namespace,
        body.expected_image,
        body.expected_replicas,
        body.app_found,
    )


# ─── Serve built React static files if present ────────────────────────────────

DIST = Path(__file__).parent.parent / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
