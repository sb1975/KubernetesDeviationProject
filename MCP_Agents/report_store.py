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

    # Check for existing report with same identity+target (any non-terminal status)
    # Collect ALL matches — keep the first, delete the rest (cleanup old duplicates)
    matching_ids = []
    existing_status = None
    for p in REPORTS_DIR.glob("*.json"):
        try:
            with p.open("r") as f:
                rec = json.load(f)
            if (
                rec.get("type") == report_type
                and rec.get("status") in ("pending_approval", "compliant", "approved", "remediated")
                and rec.get("report", {}).get("target_release") == target
            ):
                matched = False
                if report_type == "cluster" and rec["report"].get("cluster") == identity:
                    matched = True
                elif report_type == "app" and f"{rec['report'].get('cluster', '')}/{rec['report'].get('app_name', '')}" == identity:
                    matched = True
                if matched:
                    matching_ids.append((rec["id"], rec.get("status"), rec.get("approved_by"), rec.get("remediation_result")))
        except (json.JSONDecodeError, KeyError):
            continue

    # Keep the first match, delete any extras
    existing_id = matching_ids[0][0] if matching_ids else None
    existing_status = matching_ids[0][1] if matching_ids else None
    existing_approved_by = matching_ids[0][2] if matching_ids else None
    existing_remediation_result = matching_ids[0][3] if matching_ids else None
    for extra_id, *_ in matching_ids[1:]:
        (REPORTS_DIR / f"{extra_id}.json").unlink(missing_ok=True)

    # Determine status: preserve approved/remediated state, otherwise base on compliance
    is_compliant = report_data.get("compliant", False)
    if existing_status in ("approved", "remediated"):
        # Preserve the approved/remediated state — don't reset to pending
        status = existing_status
    else:
        status = "compliant" if is_compliant else "pending_approval"

    report_id = existing_id or str(uuid.uuid4())[:8]
    record = {
        "id": report_id,
        "type": report_type,
        "status": status,
        "created_at": _now(),
        "updated_at": _now(),
        "approved_by": existing_approved_by,
        "rejected_reason": None,
        "remediation_result": existing_remediation_result,
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
