---
marp: true
title: Kargo GitOps Promotion Demo
author: KubernetesDeviation Project
theme: default
paginate: true
---

# Kargo GitOps Promotion Demo

Architecture, Concepts, and Live Walkthrough

- Control plane: Argo CD + Argo Rollouts + Kargo
- Workload pipeline: dev -> staging -> production
- Demo mode: UI-first, with terminal checks for proof

---

# Problem Statement

Why teams need Kargo with GitOps:

- Deploying is easy, promoting safely is hard.
- Multi-environment releases need policy and auditability.
- Teams need repeatable promotion gates, not ad hoc scripts.

Kargo solves promotion orchestration across environments.

---

# Architecture Overview

```mermaid
flowchart LR
  A[GitOps Repo] --> B[Argo CD]
  C[Artifact Source]\n(public.ecr.aws/nginx/nginx) --> D[Warehouse]
  D --> E[Freight]
  E --> F[Stage dev]
  F --> G[Stage staging]
  G --> H[Stage production]
  F --> B
  G --> B
  H --> B
```

- Argo CD syncs desired state from Git.
- Kargo discovers artifacts and models them as Freight.
- Stages define progression and policy.

---

# Core Kargo Concepts

- Project: boundary for pipeline resources.
- Warehouse: discovers candidate artifacts.
- Freight: immutable snapshot of discovered artifacts.
- Stage: environment gate where Freight is promoted.
- Promotion: transition of Freight into a Stage.
- Verification: checks that determine readiness for next stage.

---

# This Repo: Two Demo Tracks

Track A (works now):

- Project: kargo-image-demo
- Artifact source: public image feed
- Goal: UI demonstration of Freight and stage workflow

Track B (full app pipeline):

- Project: k8s-deviation
- Artifact source: Git + private GHCR images
- Requires GHCR read access for warehouse discovery

---

# Three-Environment Model

- dev: fast feedback, can auto-promote.
- staging: integration and confidence gate.
- production: manual control point.

Policy pattern:

- dev auto-promotion enabled
- staging auto-promotion enabled
- production auto-promotion disabled

---

# End-to-End Demo Flow

1. Open Argo CD and Kargo UIs.
2. Validate Argo apps are Synced from feature branch.
3. Open kargo-image-demo and confirm Freight appears.
4. Promote Freight through stages in UI.
5. Observe promotion history and stage state.
6. Show manual-control story for production.

---

# Use Case Demos: From Deviation Detection to Kargo Promotion

The project's existing `application_release.json` / `cluster_release.json`
baselines (R1 to R4) already describe 5 real drift patterns. Each becomes an
independent Kargo Project demo:

1. nginx: image version promotion
2. nginx: replica scale-out (config-only Freight)
3. httpd: mixed auto/manual policy promotion
4. memcached: verification-gated promotion
5. Cluster release upgrade: fleet rollout (c1, c2, c3)

---

# Use Case 1: nginx Image Version Promotion

Explanation:

- Mirrors R1 to R4: nginx 1.24.0 to 1.25.5 to 1.26.2 to 1.27.0.
- Warehouse subscribes directly to the public nginx image repo.
- Each new tag becomes a Freight automatically, no manifest edit needed.

Demo steps:

1. Create Warehouse subscribing to `image: nginx`, semver constraint.
2. Create Stages `dev`, `staging`, `production` (all manual promotion).
3. Confirm Freight appears for the newest discovered tag.
4. Promote Freight dev to staging to production, verifying pods roll.
5. Show `kubectl get freight,stage,promotions` as audit evidence.

---

# Use Case 2: nginx Replica Scale-Out (Config-Only Freight)

Explanation:

- Mirrors the R3 change: nginx replicas 1 to 2, no image change.
- Freight here originates from a Git subscription, not an image registry.
- Demonstrates that Freight can carry manifest/config changes alone.

Demo steps:

1. Edit the nginx overlay `replicas: 2` and commit to the tracked branch.
2. Warehouse (git subscription) discovers the new commit as Freight.
3. Promote through dev, staging, production stages manually.
4. Verify replica count increases per environment after each promotion.
5. Contrast with Use Case 1: same pipeline, different Freight source.

---

# Use Case 3: httpd Mixed Auto/Manual Policy Promotion

Explanation:

- Mirrors httpd 2.4.57 to 2.4.60 across R1 to R4.
- ProjectConfig sets dev and staging to auto-promote, production manual.
- Demonstrates policy-driven automation with a human approval gate.

Demo steps:

1. Create Warehouse subscribing to `image: httpd`.
2. Set `ProjectConfig.promotionPolicies`: dev auto, staging auto, prod manual.
3. Push a new httpd tag and watch dev and staging auto-promote.
4. Manually approve the production promotion in Kargo UI.
5. Show the freight timeline color-matching each stage as it advances.

---

# Use Case 4: memcached Verification-Gated Promotion

Explanation:

