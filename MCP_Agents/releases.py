"""Shared release definitions for Kubernetes cluster and application versions.

This module loads cluster and application release catalogs from JSON files under
`MCP_Agents/release/` and exposes a stable API used by Deployment_mcp,
Deviation_mcp, Artifact_mcp, and the backend API.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent
RELEASE_DIR = BASE_DIR / "release"
CLUSTER_RELEASE_FILE = RELEASE_DIR / "cluster_release.json"
APP_RELEASE_FILE = RELEASE_DIR / "application_release.json"
RELEASE_ORDER = ["R1", "R2", "R3", "R4"]

CLUSTER_REQUIRED_FIELDS = {
    "name": str,
    "kubernetes_version": str,
    "kind_image": str,
    "cpus": (int, float),
    "memory": str,
    "description": str,
    "changes": list,
}

APP_REQUIRED_FIELDS = {
    "name": str,
    "namespace": str,
    "kind": str,
    "image": str,
    "replicas": int,
    "service_type": str,
    "service_port": int,
}


def _config_error(file_path: Path, message: str) -> ValueError:
    return ValueError(f"Invalid config in {file_path}: {message}")


def _read_json_file(file_path: Path) -> Any:
    if not file_path.exists():
        raise _config_error(file_path, "file does not exist")

    try:
        with file_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        raise _config_error(
            file_path,
            f"JSON parse error at line {exc.lineno}, column {exc.colno}: {exc.msg}",
        ) from exc



def _validate_cluster_release_map(data: object) -> dict[str, dict]:
    if not isinstance(data, dict):
        raise _config_error(CLUSTER_RELEASE_FILE, "top-level JSON must be an object")

    if data.get("schema_version") != "1.0":
        raise _config_error(CLUSTER_RELEASE_FILE, "schema_version must be '1.0'")

    releases = data.get("releases")
    if not isinstance(releases, dict):
        raise _config_error(CLUSTER_RELEASE_FILE, "'releases' must be an object")

    unknown_releases = [key for key in releases.keys() if key not in RELEASE_ORDER]
    if unknown_releases:
        raise _config_error(
            CLUSTER_RELEASE_FILE,
            f"unknown release key(s): {sorted(unknown_releases)}; expected only {RELEASE_ORDER}",
        )

    missing_releases = [key for key in RELEASE_ORDER if key not in releases]
    if missing_releases:
        raise _config_error(
            CLUSTER_RELEASE_FILE,
            f"missing release key(s): {missing_releases}",
        )

    result: dict[str, dict] = {}
    for release_name in RELEASE_ORDER:
        release_def = releases[release_name]
        if not isinstance(release_def, dict):
            raise _config_error(CLUSTER_RELEASE_FILE, f"release '{release_name}' must be an object")

        for field, expected_type in CLUSTER_REQUIRED_FIELDS.items():
            if field not in release_def:
                raise _config_error(CLUSTER_RELEASE_FILE, f"release '{release_name}' missing field '{field}'")

            value = release_def[field]
            if isinstance(expected_type, tuple):
                if not isinstance(value, expected_type) or isinstance(value, bool):
                    raise _config_error(
                        CLUSTER_RELEASE_FILE,
                        f"release '{release_name}' field '{field}' must be numeric",
                    )
            elif not isinstance(value, expected_type):
                raise _config_error(
                    CLUSTER_RELEASE_FILE,
                    f"release '{release_name}' field '{field}' must be of type {expected_type.__name__}",
                )

        result[release_name] = dict(release_def)

    return result



def _validate_app_spec(release_name: str, index: int, app: dict) -> None:
    for field, expected_type in APP_REQUIRED_FIELDS.items():
        if field not in app:
            raise _config_error(
                APP_RELEASE_FILE,
                f"release '{release_name}' app #{index} is missing required field '{field}'",
            )

        value = app[field]
        if expected_type is int:
            if not isinstance(value, int) or isinstance(value, bool):
                raise _config_error(
                    APP_RELEASE_FILE,
                    f"release '{release_name}' app '{app.get('name', '<unknown>')}' field '{field}' must be an integer",
                )
        elif not isinstance(value, expected_type):
            raise _config_error(
                APP_RELEASE_FILE,
                f"release '{release_name}' app '{app.get('name', '<unknown>')}' field '{field}' must be of type {expected_type.__name__}",
            )

    if app["replicas"] < 0:
        raise _config_error(
            APP_RELEASE_FILE,
            f"release '{release_name}' app '{app['name']}' has invalid replicas={app['replicas']}",
        )

    if app["service_port"] <= 0:
        raise _config_error(
            APP_RELEASE_FILE,
            f"release '{release_name}' app '{app['name']}' has invalid service_port={app['service_port']}",
        )

    if not app["image"].strip():
        raise _config_error(
            APP_RELEASE_FILE,
            f"release '{release_name}' app '{app['name']}' has an empty image value",
        )



def _validate_app_release_map(data: object) -> dict[str, list[dict]]:
    if not isinstance(data, dict):
        raise _config_error(APP_RELEASE_FILE, "top-level JSON must be an object")

    if data.get("schema_version") != "1.0":
        raise _config_error(APP_RELEASE_FILE, "schema_version must be '1.0'")

    releases = data.get("releases")
    if not isinstance(releases, dict):
        raise _config_error(APP_RELEASE_FILE, "'releases' must be an object")

    unknown_releases = [key for key in releases.keys() if key not in RELEASE_ORDER]
    if unknown_releases:
        raise _config_error(
            APP_RELEASE_FILE,
            f"unknown release key(s): {sorted(unknown_releases)}; expected only {RELEASE_ORDER}",
        )

    result: dict[str, list[dict]] = {}
    for release_name in RELEASE_ORDER:
        apps = releases.get(release_name, [])
        if not isinstance(apps, list):
            raise _config_error(APP_RELEASE_FILE, f"release '{release_name}' must map to a list of app specs")

        validated_apps: list[dict] = []
        seen_names: set[str] = set()
        for index, app in enumerate(apps, start=1):
            if not isinstance(app, dict):
                raise _config_error(
                    APP_RELEASE_FILE,
                    f"release '{release_name}' app #{index} must be an object, got {type(app).__name__}",
                )
            _validate_app_spec(release_name, index, app)
            app_name = app["name"]
            if app_name in seen_names:
                raise _config_error(APP_RELEASE_FILE, f"release '{release_name}' contains duplicate app '{app_name}'")
            seen_names.add(app_name)
            validated_apps.append(dict(app))

        result[release_name] = validated_apps

    return result



def _load_cluster_release_map() -> dict[str, dict]:
    return _validate_cluster_release_map(_read_json_file(CLUSTER_RELEASE_FILE))



def _load_app_release_map() -> dict[str, list[dict]]:
    return _validate_app_release_map(_read_json_file(APP_RELEASE_FILE))


RELEASES: dict[str, dict] = _load_cluster_release_map()
_APP_RELEASE_MAP: dict[str, list[dict]] = _load_app_release_map()
for release_name, release_def in RELEASES.items():
    release_def["applications"] = _APP_RELEASE_MAP.get(release_name, [])



def get_release(name: str) -> dict | None:
    return RELEASES.get(name)


def update_release_definition(
    name: str,
    cluster_fields: dict[str, Any],
    applications: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Update a release definition and persist it to release JSON files.

    `cluster_fields` updates cluster-level release metadata.
    If `applications` is provided, application baseline for the release is replaced.
    """
    if name not in RELEASE_ORDER:
        raise ValueError(f"Unknown release '{name}'. Valid: {RELEASE_ORDER}")

    cluster_payload = {
        "schema_version": "1.0",
        "releases": {r: dict(RELEASES[r]) for r in RELEASE_ORDER if r in RELEASES},
    }
    app_payload = {
        "schema_version": "1.0",
        "releases": {r: [dict(a) for a in _APP_RELEASE_MAP.get(r, [])] for r in RELEASE_ORDER},
    }

    # Keep cluster catalog clean: applications are stored in a separate file.
    for r in RELEASE_ORDER:
        cluster_payload["releases"][r].pop("applications", None)

    cluster_payload["releases"][name].update(cluster_fields)
    if applications is not None:
        app_payload["releases"][name] = [dict(a) for a in applications]

    validated_clusters = _validate_cluster_release_map(cluster_payload)
    validated_apps = _validate_app_release_map(app_payload)

    CLUSTER_RELEASE_FILE.write_text(
        json.dumps(cluster_payload, indent=2) + "\n",
        encoding="utf-8",
    )
    APP_RELEASE_FILE.write_text(
        json.dumps(app_payload, indent=2) + "\n",
        encoding="utf-8",
    )

    RELEASES.clear()
    RELEASES.update(validated_clusters)

    _APP_RELEASE_MAP.clear()
    _APP_RELEASE_MAP.update(validated_apps)

    for release_name, release_def in RELEASES.items():
        release_def["applications"] = _APP_RELEASE_MAP.get(release_name, [])

    return dict(RELEASES[name])



