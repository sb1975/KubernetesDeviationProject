#!/usr/bin/env python3
"""Deployment MCP agent — deploy kind clusters from release definitions."""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from releases import RELEASES, RELEASE_ORDER, get_release

CONFIGS_BASE = Path(__file__).parent


def _ts() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _log(msg: str) -> None:
    print(f"[{_ts()}] {msg}", flush=True)


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _run_live(cmd: list[str], prefix: str) -> subprocess.CompletedProcess[str]:
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\n")
        lines.append(line + "\n")
        print(f"[{_ts()}] [{prefix}] {line}", flush=True)
    proc.wait()
    return subprocess.CompletedProcess(cmd, proc.returncode, "".join(lines), "")


# ─── Core functions ──────────────────────────────────────────────────────────

def get_releases() -> dict[str, Any]:
    """Return all available release definitions in order."""
    return {
        "releases": {r: RELEASES[r] for r in RELEASE_ORDER if r in RELEASES},
        "order": RELEASE_ORDER,
    }


def get_cluster_status() -> dict[str, Any]:
    """Return running kind clusters with their k8s version and readiness."""
    result = _run(["kind", "get", "clusters"])
    clusters = [c.strip() for c in result.stdout.strip().splitlines() if c.strip()]

    statuses: list[dict[str, Any]] = []
    for name in clusters:
        ctx = f"kind-{name}"
        ver_r = _run([
            "kubectl", "--context", ctx, "get", "nodes",
            "-o", "jsonpath={.items[0].status.nodeInfo.kubeletVersion}",
        ])
        version = ver_r.stdout.strip().lstrip("v") if ver_r.returncode == 0 else "unknown"

        node_r = _run(["kubectl", "--context", ctx, "get", "nodes", "--no-headers"])
        ready = node_r.returncode == 0 and "Ready" in node_r.stdout
        node_count = len([l for l in node_r.stdout.strip().splitlines() if l.strip()]) if node_r.returncode == 0 else 0

        # Container runtime and OS image
        runtime_r = _run([
            "kubectl", "--context", ctx, "get", "nodes",
            "-o", "jsonpath={.items[0].status.nodeInfo.containerRuntimeVersion}",
        ])
        container_runtime = runtime_r.stdout.strip() if runtime_r.returncode == 0 else "unknown"

        os_r = _run([
            "kubectl", "--context", ctx, "get", "nodes",
            "-o", "jsonpath={.items[0].status.nodeInfo.osImage}",
        ])
        os_image = os_r.stdout.strip() if os_r.returncode == 0 else "unknown"

        # Try to detect which release this cluster corresponds to
        detected_release = None
        for rname, rspec in RELEASES.items():
            if version.startswith(rspec["kubernetes_version"]):
                detected_release = rname
                break

        statuses.append({
            "name": name,
            "version": version,
            "ready": ready,
            "detected_release": detected_release,
            "node_count": node_count,
            "container_runtime": container_runtime,
            "os_image": os_image,
        })

    return {"clusters": statuses}


def generate_kind_yaml(
    cluster_name: str,
    release: str,
    pod_subnet: str,
    service_subnet: str,
    host_port: int,
) -> str:
    """Return kind cluster YAML string for a given release."""
    rel = RELEASES[release]
    lines = [
        "kind: Cluster",
        "apiVersion: kind.x-k8s.io/v1alpha4",
        f"name: {cluster_name}",
        "nodes:",
        "- role: control-plane",
        f"  image: {rel['kind_image']}",
        "  extraPortMappings:",
        f"  - containerPort: {host_port}",
        f"    hostPort: {host_port}",
        "networking:",
        f'  podSubnet: "{pod_subnet}"',
        f'  serviceSubnet: "{service_subnet}"',
    ]
    return "\n".join(lines) + "\n"


