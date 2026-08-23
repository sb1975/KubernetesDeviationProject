# User Guide: Kargo GitOps Use Cases (dev -> staging -> production)

This guide explains how to use Kargo in this repository for environment promotions, what to test, and how to verify expected behavior.

For a runnable three-cluster demo with helper scripts, see `gitops/demo/KARGO_FREIGHT_DEMO.md`.

## What this setup does

- Argo CD continuously syncs each environment overlay from Git.
- Kargo watches source artifacts in a Warehouse:
  - Git repo changes
  - Backend image tags
  - Frontend image tags
- Kargo promotes Freight through three stages:
  - dev: receives Freight directly from Warehouse
  - staging: receives Freight that has passed through dev
  - production: receives Freight that has passed through staging
- Promotion policy is intentionally different by environment:
  - dev and staging: auto-promotion enabled
  - production: auto-promotion disabled (manual gate)

## Key files

- App overlays:
  - gitops/apps/k8s-deviation/overlays/dev/kustomization.yaml
  - gitops/apps/k8s-deviation/overlays/staging/kustomization.yaml
  - gitops/apps/k8s-deviation/overlays/production/kustomization.yaml
- Argo CD applications:
  - gitops/argocd/app-dev.yaml
  - gitops/argocd/app-staging.yaml
  - gitops/argocd/app-production.yaml
- Kargo resources:
  - gitops/kargo/01-warehouse.yaml
  - gitops/kargo/10-stage-dev.yaml
  - gitops/kargo/20-stage-staging.yaml
  - gitops/kargo/30-stage-production.yaml
  - gitops/kargo/05-project-config.yaml
  - gitops/kargo/40-verification-templates.yaml

## Prerequisites

1. A reachable Kubernetes cluster context in kubectl.
2. Argo CD installed in the cluster.
3. Kargo installed in the cluster.
4. Access to the Git repo and image registries referenced in manifests.

## Local preflight validation (no cluster required)

Run these to validate manifest composition:

- kubectl kustomize gitops/apps/k8s-deviation/overlays/dev
- kubectl kustomize gitops/apps/k8s-deviation/overlays/staging
- kubectl kustomize gitops/apps/k8s-deviation/overlays/production
- kubectl kustomize gitops/argocd
- kubectl kustomize gitops/kargo

What good looks like:

- All commands render YAML successfully.
- You may see deprecation warnings for commonLabels and patchesStrategicMerge; these are non-blocking.

## Cluster apply sequence

Apply Argo CD apps first, then Kargo resources:

1. kubectl apply -k gitops/argocd
2. kubectl apply -k gitops/kargo

Verify resources:

- kubectl get applications -n argocd
- kubectl get project,projectconfig,warehouse,stage -n k8s-deviation

## Promotion test workflow

### 1) Validate policy behavior

Check that prod is manual while dev and staging are automatic:

- kubectl get projectconfig k8s-deviation -n k8s-deviation -o yaml

Expected policy:

- dev autoPromotionEnabled: true
- staging autoPromotionEnabled: true
- production autoPromotionEnabled: false

### 2) Trigger an initial dev promotion

Use either Kargo CLI or kubectl plugin flow, depending on your install.

Option A (Kargo CLI style):

- kargo promote --project k8s-deviation --stage dev --warehouse k8s-deviation-warehouse

Option B (kubectl plugin style):

- kubectl kargo promote stage/dev -n k8s-deviation

Observe progression:

- kubectl get promotions -n k8s-deviation
- kubectl get stages -n k8s-deviation -o wide

### 3) Confirm staging auto-promotion

After dev promotion succeeds and verification passes, staging should pick up eligible Freight automatically.

Checks:

- kubectl get promotions -n k8s-deviation
- kubectl describe stage staging -n k8s-deviation

### 4) Confirm production manual gate

Production should not auto-promote.

Checks:

- kubectl describe stage production -n k8s-deviation
- Verify no automatic production Promotion is created

Then manually promote production:

- kargo promote --project k8s-deviation --stage production --warehouse k8s-deviation-warehouse

or

- kubectl kargo promote stage/production -n k8s-deviation

### 5) Verify app behavior after each stage

Environment checks should include:

- Argo CD app sync/health per environment
- Service endpoint checks for backend and frontend
- Verification template status for stage-specific checks

## Use case mapping

1. Continuous integration to dev:
- New image tag arrives.
- Warehouse detects Freight.
- Dev promotes automatically.

2. Quality gate in staging:
- Freight from dev reaches staging.
- Staging auto-promotes only after upstream criteria are met.

3. Controlled release to production:
- Production waits for explicit approval.
- Manual promotion creates auditable release intent.

4. Fast rollback path:
- Use Kargo/Argo history to revert to prior known good image tags.
- Keep production manual to prevent accidental forward rollout during incident response.

## Practical troubleshooting

- kubectl context missing:
  - kubectl config get-contexts
  - kubectl config use-context <your-context>
- CRDs not found:
  - install/verify Argo CD and Kargo before applying gitops/kargo
- No new Freight:
  - confirm Warehouse subscriptions point to valid repo/images
  - confirm new tags satisfy semver constraints
- Stage does not advance:
  - inspect verification template outcomes and Stage conditions

## Notes from current validation in this workspace

- Local manifest render checks succeeded for all overlays and gitops bundles.
- Local runtime endpoints were healthy during smoke tests:
  - backend /api/releases: 200
  - backend /api/clusters: 200
  - frontend /: 200
  - artifact_mcp /sse: 200
  - deployment_mcp /sse: 200
  - deviation_mcp /sse: 200
- Cluster-side apply and promotion execution require an active kubectl context.