def releases_between(from_release: str, to_release: str) -> list[dict]:
    """Return ordered releases strictly between from and to (exclusive start)."""
    start = RELEASE_ORDER.index(from_release)
    end = RELEASE_ORDER.index(to_release)
    return [RELEASES[r] for r in RELEASE_ORDER[start + 1 : end + 1]]



def version_tuple(version_str: str) -> tuple[int, ...]:
    """Parse a version string like '1.28' or 'v1.28.7' into a comparable tuple."""
    v = version_str.lstrip("v").split("-")[0]
    return tuple(int(x) for x in v.split("."))



def get_apps_for_release(release_name: str) -> list[dict]:
    rel = RELEASES.get(release_name)
    return rel.get("applications", []) if rel else []



def get_app_for_release(release_name: str, app_name: str) -> dict | None:
    for app in get_apps_for_release(release_name):
        if app.get("name") == app_name:
            return app
    return None



def resolve_cluster_spec(input_item: dict[str, Any], defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    """Resolve a cluster input item against cluster release defaults.

    Canonical input shape:
      {"name": "c1", "release": "R4", ...}

    Legacy input shape with `kubernetes_version` is still accepted.
    """
    defaults = defaults or {}
    name = input_item["name"]
    release_name = input_item.get("release")
    release_def = get_release(release_name) if release_name else None

    explicit_version = input_item.get("kubernetes_version")
    kubernetes_version = explicit_version or (release_def["kubernetes_version"] if release_def else None)
    if not kubernetes_version:
        raise ValueError(
            f"Cluster '{name}' must define either 'release' or 'kubernetes_version' in input config"
        )

    kind_image = input_item.get("kind_image") or (release_def["kind_image"] if release_def else None)
    cpus = input_item.get("cpus", defaults.get("cpus", release_def.get("cpus") if release_def else None))
    memory = input_item.get("memory", defaults.get("memory", release_def.get("memory") if release_def else None))

    return {
        "name": name,
        "release": release_name,
        "kubernetes_version": str(kubernetes_version),
        "kind_image": kind_image,
        "pod_subnet": input_item.get("pod_subnet", defaults.get("pod_subnet", "10.244.0.0/16")),
        "service_subnet": input_item.get("service_subnet", defaults.get("service_subnet", "10.96.0.0/12")),
        "host_port": input_item.get("host_port"),
        "api_server_port": input_item.get("api_server_port"),
        "cpus": cpus,
        "memory": memory,
    }
