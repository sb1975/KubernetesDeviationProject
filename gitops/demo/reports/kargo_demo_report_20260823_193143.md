# Kargo Demo Report

- Timestamp: 2026-08-23T19:53:46-05:00
- Context: kind-dev
- Argo URL: http://localhost:31080
- Kargo URL: http://localhost:31081

## Argo Applications
```text
NAME                       SYNC STATUS   HEALTH STATUS
k8s-deviation-dev          Synced        Degraded
k8s-deviation-staging      Synced        Degraded
k8s-deviation-production   Synced        Degraded
```

## Kargo Demo Project Resources
```text
NAME                                       READY   STATUS                                AGE
project.kargo.akuity.io/k8s-deviation      True    Project is synced and ready for use   7h14m
project.kargo.akuity.io/kargo-image-demo   True    Project is synced and ready for use   46m

NAME                                             READY   STATUS                                      AGE
projectconfig.kargo.akuity.io/kargo-image-demo   True    ProjectConfig is synced and ready for use   46m

NAME                                      SHARD   AGE
warehouse.kargo.akuity.io/image-freight           46m

NAME                               SHARD   CURRENT FREIGHT   HEALTH   READY   STATUS   AGE
stage.kargo.akuity.io/dev                  N/A                        True             46m
stage.kargo.akuity.io/production           N/A                        True             46m
stage.kargo.akuity.io/staging              N/A                        True             46m

NAME                                                               ALIAS       ORIGIN (KIND)   ORIGIN (NAME)   AGE
freight.kargo.akuity.io/690a022f33e0c4bca3f166c427ac9832e5c9785a   oily-kudu   Warehouse       image-freight   46m
```

## Promotions
```text
```

