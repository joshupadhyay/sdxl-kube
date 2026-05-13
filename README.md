# sdxl-kube

Kubernetes/EKS lab for running an SDXL-style image generation backend on a GPU
node. This repo was extracted from `hopper-gen` so the product app can stay
focused while this repo becomes the clean infra case study.

The goal is to understand the full request path:

```text
client -> Ingress/ALB -> Service -> FastAPI Pod -> GPU node -> S3 image
```

## Current Status

- `backend/` contains the standalone FastAPI + diffusers inference server.
- `cdk/` creates the AWS foundation: EKS cluster, CPU node group, GPU node
  group, ECR repo, S3 bucket, and service account.
- `k8s/` contains the Kubernetes app objects: namespace, deployment, service,
  secret, and an experimental ingress.
- The first milestone is **GPU pod bring-up**. Ingress/ALB is intentionally a
  second milestone because the AWS Load Balancer Controller is not installed by
  the CDK stack yet.

## Top-Down Mental Model

1. **CDK creates AWS resources**
   - EKS cluster
   - CPU node group for system workloads
   - GPU node group for SDXL inference
   - ECR repo for the backend image
   - S3 bucket for generated PNGs
   - IAM-backed Kubernetes service account

2. **Kubernetes schedules the backend**
   - `Deployment` asks for one replica of the FastAPI container.
   - `nodeSelector` and `tolerations` place it on a GPU node.
   - `resources.requests["nvidia.com/gpu"] = 1` asks Kubernetes for a GPU.
   - Readiness/liveness probes call `/health`.

3. **Networking routes traffic**
   - `Service` gives pods a stable internal endpoint.
   - `Ingress` is the future public HTTP front door.
   - On EKS, an Ingress only works after an ingress controller exists.

## Useful Commands

```bash
# AWS infra
bun run cdk:build
bun run cdk:synth
bun run cdk:deploy

# Cluster orientation
kubectl get nodes -o wide
kubectl get ns
kubectl get deploy,rs,pods,svc,ingress -n sdxl-kube
kubectl describe pod -n sdxl-kube <pod-name>
kubectl logs -n sdxl-kube <pod-name>
kubectl get events -n sdxl-kube --sort-by=.lastTimestamp
```

The CDK CLI scripts require Node 20+ on `PATH`.

## Manifest Rendering

The deployment manifest contains shell placeholders for the image and bucket:

- `${ECR_BACKEND_URI}`
- `${IMAGE_TAG}`
- `${S3_BUCKET}`

Render before applying:

```bash
export ECR_BACKEND_URI="..."
export IMAGE_TAG="..."
export S3_BUCKET="..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
envsubst < k8s/backend-deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/backend-service.yaml
```

Apply the namespace and secret before the deployment.

## What To Learn Here

- Why a pod can be `Pending`.
- How labels connect Deployments, Pods, and Services.
- Why EKS Ingress needs a controller.
- How GPU scheduling differs from normal CPU workloads.
- Why slow model startup changes readiness, liveness, and rollout strategy.
- How this compares to Modal's `gpu=...`, `modal.Image`, Volumes, and memory/GPU snapshots.

For a top-down walkthrough, use `docs/kubernetes-top-down.md`.
