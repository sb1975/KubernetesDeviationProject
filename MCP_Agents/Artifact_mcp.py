#!/usr/bin/env python3
"""Artifact MCP server for generating and deploying kind cluster configs.

This server reads a simple JSON input file and creates deterministic kind
cluster configuration artifacts. It can also deploy clusters from those
generated artifacts.
"""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from releases import resolve_cluster_spec


DEFAULT_VERSION_PATCH = {
	"1.30": "1.30.0",
	"1.29": "1.29.2",
	"1.28": "1.28.7",
	"1.27": "1.27.11",
}

DEFAULT_INPUT_FILE = "./input/cluster_input.json"


@dataclass
class ClusterSpec:
	name: str
	kubernetes_version: str
	pod_subnet: str
	service_subnet: str
	host_port: int | None = None
	api_server_port: int | None = None
	cpus: float | None = None
	memory: str | None = None

	@property
	def node_image(self) -> str:
		v = self.kubernetes_version.strip().lower().removeprefix("v")
		if v.count(".") == 1:
			v = DEFAULT_VERSION_PATCH.get(v, f"{v}.0")
		return f"kindest/node:v{v}"


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
	return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _ts() -> str:
	return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _log(message: str) -> None:
	print(f"[{_ts()}] {message}", flush=True)


def _run_live(cmd: list[str], prefix: str) -> subprocess.CompletedProcess[str]:
	proc = subprocess.Popen(
		cmd,
		stdout=subprocess.PIPE,
		stderr=subprocess.STDOUT,
		text=True,
		bufsize=1,
	)
	lines: list[str] = []
	assert proc.stdout is not None
	for line in proc.stdout:
		line = line.rstrip("\n")
		lines.append(line + "\n")
		print(f"[{_ts()}] [{prefix}] {line}", flush=True)
	proc.wait()
	return subprocess.CompletedProcess(cmd, proc.returncode, "".join(lines), "")


def _load_input(input_file: str) -> list[ClusterSpec]:
	payload = json.loads(Path(input_file).read_text(encoding="utf-8"))
	defaults: dict[str, Any] = {}
	if isinstance(payload, dict) and "items" in payload:
		defaults = payload.get("defaults", {}) if isinstance(payload.get("defaults", {}), dict) else {}
		raw_clusters = payload["items"]
	elif isinstance(payload, dict) and "clusters" in payload:
		raw_clusters = payload["clusters"]
	elif isinstance(payload, dict):
		raw_clusters = [payload]
	else:
		raise ValueError("Input JSON must be an object or {'clusters': [...]}.")

	specs: list[ClusterSpec] = []
	for item in raw_clusters:
		resolved = resolve_cluster_spec(item, defaults=defaults)

		specs.append(
			ClusterSpec(
				name=resolved["name"],
				kubernetes_version=resolved["kubernetes_version"],
				pod_subnet=resolved["pod_subnet"],
				service_subnet=resolved["service_subnet"],
				host_port=resolved["host_port"],
				api_server_port=resolved["api_server_port"],
				cpus=resolved["cpus"],
				memory=resolved["memory"],
			)
		)
	return specs


def _render_kind_yaml(spec: ClusterSpec) -> str:
	lines = [
		"kind: Cluster",
		"apiVersion: kind.x-k8s.io/v1alpha4",
		f"name: {spec.name}",
		"nodes:",
		"- role: control-plane",
		f"  image: {spec.node_image}",
	]

	if spec.host_port is not None:
		lines.extend(
			[
				"  extraPortMappings:",
				f"  - containerPort: {spec.host_port}",
				f"    hostPort: {spec.host_port}",
			]
		)

	lines.extend(
		[
			"networking:",
			f"  podSubnet: \"{spec.pod_subnet}\"",
			f"  serviceSubnet: \"{spec.service_subnet}\"",
		]
	)

	if spec.api_server_port is not None:
		lines.append(f"  apiServerPort: {spec.api_server_port}")

	return "\n".join(lines) + "\n"