## Warehouse Status
```text
apiVersion: kargo.akuity.io/v1alpha1
kind: Warehouse
metadata:
  annotations:
    kargo.akuity.io/refresh: "2026-08-24T00:49:18Z"
    kubectl.kubernetes.io/last-applied-configuration: |
      {"apiVersion":"kargo.akuity.io/v1alpha1","kind":"Warehouse","metadata":{"annotations":{},"name":"image-freight","namespace":"kargo-image-demo"},"spec":{"interval":"1m","subscriptions":[{"image":{"repoURL":"public.ecr.aws/nginx/nginx","semverConstraint":"\u003e=1.27.0"}}]}}
  creationTimestamp: "2026-08-24T00:07:03Z"
  generation: 1
  name: image-freight
  namespace: kargo-image-demo
  resourceVersion: "13688"
  uid: b8cd372d-855d-4e9c-b723-c3d170a91fff
spec:
  freightCreationPolicy: Automatic
  interval: 1m0s
  subscriptions:
  - image:
      discoveryLimit: 20
      imageSelectionStrategy: SemVer
      repoURL: public.ecr.aws/nginx/nginx
      semverConstraint: '>=1.27.0'
      strictSemvers: true
status:
  conditions:
  - lastTransitionTime: "2026-08-24T00:07:03Z"
    message: Successfully discovered artifacts from 1 subscriptions
    observedGeneration: 1
    reason: ArtifactsDiscovered
    status: "True"
    type: Ready
  - lastTransitionTime: "2026-08-24T00:07:03Z"
    message: ""
    observedGeneration: 1
    reason: ReconciliationSucceeded
    status: "True"
    type: Healthy
  - lastTransitionTime: "2026-08-24T00:49:36Z"
    message: Freight creation criteria satisfied
    observedGeneration: 1
    reason: CriteriaSatisfied
    status: "True"
    type: FreightCreationCriteriaSatisfied
  - lastTransitionTime: "2026-08-24T00:49:36Z"
    message: Freight composed of the newest artifacts already exists
    observedGeneration: 1
    reason: AlreadyExists
    status: "False"
    type: FreightCreated
  discoveredArtifacts:
    discoveredAt: "2026-08-24T00:49:36Z"
    images:
    - references:
      - createdAt: "2026-08-19T19:08:28Z"
        digest: sha256:43583f773e79fbf5c42daf8680d72987998c21f1812ce654ce9011366531e15c
        tag: 1.31.4
      - createdAt: "2026-08-19T20:10:08Z"
        digest: sha256:c4994689fdab5e5aedb601cd584f4bfbcb5af5b89900d78abd4292cf56706e84
        tag: 1.31.4-trixie-perl-arm64v8
      - createdAt: "2026-08-19T20:10:16Z"
        digest: sha256:a4c62dcaf3c170d6c6fd922ebdee3b08f9b402d8d8ec73f2dbdc54ff9735c0f9
        tag: 1.31.4-trixie-perl-amd64
      - createdAt: "2026-08-19T20:10:16Z"
        digest: sha256:75e6c0d88b87d688d86e67b486755f74379e34bfee55bf1c4fa15d9166754c9e
        tag: 1.31.4-trixie-perl
      - createdAt: "2026-08-19T20:10:31Z"
        digest: sha256:a3e8f166b139ab7a0fbad683237900fe7db4ff5ac42a879d331a2a1b56cddb20
        tag: 1.31.4-trixie-otel-arm64v8
      - createdAt: "2026-08-19T20:10:51Z"
        digest: sha256:028afb7452834f9f547b3d6a68d846ef6d4a1d93552d5aaa4cbdec6f9e39c245
        tag: 1.31.4-trixie-otel-amd64
      - createdAt: "2026-08-19T20:10:51Z"
        digest: sha256:22547e69e4445c268f212e51f88487fe9074e5c0a625c96afaf22aad9df02bf5
        tag: 1.31.4-trixie-otel
      - createdAt: "2026-08-19T20:10:08Z"
        digest: sha256:c4994689fdab5e5aedb601cd584f4bfbcb5af5b89900d78abd4292cf56706e84
        tag: 1.31.4-perl-arm64v8
      - createdAt: "2026-08-19T20:10:16Z"
        digest: sha256:a4c62dcaf3c170d6c6fd922ebdee3b08f9b402d8d8ec73f2dbdc54ff9735c0f9
        tag: 1.31.4-perl-amd64
      - createdAt: "2026-08-19T20:10:16Z"
        digest: sha256:75e6c0d88b87d688d86e67b486755f74379e34bfee55bf1c4fa15d9166754c9e
        tag: 1.31.4-perl
      - createdAt: "2026-08-19T20:10:31Z"
        digest: sha256:a3e8f166b139ab7a0fbad683237900fe7db4ff5ac42a879d331a2a1b56cddb20
        tag: 1.31.4-otel-arm64v8
      - createdAt: "2026-08-19T20:10:51Z"
        digest: sha256:028afb7452834f9f547b3d6a68d846ef6d4a1d93552d5aaa4cbdec6f9e39c245
        tag: 1.31.4-otel-amd64
      - createdAt: "2026-08-19T20:10:51Z"
        digest: sha256:22547e69e4445c268f212e51f88487fe9074e5c0a625c96afaf22aad9df02bf5
        tag: 1.31.4-otel
      - createdAt: "2026-08-19T19:08:11Z"
        digest: sha256:479840e5b051913defec7dbf1c833296ba34e848e3e13c8bb34c4bbbfcdf36d8
        tag: 1.31.4-arm64v8
      - createdAt: "2026-08-19T19:08:28Z"
        digest: sha256:437dabb028ff2aa0909f9e9028b91d2b10f476b531122168c903451eb7f84b36
        tag: 1.31.4-amd64
      - createdAt: "2026-08-19T19:07:51Z"
        digest: sha256:d8a0f95eedab8fcd9d8d013acab7eedef7fc3ceb1020a6e004bc238258b410d8
        tag: 1.31.4-alpine3.24-slim-arm64v8
      - createdAt: "2026-08-19T19:08:08Z"
        digest: sha256:2993922794016d694a6e3f0540e6ffab8ffb22d3a651bbc599b77c0f5c30acb3
        tag: 1.31.4-alpine3.24-slim-amd64
      - createdAt: "2026-08-19T19:08:08Z"
        digest: sha256:9fe20ed1c09ced5d518ce69822773991e5c7bdc527d66875135792c605611e5b
        tag: 1.31.4-alpine3.24-slim
      - createdAt: "2026-08-19T20:52:15Z"
        digest: sha256:f835682eca0c34193571983934c86207c86e7c9f568a7d5b2763a3041af5d6dc
        tag: 1.31.4-alpine3.24-perl-arm64v8
      - createdAt: "2026-08-19T20:52:28Z"
        digest: sha256:abff62855756c8f741b8dd9f4458fa12b1c73b0c0bb79805e14b658bf4f96d47
        tag: 1.31.4-alpine3.24-perl-amd64
      repoURL: public.ecr.aws/nginx/nginx
  lastFreightID: 0d2d8390c31f642e1fda922eaeb58cfecfcced78
  lastHandledRefresh: "2026-08-24T00:49:18Z"
  observedGeneration: 1
```
