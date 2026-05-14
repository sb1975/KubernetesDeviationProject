#!/usr/bin/env python3
"""Deviation MCP agent — detect deviations between running clusters and release specs."""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from releases import RELEASES, RELEASE_ORDER, get_release, releases_between, version_tuple
from llm_helper import call_llm
from report_store import create_report


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _ts() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ─── Cluster introspection ────────────────────────────────────────────────────

def _get_running_version(cluster_name: str) -> str | None:
    r = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "get", "nodes",
        "-o", "jsonpath={.items[0].status.nodeInfo.kubeletVersion}",
    ])
    return r.stdout.strip().lstrip("v") if r.returncode == 0 and r.stdout.strip() else None


def _get_node_image(cluster_name: str) -> str | None:
    r = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "get", "nodes",
        "-o", "jsonpath={.items[0].status.nodeInfo.osImage}",
    ])
    return r.stdout.strip() if r.returncode == 0 else None


def _get_docker_resources(cluster_name: str) -> dict[str, str]:
    r = _run([
        "docker", "inspect",
        f"{cluster_name}-control-plane",
        "--format", "{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}",
    ])
    if r.returncode != 0:
        return {"cpus": "unknown", "memory": "unknown"}
    parts = r.stdout.strip().split()
    if len(parts) == 2:
        try:
            nano_cpus = int(parts[0])
            cpus = "unlimited" if nano_cpus == 0 else str(round(nano_cpus / 1e9, 2))
            mem_bytes = int(parts[1])
            memory = "unlimited" if mem_bytes == 0 else f"{mem_bytes // (1024 * 1024)}m"
        except ValueError:
            cpus, memory = "unknown", "unknown"
    else:
        cpus, memory = "unknown", "unknown"
    return {"cpus": cpus, "memory": memory}


def _detect_release(version: str) -> str | None:
    """Guess which release a running k8s version maps to."""
    for rname in RELEASE_ORDER:
        rel = RELEASES[rname]
        if version.startswith(rel["kubernetes_version"]):
            return rname
    return None


# ─── LLM enrichment ───────────────────────────────────────────────────────────

_LLM_SYSTEM = (
    "You are a Kubernetes operations expert. Given a deviation report between "
    "a running cluster (or application) and its target release baseline, provide: "
    "1) A concise risk assessment (1-2 sentences), "
    "2) A recommended action priority (immediate/scheduled/informational), "
    "3) Any additional context about the impact of the deviations. "
    "Reply in JSON with keys: risk_assessment, priority, impact_notes."
)


def _enrich_with_llm(report: dict[str, Any]) -> dict[str, Any]:
    """Add LLM-generated risk assessment to a deviation report."""
    if not report.get("deviations"):
        report["llm_analysis"] = {
            "risk_assessment": "No deviations detected — cluster is compliant.",
            "priority": "informational",
            "impact_notes": "No action required.",
        }
        return report

    prompt = (
        f"Cluster: {report.get('cluster')}\n"
        f"Current version: {report.get('current_version')}\n"
        f"Target release: {report.get('target_release')} (k8s {report.get('target_version')})\n"
        f"Deviations:\n{json.dumps(report.get('deviations', []), indent=2)}\n"
        f"Provide risk assessment."
    )

    llm_response = call_llm(prompt, system=_LLM_SYSTEM, timeout=15.0)
    if llm_response:
        try:
            # Try to parse JSON from the response
            # Handle markdown code blocks
            cleaned = llm_response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                cleaned = cleaned.rsplit("```", 1)[0]
            analysis = json.loads(cleaned)
            report["llm_analysis"] = {
                "risk_assessment": analysis.get("risk_assessment", ""),
                "priority": analysis.get("priority", "scheduled"),
                "impact_notes": analysis.get("impact_notes", ""),
            }
        except (json.JSONDecodeError, KeyError):
            report["llm_analysis"] = {
                "risk_assessment": llm_response[:500],
                "priority": "scheduled",
                "impact_notes": "",
            }
    else:
        report["llm_analysis"] = {
            "risk_assessment": "LLM unavailable — manual review recommended.",
            "priority": "scheduled",
            "impact_notes": "Configure GEMINI_API_KEY or OPENAI_API_KEY in .env for AI analysis.",
        }
    return report