- Mirrors memcached 1.6.21 to 1.6.29 across R1 to R4.
- Public image, so pods actually run, unlike the private GHCR demo.
- Re-introduces AnalysisTemplates to gate promotion on real health checks.

Demo steps:

1. Create Warehouse subscribing to `image: memcached`.
2. Add an AnalysisTemplate probing the memcached service/port.
3. Promote to dev, then let verification run before staging becomes eligible.
4. Show a failed verification case (bad tag) blocking promotion.
5. Promote once verification passes, closing the health-gated story.

---

# Use Case 5: Cluster Release Upgrade (Fleet Rollout)

Explanation:

- Mirrors `cluster_release.json`: k8s 1.27 to 1.28 to 1.29 to 1.30.
- Stages map to real clusters instead of namespaces: c1, c2, c3.
- Promotion step reprovisions the target kind cluster to the new node image.

Demo steps:

1. Create Warehouse subscribing to `cluster_release.json` via git.
2. Map Stages: `c1` (dev), `c2` (staging), `c3` (production).
3. Promote R-release Freight from c1 to c2 to c3 in sequence.
4. Each promotion step swaps the kind node image and re-verifies version.
5. Run a brownfield Scan afterward to show the deviation has cleared.

---

# Follow-Along: Step 0 (Terminal Setup)

Run one guided command:

- `bash gitops/demo/run_kargo_demo.sh`

Optional non-interactive run:

- `bash gitops/demo/run_kargo_demo.sh --auto`

What this prepares:

- UI port-forwards
- Argo app status checks
- Kargo demo project apply
- Freight discovery wait

---

# Follow-Along: Step 1 (Open UIs)

Open in browser:

1. `http://localhost:31080` (Argo CD)
2. `http://localhost:31081` (Kargo)

Credentials:

- Argo CD: `admin / admin`
- Kargo: `admin / admin`

Goal:

- Show that both control planes are reachable before the promotion story starts.

---

# Follow-Along: Step 2 (Argo Baseline)

In Argo CD, show these apps:

1. `k8s-deviation-dev`
2. `k8s-deviation-staging`
3. `k8s-deviation-production`

Call out:

- Source branch is `feature/sudeep-code`.
- Path exists and sync is active.

---

# Follow-Along: Step 3 (Kargo Baseline)

In Kargo UI:

1. Select project `kargo-image-demo`.
2. Confirm `Warehouse image-freight` is healthy.
3. Confirm Freight appears in timeline.
4. Confirm stages: `dev`, `staging`, `production`.

Narration:

- Freight is the artifact snapshot that moves across stages.

---

# Follow-Along: Step 4 (Promotions in UI)

In Kargo UI perform:

1. Promote Freight to `dev`.
2. Promote Freight to `staging`.
3. Promote Freight to `production` manually.

Explain:

- Production is manual by policy.
- Each promotion is traceable.

---

# Follow-Along: Step 5 (Proof & Audit)

Terminal evidence commands:

- `kubectl --context kind-dev -n kargo-image-demo get warehouse,freight,stage,promotions`
- `kubectl --context kind-dev -n argocd get app`

Expected:

- Freight present.
- Promotion records visible.
- Stage states updated.

---

# Follow-Along: Step 6 (Post-Demo Report)

The runner writes a timestamped report automatically:

- `gitops/demo/reports/kargo_demo_report_<timestamp>.md`

Use the report for:

- stakeholder sharing
- evidence of run state
- quick troubleshooting notes

---

# Live Validation Commands

Use terminal as evidence during the demo:

- kubectl --context kind-dev -n argocd get app
- kubectl --context kind-dev -n kargo-image-demo get warehouse,freight,stage,promotions
- kubectl --context kind-dev -n k8s-deviation get warehouse,freight,stage

These commands anchor what the audience sees in UI.

---

# GUI Screens To Highlight

Argo CD:

- App source path and branch
- Sync and health status
- Resource tree

Kargo:

- Freight timeline
- Stage nodes and current Freight
- Promotion run details
- Project policy behavior

---

# Risk and Troubleshooting Narrative

Common blockers and fixes:

- App path does not exist: push branch and hard refresh app.
- Warehouse discovery fails: artifact registry access denied.
- No Freight yet: wait for warehouse interval or force refresh.
- Stage stuck: inspect Stage status and Promotion details.

---

# Operational Outcome

After adopting Kargo:

- Promotions become explicit, observable, and auditable.
- Environment policy is encoded, not tribal knowledge.
- Demo path scales into real production promotion practice.

---

# 7-Minute Speaker Script

0:00 to 0:45

- Introduce the release-risk problem and why GitOps needs promotion control.

0:45 to 1:30

- Explain architecture: Argo CD for sync, Kargo for promotion orchestration.

1:30 to 2:15

- Define Project, Warehouse, Freight, Stage, and Promotion in one pass.

2:15 to 3:00

- Show Argo UI baseline: branch, path, sync state for three environments.

3:00 to 4:15

- Open Kargo UI project `kargo-image-demo` and show discovered Freight.

4:15 to 5:30