def deploy_cluster(
    cluster_name: str,
    release: str,
    pod_subnet: str = "10.244.0.0/16",
    service_subnet: str = "10.96.0.0/12",
    host_port: int = 30000,
    recreate: bool = False,
    verbose: bool = False,
) -> dict[str, Any]:
    """Generate config and deploy a kind cluster for a given release."""
    rel = get_release(release)
    if rel is None:
        return {"error": f"Unknown release '{release}'. Valid: {RELEASE_ORDER}"}

    out_dir = CONFIGS_BASE / f"generated-kind-configs-{release}"
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg_file = out_dir / f"{cluster_name}.yaml"
    cfg_file.write_text(
        generate_kind_yaml(cluster_name, release, pod_subnet, service_subnet, host_port),
        encoding="utf-8",
    )

    if verbose:
        _log(f"[{cluster_name}] Deploy release={release} k8s={rel['kubernetes_version']} image={rel['kind_image']}")

    delete_result: dict[str, Any] | None = None
    if recreate:
        if verbose:
            _log(f"[{cluster_name}] Deleting existing cluster")
        d = _run_live(["kind", "delete", "cluster", "--name", cluster_name], f"{cluster_name}:delete") if verbose \
            else _run(["kind", "delete", "cluster", "--name", cluster_name])
        delete_result = {"exit_code": d.returncode, "stdout": d.stdout}

    create_cmd = ["kind", "create", "cluster", "--config", str(cfg_file)]
    if verbose:
        _log(f"[{cluster_name}] Creating cluster from {cfg_file}")
        created = _run_live(create_cmd, f"{cluster_name}:create")
    else:
        created = _run(create_cmd)

    entry: dict[str, Any] = {
        "cluster": cluster_name,
        "release": release,
        "kubernetes_version": rel["kubernetes_version"],
        "config_file": str(cfg_file),
        "exit_code": created.returncode,
        "stdout": created.stdout,
        "stderr": created.stderr,
        "success": created.returncode == 0,
    }
    if delete_result:
        entry["delete_result"] = delete_result

    if created.returncode == 0:
        upd = _run([
            "docker", "update",
            "--cpus", str(rel["cpus"]),
            "--memory", rel["memory"],
            f"{cluster_name}-control-plane",
        ])
        entry["resource_update"] = {"exit_code": upd.returncode, "stdout": upd.stdout}
        if verbose:
            _log(f"[{cluster_name}] Success")
    else:
        if verbose:
            _log(f"[{cluster_name}] Failed (exit={created.returncode})")

    return entry


def delete_cluster(cluster_name: str, verbose: bool = False) -> dict[str, Any]:
    """Delete a kind cluster."""
    if verbose:
        _log(f"Deleting cluster {cluster_name}")
    result = _run(["kind", "delete", "cluster", "--name", cluster_name])
    return {
        "cluster": cluster_name,
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "success": result.returncode == 0,
    }


# ─── Application deployment ──────────────────────────────────────────────────