def generate_configs_from_input(input_file: str, output_dir: str) -> dict[str, Any]:
	"""Generate kind YAML config files from an input JSON file."""
	specs = _load_input(input_file)
	out = Path(output_dir)
	out.mkdir(parents=True, exist_ok=True)

	generated: list[dict[str, Any]] = []
	for spec in specs:
		file_path = out / f"{spec.name}.yaml"
		file_path.write_text(_render_kind_yaml(spec), encoding="utf-8")
		generated.append(
			{
				"name": spec.name,
				"version": spec.kubernetes_version,
				"config_file": str(file_path),
				"kind_image": spec.node_image,
			}
		)

	return {
		"input_file": str(Path(input_file).resolve()),
		"output_dir": str(out.resolve()),
		"generated": generated,
	}


def deploy_from_input(
	input_file: str,
	output_dir: str,
	recreate: bool = False,
	verbose: bool = False,
) -> dict[str, Any]:
	"""Generate config files and deploy kind clusters from those artifacts."""
	result = generate_configs_from_input(input_file=input_file, output_dir=output_dir)
	specs = _load_input(input_file)
	deploy_results: list[dict[str, Any]] = []
	if verbose:
		_log(f"Starting deploy for {len(specs)} cluster(s)")

	for spec in specs:
		if verbose:
			_log(f"[{spec.name}] Begin (k8s={spec.kubernetes_version}, image={spec.node_image})")
		if recreate:
			delete_cmd = ["kind", "delete", "cluster", "--name", spec.name]
			if verbose:
				_log(f"[{spec.name}] Deleting existing cluster")
				deleted = _run_live(delete_cmd, f"{spec.name}:delete")
			else:
				deleted = _run(delete_cmd)
			delete_result = {
				"command": " ".join(delete_cmd),
				"exit_code": deleted.returncode,
				"stdout": deleted.stdout,
				"stderr": deleted.stderr,
			}
		else:
			delete_result = None

		cfg = str(Path(output_dir) / f"{spec.name}.yaml")
		create_cmd = ["kind", "create", "cluster", "--config", cfg]
		if verbose:
			_log(f"[{spec.name}] Creating cluster from {cfg}")
			created = _run_live(create_cmd, f"{spec.name}:create")
		else:
			created = _run(create_cmd)

		entry: dict[str, Any] = {
			"name": spec.name,
			"command": " ".join(create_cmd),
			"exit_code": created.returncode,
			"stdout": created.stdout,
			"stderr": created.stderr,
		}
		if delete_result is not None:
			entry["delete_result"] = delete_result

		if created.returncode == 0 and (spec.cpus is not None or spec.memory is not None):
			resource_cmd = ["docker", "update"]
			if spec.cpus is not None:
				resource_cmd.extend(["--cpus", str(spec.cpus)])
			if spec.memory is not None:
				resource_cmd.extend(["--memory", spec.memory])
			resource_cmd.append(f"{spec.name}-control-plane")
			if verbose:
				_log(f"[{spec.name}] Applying resource limits")
				updated = _run_live(resource_cmd, f"{spec.name}:resource")
			else:
				updated = _run(resource_cmd)
			entry["resource_update"] = {
				"command": " ".join(resource_cmd),
				"exit_code": updated.returncode,
				"stdout": updated.stdout,
				"stderr": updated.stderr,
			}

		if verbose:
			if created.returncode == 0:
				_log(f"[{spec.name}] Success")
			else:
				_log(f"[{spec.name}] Failed (exit={created.returncode})")

		deploy_results.append(entry)

	result["deployments"] = deploy_results
	if verbose:
		succeeded = len([d for d in deploy_results if d["exit_code"] == 0])
		_log(f"Deploy finished: {succeeded}/{len(deploy_results)} succeeded")
	return result


def write_input_template(output_file: str) -> str:
	"""Write a sample cluster input JSON file."""
	template = {
		"schema_version": "1.0",
		"defaults": {
			"cpus": 0.5,
			"memory": "768m",
			"pod_subnet": "10.244.0.0/16",
			"service_subnet": "10.96.0.0/12",
		},
		"items": [
			{
				"name": "c1",
				"release": "R4",
				"pod_subnet": "10.10.0.0/16",
				"service_subnet": "10.110.0.0/12",
				"host_port": 30001,
			},
			{
				"name": "c2",
				"release": "R3",
				"pod_subnet": "10.20.0.0/16",
				"service_subnet": "10.120.0.0/12",
				"host_port": 30002,
			},
		]
	}
	output = Path(output_file)
	output.parent.mkdir(parents=True, exist_ok=True)
	output.write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
	return str(output.resolve())


