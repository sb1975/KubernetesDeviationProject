#!/usr/bin/env bash
set -euo pipefail

CTX="kind-dev"
ARGO_NS="argocd"
KARGO_NS="kargo"
DEMO_NS="kargo-image-demo"
PROJECT_REPO_DIR="/home/esudbat/KubernetesDeviationProject"
DEMO_MANIFEST="$PROJECT_REPO_DIR/gitops/demo/kargo-image-freight-demo.yaml"
REPORT_DIR="$PROJECT_REPO_DIR/gitops/demo/reports"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
REPORT_FILE="$REPORT_DIR/kargo_demo_report_${TIMESTAMP}.md"
AUTO_ADVANCE=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERR]${NC} $*"; }

pause_step() {
  if [[ "$AUTO_ADVANCE" == "true" ]]; then
    return 0
  fi
  echo
  read -r -p "Press Enter to continue -> " _
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [--auto]

Options:
  --auto    Run without interactive Enter prompts.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --auto)
        AUTO_ADVANCE=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        err "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

start_port_forward() {
  local ns="$1"
  local svc="$2"
  local local_port="$3"
  local remote_port="$4"
  local log_file="$5"

  if ss -ltn | grep -q ":${local_port} "; then
    warn "Port ${local_port} already in use. Skipping port-forward ${svc}."
    return 0
  fi

  nohup kubectl --context "$CTX" -n "$ns" port-forward "svc/${svc}" "${local_port}:${remote_port}" >"$log_file" 2>&1 &
  sleep 1
  if ss -ltn | grep -q ":${local_port} "; then
    ok "Port-forward started: ${svc} on localhost:${local_port}"
  else
    warn "Port-forward may not have started for ${svc}. Check ${log_file}"
  fi
}

print_header() {
  echo
  echo "============================================================"
  echo "KARGO UI DEMO RUNNER"
  echo "============================================================"
}

print_summary() {
  echo
  echo "Demo URLs"
  echo "- Argo CD: http://localhost:31080"
  echo "- Kargo:   http://localhost:31081"
  echo
  echo "Credentials"
  echo "- Argo CD: admin / admin"
  echo "- Kargo:   admin / admin"
}

check_preflight() {
  info "Checking required commands and cluster context..."
  need_cmd kubectl
  need_cmd ss

  kubectl config get-contexts "$CTX" >/dev/null 2>&1 || {
    err "Kubernetes context $CTX not found."
    exit 1
  }

  kubectl --context "$CTX" get ns >/dev/null
  ok "Cluster context $CTX is reachable."
}

check_control_plane() {
  info "Validating Argo CD and Kargo control-plane pods..."
  kubectl --context "$CTX" -n "$ARGO_NS" get pods
  kubectl --context "$CTX" -n "$KARGO_NS" get pods
}

setup_port_forwards() {
  info "Starting UI port-forwards if needed..."
  mkdir -p /tmp/kargo-demo-logs
  start_port_forward "$ARGO_NS" argocd-server 31080 80 /tmp/kargo-demo-logs/argocd-port-forward.log
  start_port_forward "$KARGO_NS" kargo-api 31081 80 /tmp/kargo-demo-logs/kargo-port-forward.log
  print_summary
}

write_report() {
  info "Writing demo report to ${REPORT_FILE}"
  mkdir -p "$REPORT_DIR"

  {
    echo "# Kargo Demo Report"
    echo
    echo "- Timestamp: $(date -Iseconds)"
    echo "- Context: $CTX"
    echo "- Argo URL: http://localhost:31080"
    echo "- Kargo URL: http://localhost:31081"
    echo
    echo "## Argo Applications"
    echo '```text'
    kubectl --context "$CTX" -n "$ARGO_NS" get app k8s-deviation-dev k8s-deviation-staging k8s-deviation-production || true
    echo '```'
    echo
    echo "## Kargo Demo Project Resources"
    echo '```text'
    kubectl --context "$CTX" -n "$DEMO_NS" get project,projectconfig,warehouse,stage,freight || true
    echo '```'
    echo
    echo "## Promotions"
    echo '```text'
    kubectl --context "$CTX" -n "$DEMO_NS" get promotions -o wide || true
    echo '```'
    echo
    echo "## Warehouse Status"
    echo '```text'
    kubectl --context "$CTX" -n "$DEMO_NS" get warehouse image-freight -o yaml || true
    echo '```'
  } > "$REPORT_FILE"

  ok "Report written: $REPORT_FILE"
}