# ─── Deviation analysis ───────────────────────────────────────────────────────

def _severity(current_minor: int, expected_minor: int) -> str:
    diff = abs(expected_minor - current_minor)
    if diff == 0:
        return "OK"
    if diff == 1:
        return "WARNING"
    return "CRITICAL"


def analyze_cluster_deviation(
    cluster_name: str,
    target_release: str,
) -> dict[str, Any]:
    """Compare a running cluster against a target release and return a deviation report."""
    rel = get_release(target_release)
    if rel is None:
        return {"error": f"Unknown target release '{target_release}'. Valid: {RELEASE_ORDER}"}

    running_version = _get_running_version(cluster_name)
    if running_version is None:
        return {
            "error": f"Cannot reach cluster '{cluster_name}'. Is it running?",
            "cluster": cluster_name,
        }

    resources = _get_docker_resources(cluster_name)
    current_release = _detect_release(running_version)

    # Version comparison
    running_tuple = version_tuple(running_version)
    target_tuple = version_tuple(rel["kubernetes_version"])
    running_minor = running_tuple[1] if len(running_tuple) >= 2 else 0
    target_minor = int(rel["kubernetes_version"].split(".")[1])
    version_ok = running_tuple[:2] == target_tuple[:2]

    deviations: list[dict[str, Any]] = []

    if not version_ok:
        direction = "UPGRADE NEEDED" if running_tuple < target_tuple else "DOWNGRADE DETECTED"
        deviations.append({
            "field": "kubernetes_version",
            "current": running_version,
            "expected": rel["kubernetes_version"],
            "severity": _severity(running_minor, target_minor),
            "action": direction,
            "remediation": (
                f"Rebuild cluster '{cluster_name}' using release {target_release}:\n"
                f"  python3 Deployment_mcp.py deploy --cluster {cluster_name} "
                f"--release {target_release} --recreate --verbose"
            ),
        })

    # CPU check
    if resources["cpus"] not in ("unknown", "unlimited", str(rel["cpus"])):
        try:
            curr_cpus = float(resources["cpus"])
            exp_cpus = float(rel["cpus"])
            if abs(curr_cpus - exp_cpus) > 0.01:
                deviations.append({
                    "field": "cpus",
                    "current": resources["cpus"],
                    "expected": str(rel["cpus"]),
                    "severity": "WARNING",
                    "action": "UPDATE RESOURCE LIMIT",
                    "remediation": (
                        f"docker update --cpus {rel['cpus']} {cluster_name}-control-plane"
                    ),
                })
        except ValueError:
            pass

    # Memory check
    if resources["memory"] not in ("unknown", "unlimited", rel["memory"]):
        deviations.append({
            "field": "memory",
            "current": resources["memory"],
            "expected": rel["memory"],
            "severity": "WARNING",
            "action": "UPDATE RESOURCE LIMIT",
            "remediation": (
                f"docker update --memory {rel['memory']} {cluster_name}-control-plane"
            ),
        })

    # Intermediate releases to traverse
    steps: list[dict] = []
    if current_release and current_release != target_release:
        try:
            intermediates = releases_between(current_release, target_release)
            for step_rel in intermediates:
                steps.append({
                    "release": step_rel["name"],
                    "kubernetes_version": step_rel["kubernetes_version"],
                    "changes": step_rel.get("changes", []),
                    "command": (
                        f"python3 Deployment_mcp.py deploy --cluster {cluster_name} "
                        f"--release {step_rel['name']} --recreate --verbose"
                    ),
                })
        except ValueError:
            pass  # current_release may be after target_release (downgrade)

    result = {
        "cluster": cluster_name,
        "current_release": current_release,
        "current_version": running_version,
        "target_release": target_release,
        "target_version": rel["kubernetes_version"],
        "target_image": rel["kind_image"],
        "compliant": len(deviations) == 0,
        "deviations": deviations,
        "upgrade_path": steps,
        "summary": (
            f"Cluster '{cluster_name}' is COMPLIANT with {target_release}"
            if not deviations
            else f"Cluster '{cluster_name}' has {len(deviations)} deviation(s) vs {target_release}"
        ),
        "generated_at": datetime.datetime.now().isoformat(),
    }

    # Enrich with LLM analysis
    result = _enrich_with_llm(result)

    # Persist report for approval workflow
    stored = create_report("cluster", result)
    result["report_id"] = stored["id"]
    result["approval_status"] = stored["status"]

    return result


