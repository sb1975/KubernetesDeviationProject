# GitOps Promotion with Kargo (dev -> staging -> production)

This folder adds a production-style promotion pipeline to this project using Argo CD + Kargo.

For a step-by-step user walkthrough, test plan, and use-case explanations, see `gitops/USER_README.md`.

For a three-cluster Freight demo with runnable scripts, see `gitops/demo/KARGO_FREIGHT_DEMO.md`.

## Layout

- `apps/k8s-deviation/base`: shared app manifests
- `apps/k8s-deviation/overlays/dev`: dev environment overlay
- `apps/k8s-deviation/overlays/staging`: staging environment overlay
- `apps/k8s-deviation/overlays/production`: production environment overlay
- `argocd/`: Argo CD `Application` resources for each environment
- `kargo/`: Kargo `Project`, `Warehouse`, `Stage`, and verification templates

## Promotion model

- `Warehouse` tracks Git plus backend/frontend image streams.
- `Stage dev` receives freight directly from the warehouse.
- `Stage staging` receives promoted freight from `dev`.
- `Stage production` receives promoted freight from `staging`.
- Each stage updates image tags in its own overlay path.
- Verification gates are defined via analysis templates before advancing.

## One-time setup

1. Replace placeholders in all manifests:
   - `https://github.com/sb1975/KubernetesDeviationProject.git`
   - `ghcr.io/sb1975/kubernetes-deviation-backend`
   - `ghcr.io/sb1975/kubernetes-deviation-frontend`

2. Install Argo CD and Kargo in your cluster.

3. Apply Argo CD applications:

```bash
kubectl apply -k gitops/argocd
```

4. Apply Kargo objects:

```bash
kubectl apply -k gitops/kargo
```

## Trigger and observe promotions

List stages and freight:

```bash
kubectl get stages -n k8s-deviation
kubectl get freight -n k8s-deviation
```

Start a promotion:

```bash
# Example using kubectl plugin style if installed
kubectl kargo promote stage/dev -n k8s-deviation
kubectl kargo promote stage/staging -n k8s-deviation
kubectl kargo promote stage/production -n k8s-deviation
```

## How this maps to existing project logic

- Existing brownfield checks from `MCP_Agents/Deviation_mcp.py` remain the source of truth for drift/deviation logic.
- Existing release metadata (`MCP_Agents/release/*.json`) can continue to drive image version strategy.
- Kargo now controls *promotion between environments* while Argo CD controls *sync to cluster*.

## Suggested next hardening

- Add signed image verification before production stage.
- Require manual approval for production promotions.
- Add canary verification in staging.
- Feed report IDs from `MCP_Agents/reports` into stage annotations for auditability.