def deploy_app(
    cluster_name: str,
    app_spec: dict[str, Any],
    verbose: bool = False,
) -> dict[str, Any]:
    """Deploy an application (Deployment) to a cluster."""
    app_name = app_spec.get("name", "app")
    namespace = app_spec.get("namespace", "default")
    image = app_spec.get("image", "nginx:latest")
    replicas = app_spec.get("replicas", 1)

    if verbose:
        _log(f"[{cluster_name}] Deploying {app_name} ({image}) with {replicas} replicas")

    # Create namespace if needed
    if namespace != "default":
        _run([
            "kubectl", "--context", f"kind-{cluster_name}",
            "create", "ns", namespace,
        ])

    # Create deployment via kubectl
    cmds = [
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "create", "deployment", app_name,
        f"--image={image}",
        f"--replicas={replicas}",
        "--dry-run=client", "-o", "yaml",
        "|",
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "apply", "-f", "-",
    ]

    # Simplified: use kubectl directly
    result = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "create", "deployment", app_name,
        f"--image={image}",
        f"--replicas={replicas}",
    ])

    if result.returncode != 0 and "already exists" not in result.stderr:
        return {
            "cluster": cluster_name,
            "app_name": app_name,
            "namespace": namespace,
            "image": image,
            "replicas": replicas,
            "success": False,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    return {
        "cluster": cluster_name,
        "app_name": app_name,
        "namespace": namespace,
        "image": image,
        "replicas": replicas,
        "success": True,
        "exit_code": 0,
        "stdout": f"Deployment {app_name} created/updated",
        "stderr": "",
    }


def upgrade_app(
    cluster_name: str,
    app_name: str,
    namespace: str,
    new_image: str,
    verbose: bool = False,
) -> dict[str, Any]:
    """Upgrade an app to a new image version."""
    if verbose:
        _log(f"[{cluster_name}/{namespace}] Upgrading {app_name} to {new_image}")

    result = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "set", "image",
        f"deployment/{app_name}",
        f"{app_name}={new_image}",
    ])

    return {
        "cluster": cluster_name,
        "app_name": app_name,
        "namespace": namespace,
        "new_image": new_image,
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def scale_app(
    cluster_name: str,
    app_name: str,
    namespace: str,
    replicas: int,
    verbose: bool = False,
) -> dict[str, Any]:
    """Scale an app deployment."""
    if verbose:
        _log(f"[{cluster_name}/{namespace}] Scaling {app_name} to {replicas} replicas")

    result = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "scale", "deployment", app_name,
        f"--replicas={replicas}",
    ])

    return {
        "cluster": cluster_name,
        "app_name": app_name,
        "namespace": namespace,
        "replicas": replicas,
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def list_apps_in_cluster(
    cluster_name: str,
    namespace: str = "default",
) -> dict[str, Any]:
    """List all deployments in a cluster namespace."""
    result = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "get", "deployments",
        "-o", "json",
    ])
    if result.returncode != 0:
        return {"cluster": cluster_name, "namespace": namespace, "apps": [], "error": result.stderr}

    import json as _json
    try:
        data = _json.loads(result.stdout)
    except _json.JSONDecodeError:
        return {"cluster": cluster_name, "namespace": namespace, "apps": []}

    from releases import get_apps_for_release, RELEASE_ORDER as _REL_ORDER

    apps = []
    for item in data.get("items", []):
        name = item["metadata"]["name"]
        containers = item["spec"]["template"]["spec"]["containers"]
        image = containers[0]["image"] if containers else "unknown"
        replicas = item["spec"].get("replicas", 1)
        ready = 0
        for cond in item.get("status", {}).get("conditions", []):
            if cond.get("type") == "Available" and cond.get("status") == "True":
                ready = item.get("status", {}).get("readyReplicas", 0)
                break

        # Detect which release this app's image matches
        detected_release = None
        for rname in _REL_ORDER:
            for app_spec in get_apps_for_release(rname):
                if app_spec["name"] == name and app_spec["image"] == image:
                    detected_release = rname
                    break
            if detected_release:
                break

        apps.append({
            "name": name,
            "image": image,
            "replicas": replicas,
            "ready_replicas": ready,
            "detected_release": detected_release,
        })
    return {"cluster": cluster_name, "namespace": namespace, "apps": apps}


def fix_app(
    cluster_name: str,
    app_name: str,
    namespace: str,
    expected_image: str,
    expected_replicas: int,
    app_found: bool,
    verbose: bool = False,
) -> dict[str, Any]:
    """Fix an app deviation: deploy if missing, upgrade image, scale replicas."""
    results: list[dict[str, Any]] = []

    if not app_found:
        # Deploy the app from scratch
        r = deploy_app(cluster_name, {
            "name": app_name,
            "namespace": namespace,
            "image": expected_image,
            "replicas": expected_replicas,
        }, verbose)
        results.append({"action": "deploy", **r})
    else:
        # Check and fix image
        from Deviation_mcp import _get_app_in_cluster
        current = _get_app_in_cluster(cluster_name, namespace, app_name)
        if current:
            if current["image"] != expected_image:
                r = upgrade_app(cluster_name, app_name, namespace, expected_image, verbose)
                results.append({"action": "upgrade_image", **r})
            if current["replicas"] != expected_replicas:
                r = scale_app(cluster_name, app_name, namespace, expected_replicas, verbose)
                results.append({"action": "scale_replicas", **r})

    success = all(r.get("success", False) for r in results)
    return {
        "cluster": cluster_name,
        "app_name": app_name,
        "namespace": namespace,
        "expected_image": expected_image,
        "expected_replicas": expected_replicas,
        "actions": results,
        "success": success,
    }


