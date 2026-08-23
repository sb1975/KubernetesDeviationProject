# Kargo Freight Demo (Three Clusters)

This demo uses three local kind clusters and a sample image-tag Freight change.

## Objective

- Keep three environments isolated by cluster:
  - dev -> kind-dev
  - staging -> kind-staging
  - production -> kind-production
- Demonstrate a new Freight candidate entering dev first.
- Verify staged progression before production.

## Sample Freight change implemented

The dev overlay image tags are bumped to 0.2.0-dev:

- gitops/apps/k8s-deviation/overlays/dev/kustomization.yaml

Staging and production remain on prior tags until promoted.

## 1) Ensure three clusters

Run:

- bash gitops/demo/ensure_three_clusters.sh

Expected outcome:

- kind clusters: dev, staging, production
- contexts: kind-dev, kind-staging, kind-production
- each context has a Ready control-plane node

## 2) Deploy each environment to its matching cluster

Run:

- kubectl --context kind-dev apply -k gitops/apps/k8s-deviation/overlays/dev
- kubectl --context kind-staging apply -k gitops/apps/k8s-deviation/overlays/staging
- kubectl --context kind-production apply -k gitops/apps/k8s-deviation/overlays/production

Wait for rollouts:

- kubectl --context kind-dev -n k8s-deviation-dev rollout status deploy/k8s-deviation-backend
- kubectl --context kind-dev -n k8s-deviation-dev rollout status deploy/k8s-deviation-frontend
- kubectl --context kind-staging -n k8s-deviation-staging rollout status deploy/k8s-deviation-backend
- kubectl --context kind-staging -n k8s-deviation-staging rollout status deploy/k8s-deviation-frontend
- kubectl --context kind-production -n k8s-deviation-production rollout status deploy/k8s-deviation-backend
- kubectl --context kind-production -n k8s-deviation-production rollout status deploy/k8s-deviation-frontend

## 3) Verify image tags across all environments

Run:

- bash gitops/demo/verify_images_across_envs.sh

Expected state after sample change:

- dev uses 0.2.0-dev tags
- staging keeps 0.1.0-staging tags
- production keeps 0.1.0 tags

This is the Freight concept in action: change appears in dev first, not everywhere at once.

## 4) Promote dev -> staging (Kargo flow)

In a Kargo-enabled cluster, trigger promotion to staging:

- kubectl kargo promote stage/staging -n k8s-deviation

Or Kargo CLI style:

- kargo promote --project k8s-deviation --stage staging --warehouse k8s-deviation-warehouse

Then re-run:

- bash gitops/demo/verify_images_across_envs.sh

Expected:

- staging images match dev candidate (0.2.0-dev or the promoted tag strategy)
- production unchanged

## 5) Promote staging -> production (manual gate)

Production should stay manual by policy. Promote explicitly:

- kubectl kargo promote stage/production -n k8s-deviation

Or:

- kargo promote --project k8s-deviation --stage production --warehouse k8s-deviation-warehouse

Re-run verification script and confirm production now matches promoted Freight.

## 6) Audit checks

Useful commands:

- kubectl get stage -n k8s-deviation
- kubectl get freight -n k8s-deviation
- kubectl get promotions -n k8s-deviation
- kubectl describe stage dev -n k8s-deviation
- kubectl describe stage staging -n k8s-deviation
- kubectl describe stage production -n k8s-deviation

## Notes

- This repository already configures production as manual at:
  - gitops/kargo/05-project-config.yaml
- If image tags do not exist in registry, rollout may fail even though the promotion logic is correct.
- For offline/demo-only validation, use kustomize rendering and deployment spec checks.