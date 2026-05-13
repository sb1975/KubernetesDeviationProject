#!/usr/bin/env python3
"""Cluster registry — track created clusters in JSON."""

import json
from pathlib import Path
from typing import List, Any

CLUSTERS_FILE = Path(__file__).parent / "input" / "clusters.json"

DEFAULT_SCHEMA = {
    "schema_version": "1.0",
    "clusters": []
}


def _ensure_file() -> None:
    """Create clusters.json if it doesn't exist."""
    if not CLUSTERS_FILE.exists():
        CLUSTERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with CLUSTERS_FILE.open("w") as f:
            json.dump(DEFAULT_SCHEMA, f, indent=2)


def get_clusters() -> List[str]:
    """Return list of tracked cluster names."""
    _ensure_file()
    try:
        with CLUSTERS_FILE.open("r") as f:
            data = json.load(f)
            return data.get("clusters", [])
    except (json.JSONDecodeError, IOError):
        return []


def add_cluster(cluster_name: str) -> None:
    """Add cluster name to registry."""
    _ensure_file()
    try:
        with CLUSTERS_FILE.open("r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        data = DEFAULT_SCHEMA.copy()
    
    if cluster_name not in data.get("clusters", []):
        data.setdefault("clusters", []).append(cluster_name)
        with CLUSTERS_FILE.open("w") as f:
            json.dump(data, f, indent=2)


def remove_cluster(cluster_name: str) -> None:
    """Remove cluster name from registry."""
    _ensure_file()
    try:
        with CLUSTERS_FILE.open("r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return
    
    clusters = data.get("clusters", [])
    if cluster_name in clusters:
        clusters.remove(cluster_name)
        with CLUSTERS_FILE.open("w") as f:
            json.dump(data, f, indent=2)


def clear_clusters() -> None:
    """Clear all cluster names from registry."""
    with CLUSTERS_FILE.open("w") as f:
        json.dump(DEFAULT_SCHEMA, f, indent=2)


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: cluster_registry.py [add|remove|list|clear] [cluster_name]")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "add" and len(sys.argv) > 2:
        add_cluster(sys.argv[2])
        print(f"Added cluster: {sys.argv[2]}")
    elif cmd == "remove" and len(sys.argv) > 2:
        remove_cluster(sys.argv[2])
        print(f"Removed cluster: {sys.argv[2]}")
    elif cmd == "list":
        clusters = get_clusters()
        for cluster in clusters:
            print(cluster)
    elif cmd == "clear":
        clear_clusters()
        print("Cleared clusters")
    else:
        print("Invalid command or missing arguments")
        sys.exit(1)
