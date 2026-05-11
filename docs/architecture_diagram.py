#!/usr/bin/env python3
"""
Generate architecture diagram for the Kubernetes Deviation Dashboard.
Requires: pip install diagrams, apt install graphviz

Usage:
    python3 docs/architecture_diagram.py
    # Outputs: docs/architecture.png
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.k8s.compute import Pod, Deploy
from diagrams.k8s.group import NS
from diagrams.onprem.container import Docker
from diagrams.onprem.client import User
from diagrams.programming.framework import React, FastAPI
from diagrams.programming.language import Python, JavaScript
from diagrams.onprem.network import Nginx
from diagrams.generic.storage import Storage
from diagrams.generic.compute import Rack
from diagrams.custom import Custom
import os

DOCS_DIR = os.path.dirname(os.path.abspath(__file__))

graph_attr = {
    "fontsize": "20",
    "fontname": "Helvetica",
    "bgcolor": "#0d1117",
    "fontcolor": "#c9d1d9",
    "pad": "0.8",
    "nodesep": "0.8",
    "ranksep": "1.2",
    "splines": "ortho",
}

node_attr = {
    "fontsize": "11",
    "fontname": "Helvetica",
    "fontcolor": "#c9d1d9",
}

edge_attr = {
    "color": "#58a6ff",
    "fontcolor": "#8b949e",
    "fontsize": "9",
    "fontname": "Helvetica",
}

with Diagram(
    "Kubernetes Deviation Dashboard",
    filename=os.path.join(DOCS_DIR, "architecture"),
    show=False,
    direction="TB",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
    outformat="png",
):
    user = User("Browser\nUser")

    with Cluster("Frontend (React + Vite)\nPort 3000", graph_attr={"bgcolor": "#161b2299", "pencolor": "#58a6ff", "fontcolor": "#58a6ff", "style": "rounded"}):
        ui_clusters = React("ClusterPanel")
        ui_apps = React("AppDeviationPanel")
        ui_chat = JavaScript("ChatBox\n(AI Assistant)")
        ui_gf = React("GreenfieldPanel")
        ui_bf = React("BrownfieldPanel")
        ui_agf = React("AppGreenfieldPanel")
        ui_abf = React("AppBrownfieldPanel")

    with Cluster("Backend API (FastAPI)\nPort 8000", graph_attr={"bgcolor": "#161b2299", "pencolor": "#3fb950", "fontcolor": "#3fb950", "style": "rounded"}):
        api = FastAPI("main.py\n/api/*")
        env = Storage(".env\n(API Keys)")

    with Cluster("MCP Agents (SSE Transport)", graph_attr={"bgcolor": "#161b2299", "pencolor": "#d29922", "fontcolor": "#d29922", "style": "rounded"}):
        artifact = Python("Artifact MCP\n:8765")
        deployment = Python("Deployment MCP\n:8766")
        deviation = Python("Deviation MCP\n:8767")

    with Cluster("Release Catalog", graph_attr={"bgcolor": "#161b2299", "pencolor": "#bc8cff", "fontcolor": "#bc8cff", "style": "rounded"}):
        cluster_rel = Storage("cluster_release.json\nR1→R4 k8s versions")
        app_rel = Storage("application_release.json\nR1→R4 app baselines")
        releases_py = Python("releases.py\n(Loader)")

    with Cluster("Kind Clusters (Docker)", graph_attr={"bgcolor": "#161b2299", "pencolor": "#f85149", "fontcolor": "#f85149", "style": "rounded"}):
        c1 = Docker("c1\nk8s 1.30 (R4)")
        c2 = Docker("c2\nk8s 1.29 (R3)")
        c3 = Docker("c3\nk8s 1.28 (R2)")

    with Cluster("LLM Providers", graph_attr={"bgcolor": "#161b2299", "pencolor": "#da3633", "fontcolor": "#da3633", "style": "rounded"}):
        openai = Rack("OpenAI\nGPT-4o-mini")
        gemini = Rack("Google Gemini\n2.5 Flash")
        ollama = Rack("Ollama\nGemma 3 1B")

    # User → Frontend
    user >> Edge(label="HTTP", color="#58a6ff") >> ui_clusters
    user >> Edge(color="#58a6ff") >> ui_apps
    user >> Edge(color="#58a6ff") >> ui_chat

    # Cluster tab sub-panels
    ui_clusters >> Edge(color="#30363d", style="dashed") >> ui_gf
    ui_clusters >> Edge(color="#30363d", style="dashed") >> ui_bf

    # App tab sub-panels
    ui_apps >> Edge(color="#30363d", style="dashed") >> ui_agf
    ui_apps >> Edge(color="#30363d", style="dashed") >> ui_abf

    # Frontend → Backend
    ui_gf >> Edge(label="/api/greenfield/*", color="#3fb950") >> api
    ui_bf >> Edge(label="/api/brownfield/*", color="#3fb950") >> api
    ui_agf >> Edge(label="/api/apps/deploy", color="#3fb950") >> api
    ui_abf >> Edge(label="/api/apps/scan,fix", color="#3fb950") >> api
    ui_chat >> Edge(label="/api/chat", color="#3fb950") >> api

    # Backend → .env
    api >> Edge(color="#8b949e", style="dotted", label="loads keys") >> env

    # Backend → MCP Agents
    api >> Edge(label="generate/deploy", color="#d29922") >> artifact
    api >> Edge(label="deploy/list/fix", color="#d29922") >> deployment
    api >> Edge(label="analyze/scan", color="#d29922") >> deviation

    # MCP → Release Catalog
    artifact >> Edge(color="#bc8cff", style="dashed") >> releases_py
    deployment >> Edge(color="#bc8cff", style="dashed") >> releases_py
    deviation >> Edge(color="#bc8cff", style="dashed") >> releases_py
    releases_py >> Edge(color="#bc8cff", style="dotted") >> cluster_rel
    releases_py >> Edge(color="#bc8cff", style="dotted") >> app_rel

    # MCP → Kind Clusters
    artifact >> Edge(label="kind create", color="#f85149") >> c1
    deployment >> Edge(label="kubectl apply", color="#f85149") >> c1
    deployment >> Edge(color="#f85149") >> c2
    deployment >> Edge(color="#f85149") >> c3
    deviation >> Edge(label="kubectl get", color="#f85149") >> c1
    deviation >> Edge(color="#f85149") >> c2
    deviation >> Edge(color="#f85149") >> c3

    # Backend → LLM
    api >> Edge(label="chat", color="#da3633") >> openai
    api >> Edge(color="#da3633") >> gemini
    api >> Edge(color="#da3633") >> ollama
