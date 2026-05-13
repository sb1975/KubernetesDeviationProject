#!/usr/bin/env python3
"""Remediation MCP Agent — executes approved deviation fixes via Deployment Agent.

Workflow:
1. Receives an approved report_id
2. Reads the stored deviation report
3. Uses LLM to generate a safe remediation plan
4. Executes remediation through Deployment Agent functions
5. Updates report status to 'remediated'
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from report_store import get_report, mark_remediated, approve_report
from llm_helper import call_llm
from Deployment_mcp import deploy_cluster, delete_cluster, deploy_app, upgrade_app, scale_app, fix_app
from releases import get_release, get_app_for_release


_REMEDIATION_SYSTEM = (
    "You are a Kubernetes remediation planner. Given a deviation report, "
    "generate a step-by-step remediation plan. Each step should include: "
    "action (deploy_cluster/upgrade_app/scale_app/fix_app), parameters, "
    "and risk level (low/medium/high). "
    "Reply in JSON with key 'steps' as a list of {action, params, risk, description}."
)


def generate_remediation_plan(report_data: dict[str, Any]) -> dict[str, Any]:
    """Use LLM to generate a remediation plan from a deviation report."""
    prompt = (
        f"Report type: {report_data.get('type', 'cluster')}\n"
        f"Report data:\n{json.dumps(report_data.get('report', {}), indent=2)}\n\n"
        f"Generate a remediation plan."
    )

    llm_response = call_llm(prompt, system=_REMEDIATION_SYSTEM, timeout=20.0)

    if llm_response:
        try:
            cleaned = llm_response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                cleaned = cleaned.rsplit("```", 1)[0]
            plan = json.loads(cleaned)
            return {"success": True, "plan": plan}
        except (json.JSONDecodeError, KeyError):
            # LLM returned non-JSON — use deterministic fallback
            pass

    # Deterministic fallback plan
    return _deterministic_plan(report_data)


def _deterministic_plan(report_data: dict[str, Any]) -> dict[str, Any]:
    """Generate a plan without LLM, based on deviation fields."""
    report = report_data.get("report", {})
    report_type = report_data.get("type", "cluster")
    steps = []

    if report_type == "cluster":
        for dev in report.get("deviations", []):
            if dev["field"] == "kubernetes_version":
                steps.append({
                    "action": "rebuild_cluster",
                    "params": {
                        "cluster_name": report.get("cluster"),
                        "release": report.get("target_release"),
                        "recreate": True,
                    },
                    "risk": "high",
                    "description": (
                        f"Rebuild cluster '{report.get('cluster')}' to match "
                        f"{report.get('target_release')} (k8s {dev['expected']})"
                    ),
                })
            elif dev["field"] in ("cpus", "memory"):
                steps.append({
                    "action": "update_resources",
                    "params": {
                        "cluster_name": report.get("cluster"),
                        "field": dev["field"],
                        "value": dev["expected"],
                    },
                    "risk": "low",
                    "description": f"Update {dev['field']} from {dev['current']} to {dev['expected']}",
                })
    elif report_type == "app":
        for dev in report.get("deviations", []):
            if dev["field"] == "image":
                steps.append({
                    "action": "upgrade_app",
                    "params": {
                        "cluster_name": report.get("cluster"),
                        "app_name": report.get("app_name"),
                        "namespace": report.get("namespace", "default"),
                        "new_image": dev["expected"],
                    },
                    "risk": "medium",
                    "description": f"Upgrade image from {dev['current']} to {dev['expected']}",
                })
            elif dev["field"] == "replicas":
                steps.append({
                    "action": "scale_app",
                    "params": {
                        "cluster_name": report.get("cluster"),
                        "app_name": report.get("app_name"),
                        "namespace": report.get("namespace", "default"),
                        "replicas": int(dev["expected"]),
                    },
                    "risk": "low",
                    "description": f"Scale from {dev['current']} to {dev['expected']} replicas",
                })
            elif dev["field"] == "app_presence":
                steps.append({
                    "action": "fix_app",
                    "params": {
                        "cluster_name": report.get("cluster"),
                        "app_name": report.get("app_name"),
                        "namespace": report.get("namespace", "default"),
                        "expected_image": report.get("expected_image"),
                        "expected_replicas": report.get("expected_replicas"),
                        "app_found": False,
                    },
                    "risk": "medium",
                    "description": f"Deploy missing app '{report.get('app_name')}'",
                })

    return {"success": True, "plan": {"steps": steps}}


def execute_remediation(report_id: str) -> dict[str, Any]:
    """Execute remediation for an approved report.

    Returns the execution result with per-step outcomes.
    """
    record = get_report(report_id)
    if record is None:
        return {"error": f"Report '{report_id}' not found"}
    if record["status"] != "approved":
        return {"error": f"Report '{report_id}' is not approved (status: {record['status']})"}

    # Generate plan
    plan_result = generate_remediation_plan(record)
    if not plan_result.get("success"):
        return {"error": "Failed to generate remediation plan"}

    steps = plan_result["plan"].get("steps", [])
    if not steps:
        result = {"success": True, "message": "No remediation steps needed", "steps_executed": []}
        mark_remediated(report_id, result)
        return result

    # Execute each step
    executed = []
    all_success = True

    for step in steps:
        action = step.get("action")
        params = step.get("params", {})
        step_result = {"action": action, "params": params, "description": step.get("description", "")}

        try:
            if action == "rebuild_cluster":
                # Delete and redeploy
                cluster_name = params["cluster_name"]
                release = params["release"]
                delete_cluster(cluster_name)
                out = deploy_cluster(
                    cluster_name=cluster_name,
                    release=release,
                    recreate=True,
                    verbose=True,
                )
                step_result["outcome"] = out
                step_result["success"] = out.get("success", False)

            elif action == "upgrade_app":
                out = upgrade_app(
                    params["cluster_name"],
                    params["app_name"],
                    params.get("namespace", "default"),
                    params["new_image"],
                    verbose=True,
                )
                step_result["outcome"] = out
                step_result["success"] = out.get("success", False)

            elif action == "scale_app":
                out = scale_app(
                    params["cluster_name"],
                    params["app_name"],
                    params.get("namespace", "default"),
                    params["replicas"],
                    verbose=True,
                )
                step_result["outcome"] = out
                step_result["success"] = out.get("success", False)

            elif action == "fix_app":
                out = fix_app(
                    params["cluster_name"],
                    params["app_name"],
                    params.get("namespace", "default"),
                    params["expected_image"],
                    params["expected_replicas"],
                    params.get("app_found", False),
                )
                step_result["outcome"] = out
                step_result["success"] = out.get("success", False)

            elif action == "update_resources":
                # Docker update for CPU/memory
                import subprocess
                cluster_name = params["cluster_name"]
                field = params["field"]
                value = params["value"]
                if field == "cpus":
                    cmd = ["docker", "update", f"--cpus={value}", f"{cluster_name}-control-plane"]
                else:
                    cmd = ["docker", "update", f"--memory={value}", f"{cluster_name}-control-plane"]
                r = subprocess.run(cmd, capture_output=True, text=True, check=False)
                step_result["outcome"] = {"stdout": r.stdout, "stderr": r.stderr, "exit_code": r.returncode}
                step_result["success"] = r.returncode == 0

            else:
                step_result["success"] = False
                step_result["outcome"] = {"error": f"Unknown action '{action}'"}

        except Exception as e:
            step_result["success"] = False
            step_result["outcome"] = {"error": str(e)}

        if not step_result.get("success"):
            all_success = False
        executed.append(step_result)

    result = {
        "success": all_success,
        "steps_executed": executed,
        "total_steps": len(steps),
        "successful_steps": sum(1 for s in executed if s.get("success")),
    }

    mark_remediated(report_id, result)
    return result


# ─── MCP Server ───────────────────────────────────────────────────────────────

def _build_mcp_server(host: str = "127.0.0.1", port: int = 8768):
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("remediation_mcp", host=host, port=port)

    @mcp.tool()
    def plan(report_id: str) -> dict[str, Any]:
        """Generate a remediation plan for a deviation report."""
        record = get_report(report_id)
        if record is None:
            return {"error": f"Report '{report_id}' not found"}
        return generate_remediation_plan(record)

    @mcp.tool()
    def remediate(report_id: str) -> dict[str, Any]:
        """Execute remediation for an approved report."""
        return execute_remediation(report_id)

    return mcp


# ─── CLI ─────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Remediation MCP agent")
    sub = p.add_subparsers(dest="command", required=True)

    plan_p = sub.add_parser("plan", help="Generate remediation plan for a report")
    plan_p.add_argument("--report-id", required=True)

    exec_p = sub.add_parser("execute", help="Execute remediation for an approved report")
    exec_p.add_argument("--report-id", required=True)

    srv = sub.add_parser("serve", help="Run as MCP server")
    srv.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default="stdio")
    srv.add_argument("--host", default="127.0.0.1")
    srv.add_argument("--port", type=int, default=8768)

    return p


def _run_cli() -> int:
    args = _build_parser().parse_args()
    if args.command == "plan":
        record = get_report(args.report_id)
        if record is None:
            print(json.dumps({"error": f"Report '{args.report_id}' not found"}))
            return 1
        print(json.dumps(generate_remediation_plan(record), indent=2))
    elif args.command == "execute":
        print(json.dumps(execute_remediation(args.report_id), indent=2))
    elif args.command == "serve":
        mcp = _build_mcp_server(host=args.host, port=args.port)
        if args.transport == "stdio":
            mcp.run(transport="stdio")
        else:
            mcp.run(transport=args.transport)
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_cli())