- Promote Freight through dev and staging, then show manual production gate.

5:30 to 6:15

- Run terminal proof commands for Freight, Stage, and Promotion records.

6:15 to 7:00

- Close with governance message: policy-driven promotion and audit trail.

---

# Azure Operator Nexus: Argo CD Agent Architecture

Why not `az connectedk8s proxy`:

- It opens a blocking, interactive session per cluster for troubleshooting.
- Not designed to be a standing channel for 500 continuously-reconciling sites.

Argo CD Agent flips the connection direction:

- Principal (hub) runs centrally: argocd-server, repo-server, redis, Kargo.
- A lightweight Agent runs in each AON site cluster and dials out to the hub.
- mTLS gRPC, self-healing, no inbound reachability into any AON site required.
- Kargo is unaffected: it only ever talks to the Argo CD API on the hub.

---

# AON Onboarding: Install the Principal (Hub, one time)

```bash
# 1. Argo CD control-plane components (server, repo-server, redis)
kubectl apply -n argocd --server-side \
  -k "https://github.com/argoproj-labs/argocd-agent/install/kubernetes/argo-cd/principal?ref=main" \
  --context <hub-context>

# 2. Initialize the mTLS certificate authority
argocd-agentctl pki init \
  --principal-context <hub-context> --principal-namespace argocd

# 3. Install the Principal component
kubectl apply -n argocd \
  -k "https://github.com/argoproj-labs/argocd-agent/install/kubernetes/principal?ref=main" \
  --context <hub-context>

# 4. Expose the Principal gRPC endpoint (LoadBalancer/NodePort reachable by sites)
kubectl patch svc argocd-agent-principal -n argocd --context <hub-context> \
  --patch '{"spec":{"type":"LoadBalancer"}}'

# 5. Issue Principal + resource-proxy certs, and the JWT signing key
argocd-agentctl pki issue principal --principal-context <hub-context> \
  --principal-namespace argocd --ip <hub-ip> --dns <hub-dns> --upsert
argocd-agentctl pki issue resource-proxy --principal-context <hub-context> \
  --principal-namespace argocd --ip <hub-ip> --dns <hub-dns> --upsert
argocd-agentctl jwt create-key --principal-context <hub-context> \
  --principal-namespace argocd --upsert
```

---

# AON Onboarding: Register Each Site Cluster (repeat per site)

```bash
export SITE_ID=aon-site-042   # unique per AON cluster

# 1. Argo CD workload components (application-controller runs on the site)
kubectl apply -n argocd --server-side \
  -k "https://github.com/argoproj-labs/argocd-agent/install/kubernetes/argo-cd/agent-managed?ref=main" \
  --context $SITE_ID

# 2. Register the site identity on the hub
argocd-agentctl agent create $SITE_ID \
  --principal-context <hub-context> --principal-namespace argocd \
  --resource-proxy-server <hub-ip>:9090

# 3. Issue the site's client certificate
argocd-agentctl pki issue agent $SITE_ID \
  --principal-context <hub-context> --agent-context $SITE_ID \
  --agent-namespace argocd --upsert

# 4. Deploy the Agent on the site cluster
kubectl apply -n argocd \
  -k "https://github.com/argoproj-labs/argocd-agent/install/kubernetes/agent?ref=main" \
  --context $SITE_ID

# 5. Point the Agent at the hub and restart
kubectl patch configmap argocd-agent-params -n argocd --context $SITE_ID \
  --patch "{\"data\":{\"agent.server.address\":\"<hub-ip>\",\"agent.mode\":\"managed\"}}"
kubectl rollout restart deployment argocd-agent-agent -n argocd --context $SITE_ID

# 6. Verify the site shows up as connected on the hub
argocd-agentctl agent list \
  --principal-context <hub-context> --principal-namespace argocd
```

Kargo + rings: Argo CD `Application.spec.destination.name` targets a
`$SITE_ID` directly (destination-based mapping) — map ring 0/1/2 site IDs to
Kargo `dev`/`staging`/`production` Stages, unchanged from the app-level model.

---

# Additional Kargo Use Cases

Application Level | Cluster Level
- Helm chart version promotion | Node pool / AMI rolling upgrade
- Config/feature-flag rollout via git Freight | CNI, CSI, ingress controller add-on upgrades
- Canary analysis via Argo Rollouts metrics | OPA/Gatekeeper policy bundle rollout
- Multi-service bundled release (frontend + backend Freight) | Resource quota / autoscaler config promotion
- Expedited security-patch lane (bypass soak time) | Multi-region cluster promotion for DR readiness
- Database migration image gated by verification | Certificate authority rotation rollout

---

# Appendix: Demo Assets

- Slide deck: gitops/demo/KARGO_ARCHITECTURE_DEMO_SLIDES.md
- Guided runner: gitops/demo/run_kargo_demo.sh
- Demo manifests: gitops/demo/kargo-image-freight-demo.yaml
- Reference walkthrough: gitops/demo/KARGO_FREIGHT_DEMO.md