def _build_parser() -> argparse.ArgumentParser:
	parser = argparse.ArgumentParser(description="Artifact MCP utility for kind clusters")
	sub = parser.add_subparsers(dest="command", required=True)

	gen = sub.add_parser("generate", help="Generate kind config artifacts from input JSON")
	gen.add_argument("--input", default=DEFAULT_INPUT_FILE, help="Path to input JSON (default: %(default)s)")
	gen.add_argument("--output-dir", default="./generated-kind-configs")

	dep = sub.add_parser("deploy", help="Generate artifacts and deploy kind clusters")
	dep.add_argument("--input", default=DEFAULT_INPUT_FILE, help="Path to input JSON (default: %(default)s)")
	dep.add_argument("--output-dir", default="./generated-kind-configs")
	dep.add_argument("--recreate", action="store_true", help="Delete cluster before create")
	dep.add_argument("--verbose", action="store_true", help="Print live progress/debug logs")

	tmpl = sub.add_parser("template", help="Write sample input JSON")
	tmpl.add_argument("--output", default=DEFAULT_INPUT_FILE)

	srv = sub.add_parser("serve", help="Run Artifact MCP server")
	srv.add_argument(
		"--transport",
		choices=["stdio", "sse", "streamable-http"],
		default="stdio",
		help="MCP transport type",
	)
	srv.add_argument("--host", default="127.0.0.1", help="Host for sse/streamable-http")
	srv.add_argument("--port", type=int, default=8765, help="Port for sse/streamable-http")

	return parser


def _build_mcp_server(host: str = "127.0.0.1", port: int = 8765):
	from mcp.server.fastmcp import FastMCP

	mcp = FastMCP("artifact_mcp", host=host, port=port)

	@mcp.tool()
	def generate_kind_configs(input_file: str, output_dir: str = "./generated-kind-configs") -> dict[str, Any]:
		"""Generate kind config YAML artifacts from input JSON."""
		return generate_configs_from_input(input_file=input_file, output_dir=output_dir)

	@mcp.tool()
	def deploy_kind_clusters(
		input_file: str,
		output_dir: str = "./generated-kind-configs",
		recreate: bool = False,
		verbose: bool = False,
	) -> dict[str, Any]:
		"""Generate config artifacts and deploy kind clusters from them."""
		return deploy_from_input(
			input_file=input_file,
			output_dir=output_dir,
			recreate=recreate,
			verbose=verbose,
		)

	@mcp.tool()
	def create_input_template(output_file: str = DEFAULT_INPUT_FILE) -> dict[str, str]:
		"""Create a starter input JSON file for cluster generation."""
		return {"template_file": write_input_template(output_file)}

	return mcp


def _run_cli() -> int:
	parser = _build_parser()
	args = parser.parse_args()

	if args.command == "template":
		print(json.dumps({"template_file": write_input_template(args.output)}, indent=2))
		return 0

	if args.command == "generate":
		print(
			json.dumps(
				generate_configs_from_input(input_file=args.input, output_dir=args.output_dir),
				indent=2,
			)
		)
		return 0

	if args.command == "deploy":
		print(
			json.dumps(
				deploy_from_input(
					input_file=args.input,
					output_dir=args.output_dir,
					recreate=args.recreate,
					verbose=args.verbose,
				),
				indent=2,
			)
		)
		return 0

	if args.command == "serve":
		try:
			mcp = _build_mcp_server(host=args.host, port=args.port)
		except Exception as exc:
			print(json.dumps({"error": f"Failed to start MCP server: {exc}"}, indent=2))
			return 1

		if args.transport == "stdio":
			mcp.run(transport="stdio")
		else:
			mcp.run(transport=args.transport)
		return 0

	parser.print_help()
	return 1


if __name__ == "__main__":
	raise SystemExit(_run_cli())