def compare_releases(from_release: str, to_release: str) -> dict[str, Any]:
    """Return a changelog-style diff between two release specs."""
    fr = get_release(from_release)
    tr = get_release(to_release)
    if not fr:
        return {"error": f"Unknown from_release '{from_release}'"}
    if not tr:
        return {"error": f"Unknown to_release '{to_release}'"}

    changes: list[dict[str, str]] = []

    if fr["kubernetes_version"] != tr["kubernetes_version"]:
        changes.append({
            "field": "kubernetes_version",
            "from": fr["kubernetes_version"],
            "to": tr["kubernetes_version"],
            "severity": _severity(
                int(fr["kubernetes_version"].split(".")[1]),
                int(tr["kubernetes_version"].split(".")[1]),
            ),
        })

    if fr["kind_image"] != tr["kind_image"]:
        changes.append({
            "field": "kind_image",
            "from": fr["kind_image"],
            "to": tr["kind_image"],
            "severity": "INFO",
        })

    if str(fr["cpus"]) != str(tr["cpus"]):
        changes.append({"field": "cpus", "from": str(fr["cpus"]), "to": str(tr["cpus"]), "severity": "WARNING"})

    if fr["memory"] != tr["memory"]:
        changes.append({"field": "memory", "from": fr["memory"], "to": tr["memory"], "severity": "WARNING"})

    try:
        intermediate = releases_between(from_release, to_release)
    except ValueError:
        intermediate = []

    return {
        "from_release": from_release,
        "to_release": to_release,
        "changes": changes,
        "intermediate_releases": [r["name"] for r in intermediate],
        "cumulative_changes": [c for r in intermediate for c in r.get("changes", [])],
    }


def scan_all_clusters(target_release: str) -> dict[str, Any]:
    """Scan all running kind clusters and report deviations vs target_release."""
    r = _run(["kind", "get", "clusters"])
    clusters = [c.strip() for c in r.stdout.strip().splitlines() if c.strip()]
    reports = [analyze_cluster_deviation(c, target_release) for c in clusters]
    compliant = [rep for rep in reports if rep.get("compliant")]
    non_compliant = [rep for rep in reports if not rep.get("compliant")]
    return {
        "target_release": target_release,
        "total": len(reports),
        "compliant": len(compliant),
        "non_compliant": len(non_compliant),
        "reports": reports,
    }


# ─── Application deviation detection ──────────────────────────────────────────

def _get_app_in_cluster(
    cluster_name: str,
    namespace: str,
    app_name: str,
) -> dict[str, Any] | None:
    """Get the actual image and replicas of a deployed app (e.g., Deployment)."""
    r = _run([
        "kubectl", "--context", f"kind-{cluster_name}",
        "-n", namespace,
        "get", "deployment", app_name,
        "-o", "jsonpath={.spec.template.spec.containers[0].image},{.spec.replicas}",
    ])
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        img, reps = r.stdout.strip().split(",")
        return {"image": img.strip(), "replicas": int(reps.strip())}
    except (ValueError, IndexError):
        return None


