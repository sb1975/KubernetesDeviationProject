#!/usr/bin/env bash
set -euo pipefail

show_rendered_images() {
  local overlay="$1"
  echo "[render] $overlay"
  kubectl kustomize "$overlay" | awk '/image:/{print $2}'
  echo
}

show_cluster_images() {
  local ctx="$1"
  local ns="$2"
  echo "[cluster] context=$ctx namespace=$ns"
  kubectl --context "$ctx" -n "$ns" get deploy k8s-deviation-backend -o jsonpath='{.spec.template.spec.containers[0].image}'
  echo
  kubectl --context "$ctx" -n "$ns" get deploy k8s-deviation-frontend -o jsonpath='{.spec.template.spec.containers[0].image}'
  echo
  echo
}

show_rendered_images gitops/apps/k8s-deviation/overlays/dev
show_rendered_images gitops/apps/k8s-deviation/overlays/staging
show_rendered_images gitops/apps/k8s-deviation/overlays/production

show_cluster_images kind-dev k8s-deviation-dev
show_cluster_images kind-staging k8s-deviation-staging
show_cluster_images kind-production k8s-deviation-production
