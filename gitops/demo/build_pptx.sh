#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/esudbat/KubernetesDeviationProject"
BUILDER_DIR="/tmp/pptxgen-builder"

mkdir -p "$BUILDER_DIR"
cd "$BUILDER_DIR"

if [[ ! -f package.json ]]; then
  npm init -y >/dev/null 2>&1
fi

npm install pptxgenjs@3.12.0 >/dev/null 2>&1

cd "$ROOT_DIR"
NODE_PATH="$BUILDER_DIR/node_modules" node gitops/demo/build_pptx.js

echo "Built: $ROOT_DIR/gitops/demo/KARGO_ARCHITECTURE_DEMO_SLIDES.pptx"
