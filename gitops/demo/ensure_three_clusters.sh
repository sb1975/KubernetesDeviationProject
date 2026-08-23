#!/usr/bin/env bash
set -euo pipefail

for env in dev staging production; do
  if kind get clusters | grep -qx "$env"; then
    echo "[skip] kind cluster '$env' already exists"
  else
    echo "[create] kind cluster '$env'"
    kind create cluster --name "$env"
  fi
done

echo
echo "[contexts]"
kubectl config get-contexts -o name | grep '^kind-' | sort

echo
echo "[nodes]"
for ctx in kind-dev kind-staging kind-production; do
  echo "--- $ctx ---"
  kubectl --context "$ctx" get nodes
  echo
done