def analyze_app_deviation(
    cluster_name: str,
    app_name: str,
    target_release: str,
) -> dict[str, Any]:
    """Analyze application deviations for a specific app in a cluster vs target release."""
    from releases import get_app_for_release

    rel = get_release(target_release)
    if rel is None:
        return {"error": f"Unknown release '{target_release}'"}

    app_baseline = get_app_for_release(target_release, app_name)
    if app_baseline is None:
        return {
            "error": f"App '{app_name}' not defined in release {target_release}",
            "cluster": cluster_name,
        }

    namespace = app_baseline.get("namespace", "default")
    app_status = _get_app_in_cluster(cluster_name, namespace, app_name)

    if app_status is None:
        not_deployed_result = {
            "cluster": cluster_name,
            "app_name": app_name,
            "app_found": False,
            "namespace": namespace,
            "target_release": target_release,
            "compliant": False,
            "error": f"App '{app_name}' not found in namespace '{namespace}'",
            "expected_image": app_baseline["image"],
            "expected_replicas": app_baseline["replicas"],
            "summary": f"App '{app_name}' is NOT DEPLOYED in cluster '{cluster_name}'",
            "deviations": [
                {
                    "field": "app_presence",
                    "current": "not deployed",
                    "expected": "deployed",
                    "severity": "CRITICAL",
                    "action": "DEPLOY APPLICATION",
                    "remediation": (
                        f"kubectl apply -f - <<EOF\n"
                        f"apiVersion: apps/v1\n"
                        f"kind: Deployment\n"
                        f"metadata:\n  name: {app_name}\n  namespace: {namespace}\n"
                        f"spec:\n  replicas: {app_baseline['replicas']}\n"
                        f"  selector:\n    matchLabels:\n      app: {app_name}\n"
                        f"  template:\n"
                        f"    metadata:\n      labels:\n        app: {app_name}\n"
                        f"    spec:\n"
                        f"      containers:\n"
                        f"      - name: {app_name}\n"
                        f"        image: {app_baseline['image']}\n"
                        f"        ports:\n"
                        f"        - containerPort: 80\n"
                        f"EOF"
                    ),
                }
            ],
            "generated_at": datetime.datetime.now().isoformat(),
        }
        stored = create_report("app", not_deployed_result)
        not_deployed_result["report_id"] = stored["id"]
        not_deployed_result["approval_status"] = stored["status"]
        return not_deployed_result

    # Detect deviations
    deviations: list[dict[str, Any]] = []

    # Image mismatch
    if app_status["image"] != app_baseline["image"]:
        deviations.append({
            "field": "image",
            "current": app_status["image"],
            "expected": app_baseline["image"],
            "severity": "CRITICAL" if _is_major_version_diff(app_status["image"], app_baseline["image"]) else "WARNING",
            "action": "UPDATE IMAGE",
            "remediation": (
                f"kubectl --context kind-{cluster_name} -n {namespace} set image "
                f"deployment/{app_name} {app_name}={app_baseline['image']}"
            ),
        })

    # Replica mismatch
    if app_status["replicas"] != app_baseline["replicas"]:
        deviations.append({
            "field": "replicas",
            "current": str(app_status["replicas"]),
            "expected": str(app_baseline["replicas"]),
            "severity": "WARNING",
            "action": "SCALE DEPLOYMENT",
            "remediation": (
                f"kubectl --context kind-{cluster_name} -n {namespace} scale "
                f"deployment {app_name} --replicas={app_baseline['replicas']}"
            ),
        })

    # Detect which release the current image actually belongs to
    detected_release = None
    if app_status:
        from releases import get_apps_for_release
        for rname in RELEASE_ORDER:
            for rapp in get_apps_for_release(rname):
                if rapp["name"] == app_name and rapp["image"] == app_status["image"]:
                    detected_release = rname
                    break
            if detected_release:
                break

    result = {
        "cluster": cluster_name,
        "app_name": app_name,
        "namespace": namespace,
        "app_found": True,
        "current_image": app_status["image"],
        "expected_image": app_baseline["image"],
        "current_replicas": app_status["replicas"],
        "expected_replicas": app_baseline["replicas"],
        "target_release": target_release,
        "detected_release": detected_release,
        "compliant": len(deviations) == 0,
        "deviations": deviations,
        "summary": (
            f"App '{app_name}' in cluster '{cluster_name}' is COMPLIANT with {target_release}"
            if not deviations
            else f"App '{app_name}' has {len(deviations)} deviation(s)"
        ),
    }

    # Enrich with LLM analysis and store report
    result["generated_at"] = datetime.datetime.now().isoformat()
    if deviations:
        result = _enrich_with_llm(result)
    stored = create_report("app", result)
    result["report_id"] = stored["id"]
    result["approval_status"] = stored["status"]

    return result