# ─── MCP server ──────────────────────────────────────────────────────────────

def _build_mcp_server(host: str = "127.0.0.1", port: int = 8766):
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("deployment_mcp", host=host, port=port)

    @mcp.tool()
    def list_releases() -> dict[str, Any]:
        """List all available release definitions."""
        return get_releases()

    @mcp.tool()
    def cluster_status() -> dict[str, Any]:
        """Get current status of all running kind clusters."""
        return get_cluster_status()

    @mcp.tool()
    def deploy(
        cluster_name: str,
        release: str,
        pod_subnet: str = "10.244.0.0/16",
        service_subnet: str = "10.96.0.0/12",
        host_port: int = 30000,
        recreate: bool = False,
        verbose: bool = False,
    ) -> dict[str, Any]:
        """Deploy a kind cluster for a given release."""
        return deploy_cluster(
            cluster_name=cluster_name,
            release=release,
            pod_subnet=pod_subnet,
            service_subnet=service_subnet,
            host_port=host_port,
            recreate=recreate,
            verbose=verbose,
        )

    @mcp.tool()
    def delete(cluster_name: str, verbose: bool = False) -> dict[str, Any]:
        """Delete a kind cluster by name."""
        return delete_cluster(cluster_name, verbose=verbose)

    return mcp


# ─── CLI ─────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Deployment MCP agent")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("releases", help="List available releases")
    sub.add_parser("status", help="Get cluster status")

    dep = sub.add_parser("deploy", help="Deploy cluster for a release")
    dep.add_argument("--cluster", required=True)
    dep.add_argument("--release", required=True)
    dep.add_argument("--pod-subnet", default="10.244.0.0/16")
    dep.add_argument("--service-subnet", default="10.96.0.0/12")
    dep.add_argument("--host-port", type=int, default=30000)
    dep.add_argument("--recreate", action="store_true")
    dep.add_argument("--verbose", action="store_true")

    dlt = sub.add_parser("delete", help="Delete a cluster")
    dlt.add_argument("--cluster", required=True)
    dlt.add_argument("--verbose", action="store_true")

    srv = sub.add_parser("serve", help="Run as MCP server")
    srv.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default="stdio")
    srv.add_argument("--host", default="127.0.0.1")
    srv.add_argument("--port", type=int, default=8766)

    return p


def _run_cli() -> int:
    args = _build_parser().parse_args()

    if args.command == "releases":
        print(json.dumps(get_releases(), indent=2))
    elif args.command == "status":
        print(json.dumps(get_cluster_status(), indent=2))
    elif args.command == "deploy":
        print(json.dumps(
            deploy_cluster(
                cluster_name=args.cluster,
                release=args.release,
                pod_subnet=args.pod_subnet,
                service_subnet=args.service_subnet,
                host_port=args.host_port,
                recreate=args.recreate,
                verbose=args.verbose,
            ),
            indent=2,
        ))
    elif args.command == "delete":
        print(json.dumps(delete_cluster(args.cluster, verbose=args.verbose), indent=2))
    elif args.command == "serve":
        mcp = _build_mcp_server(host=args.host, port=args.port)
        if args.transport == "stdio":
            mcp.run(transport="stdio")
        else:
            mcp.run(transport=args.transport)

    return 0


if __name__ == "__main__":
    raise SystemExit(_run_cli())
