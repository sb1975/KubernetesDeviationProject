"""Report Store — persists deviation reports with approval workflow status.

Statuses: pending_approval → approved → remediated (or rejected)
"""

from __future__ import annotations

import json
import datetime
import uuid
from pathlib import Path
from typing import Any

REPORTS_DIR = Path(__file__).parent / "reports"
REPORTS_DIR.mkdir(exist_ok=True)


def _now() -> str:
    return datetime.datetime.now().isoformat()


def create_report(
    report_type: str,  # "cluster" or "app"
    report_data: dict[str, Any],
) -> dict[str, Any]:
    """Save a deviation report and return it with an ID and status.

    Deduplicates: if an existing pending_approval report exists for the same
    cluster/app + target_release, it is replaced rather than creating a duplicate.
    """
    # Determine the identity key for dedup
    target = report_data.get("target_release", "")
    if report_type == "cluster":
        identity = report_data.get("cluster", "")
    else:
        identity = f"{report_data.get('cluster', '')}/{report_data.get('app_name', '')}"

    # Check for existing pending report with same identity+target
    existing_id = None
    for p in REPORTS_DIR.glob("*.json"):
        try:
            with p.open("r") as f:
                rec = json.load(f)
            if (
                rec.get("type") == report_type
                and rec.get("status") == "pending_approval"
                and rec.get("report", {}).get("target_release") == target
            ):
                if report_type == "cluster" and rec["report"].get("cluster") == identity:
                    existing_id = rec["id"]
                    break
                elif report_type == "app" and f"{rec['report'].get('cluster', '')}/{rec['report'].get('app_name', '')}" == identity:
                    existing_id = rec["id"]
                    break
        except (json.JSONDecodeError, KeyError):
            continue

    report_id = existing_id or str(uuid.uuid4())[:8]
    record = {
        "id": report_id,
        "type": report_type,
        "status": "pending_approval",
        "created_at": _now(),
        "updated_at": _now(),
        "approved_by": None,
        "rejected_reason": None,
        "remediation_result": None,
        "report": report_data,
    }
    _save(report_id, record)
    return record


def get_report(report_id: str) -> dict[str, Any] | None:
    path = REPORTS_DIR / f"{report_id}.json"
    if not path.exists():
        return None
    with path.open("r") as f:
        return json.load(f)


def list_reports(status: str | None = None) -> list[dict[str, Any]]:
    """List all reports, optionally filtered by status."""
    reports = []
    for p in sorted(REPORTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        with p.open("r") as f:
            rec = json.load(f)
            if status is None or rec.get("status") == status:
                reports.append(rec)
    return reports


def approve_report(report_id: str, approved_by: str = "user") -> dict[str, Any] | None:
    rec = get_report(report_id)
    if rec is None:
        return None
    if rec["status"] != "pending_approval":
        return rec  # already actioned
    rec["status"] = "approved"
    rec["approved_by"] = approved_by
    rec["updated_at"] = _now()
    _save(report_id, rec)
    return rec


def reject_report(report_id: str, reason: str = "") -> dict[str, Any] | None:
    rec = get_report(report_id)
    if rec is None:
        return None
    if rec["status"] != "pending_approval":
        return rec
    rec["status"] = "rejected"
    rec["rejected_reason"] = reason
    rec["updated_at"] = _now()
    _save(report_id, rec)
    return rec


def mark_remediated(report_id: str, result: dict[str, Any]) -> dict[str, Any] | None:
    rec = get_report(report_id)
    if rec is None:
        return None
    rec["status"] = "remediated"
    rec["remediation_result"] = result
    rec["updated_at"] = _now()
    _save(report_id, rec)
    return rec


def _save(report_id: str, record: dict[str, Any]) -> None:
    path = REPORTS_DIR / f"{report_id}.json"
    with path.open("w") as f:
        json.dump(record, f, indent=2)