check_argo_apps() {
  info "Checking Argo CD applications..."
  kubectl --context "$CTX" -n "$ARGO_NS" get app k8s-deviation-dev k8s-deviation-staging k8s-deviation-production
  echo
  kubectl --context "$CTX" -n "$ARGO_NS" get app k8s-deviation-dev -o jsonpath='{.spec.source.targetRevision}{"\n"}'
  kubectl --context "$CTX" -n "$ARGO_NS" get app k8s-deviation-staging -o jsonpath='{.spec.source.targetRevision}{"\n"}'
  kubectl --context "$CTX" -n "$ARGO_NS" get app k8s-deviation-production -o jsonpath='{.spec.source.targetRevision}{"\n"}'
  ok "Argo app status snapshot complete."
}

ensure_demo_project() {
  info "Applying UI-safe public Freight demo project..."
  kubectl --context "$CTX" apply -f "$DEMO_MANIFEST"
  kubectl --context "$CTX" -n "$DEMO_NS" get project,projectconfig,warehouse,stage
  ok "Demo project resources are present."
}

wait_for_freight() {
  info "Waiting for Freight discovery in ${DEMO_NS}..."
  local max_tries=24
  local i=1
  while [[ $i -le $max_tries ]]; do
    if kubectl --context "$CTX" -n "$DEMO_NS" get freight >/dev/null 2>&1; then
      if [[ -n "$(kubectl --context "$CTX" -n "$DEMO_NS" get freight --no-headers 2>/dev/null || true)" ]]; then
        ok "Freight discovered."
        kubectl --context "$CTX" -n "$DEMO_NS" get freight -o wide
        return 0
      fi
    fi
    echo "  waiting... (${i}/${max_tries})"
    sleep 5
    ((i++))
  done
  warn "No Freight discovered yet. Continue UI demo by showing Warehouse status."
  kubectl --context "$CTX" -n "$DEMO_NS" describe warehouse image-freight | sed -n '1,200p'
}

show_live_commands() {
  echo
  echo "Use these optional live checks in another terminal:"
  echo "- kubectl --context kind-dev -n argocd get app"
  echo "- kubectl --context kind-dev -n kargo-image-demo get warehouse,freight,stage,promotions"
  echo "- kubectl --context kind-dev -n k8s-deviation get warehouse,freight,stage"
}

ui_script_steps() {
  echo
  echo "================= UI SCRIPT ================="
  echo "Step 1: Open Argo CD UI and confirm apps are Synced."
  echo "Step 2: Open Kargo UI and select project 'kargo-image-demo'."
  echo "Step 3: Verify Freight appears in the timeline."
  pause_step

  info "Snapshot before promotion actions"
  kubectl --context "$CTX" -n "$DEMO_NS" get freight -o wide || true
  kubectl --context "$CTX" -n "$DEMO_NS" get stage -o wide
  kubectl --context "$CTX" -n "$DEMO_NS" get promotions || true

  echo
  echo "Step 4: In Kargo UI, promote Freight to dev (if action is enabled)."
  echo "Step 5: Promote to staging."
  echo "Step 6: Promote to production manually."
  echo "(Production is manual by policy.)"
  pause_step

  info "Snapshot after promotion actions"
  kubectl --context "$CTX" -n "$DEMO_NS" get promotions -o wide || true
  kubectl --context "$CTX" -n "$DEMO_NS" get stage -o wide
  kubectl --context "$CTX" -n "$DEMO_NS" get freight -o wide || true

  echo
  echo "Step 7: Return to Argo CD UI and show branch/path/source of apps."
  echo "Step 8: Explain full pipeline project 'k8s-deviation' and GHCR access dependency."
  echo "============================================="
}

main() {
  parse_args "$@"
  print_header
  check_preflight
  check_control_plane
  setup_port_forwards
  check_argo_apps
  ensure_demo_project
  wait_for_freight
  show_live_commands
  ui_script_steps
  write_report
  ok "Demo runner completed."
}

main "$@"