def _is_major_version_diff(current_image: str, expected_image: str) -> bool:
    """Check if image versions differ at major or minor level (e.g., nginx:1.26 vs 1.27)."""
    def extract_version(img: str) -> str | None:
        if ":" not in img:
            return None
        tag = img.split(":")[-1]
        return tag.split(".")[0:2]  # e.g., ["1", "26"] from "1.26.0"
    
    curr_ver = extract_version(current_image)
    exp_ver = extract_version(expected_image)
    return curr_ver != exp_ver if (curr_ver and exp_ver) else False


def scan_cluster_apps(
    cluster_name: str,
    target_release: str,
) -> dict[str, Any]:
    """Scan all apps defined in a release against what's running in a cluster."""
    from releases import get_apps_for_release

    rel = get_release(target_release)
    if rel is None:
        return {"error": f"Unknown release '{target_release}'"}

    apps = get_apps_for_release(target_release)
    if not apps:
        return {
            "cluster": cluster_name,
            "target_release": target_release,
            "total": 0,
            "compliant": 0,
            "non_compliant": 0,
            "reports": [],
        }

    reports = []
    for app in apps:
        report = analyze_app_deviation(cluster_name, app["name"], target_release)
        reports.append(report)

    compliant = sum(1 for r in reports if r.get("compliant"))
    return {
        "cluster": cluster_name,
        "target_release": target_release,
        "total": len(reports),
        "compliant": compliant,
        "non_compliant": len(reports) - compliant,
        "reports": reports,
    }




def _build_mcp_server(host: str = "127.0.0.1", port: int = 8767):
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("deviation_mcp", host=host, port=port)

    @mcp.tool()
    def analyze(cluster_name: str, target_release: str) -> dict[str, Any]:
        """Analyze deviations of a cluster vs a target release."""
        return analyze_cluster_deviation(cluster_name, target_release)

    @mcp.tool()
    def release_diff(from_release: str, to_release: str) -> dict[str, Any]:
        """Show spec differences between two releases."""
        return compare_releases(from_release, to_release)

    @mcp.tool()
    def scan(target_release: str) -> dict[str, Any]:
        """Scan all running clusters against a target release."""
        return scan_all_clusters(target_release)

    return mcp


# ─── CLI ─────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Deviation MCP agent")
    sub = p.add_subparsers(dest="command", required=True)

    ana = sub.add_parser("analyze", help="Analyze a cluster vs a target release")
    ana.add_argument("--cluster", required=True)
    ana.add_argument("--target-release", required=True)

    diff = sub.add_parser("diff", help="Compare two releases")
    diff.add_argument("--from-release", required=True)
    diff.add_argument("--to-release", required=True)

    scan = sub.add_parser("scan", help="Scan all clusters vs a target release")
    scan.add_argument("--target-release", required=True)

    srv = sub.add_parser("serve", help="Run as MCP server")
    srv.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default="stdio")
    srv.add_argument("--host", default="127.0.0.1")
    srv.add_argument("--port", type=int, default=8767)

    return p


def _run_cli() -> int:
    args = _build_parser().parse_args()
    if args.command == "analyze":
        print(json.dumps(analyze_cluster_deviation(args.cluster, args.target_release), indent=2))
    elif args.command == "diff":
        print(json.dumps(compare_releases(args.from_release, args.to_release), indent=2))
    elif args.command == "scan":
        print(json.dumps(scan_all_clusters(args.target_release), indent=2))
    elif args.command == "serve":
        mcp = _build_mcp_server(host=args.host, port=args.port)
        if args.transport == "stdio":
            mcp.run(transport="stdio")
        else:
            mcp.run(transport=args.transport)
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_cli())
