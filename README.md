# sdxl-kube

Kubernetes/EKS lab for running an SDXL-style image generation backend on a GPU
node. This repo was extracted from `hopper-gen` so the product app can stay
focused while this repo becomes the clean infra case study.

The goal is to understand the full request path:

```text
client -> Ingress/ALB -> Service -> FastAPI Pod -> GPU node -> S3 image
```

## Current Status

- `container/` contains the mock FastAPI generation API and Dockerfile.
- `deployment.yml` contains the local Minikube Deployment and ClusterIP Service,
  including readiness and liveness probes.
- `pulumi/` contains the minimal internal-only AWS/EKS foundation: VPC, EKS,
  CPU node group, ECR, S3, and the AWS Load Balancer Controller.
- `cdk/` is kept for reference while the repo transitions to Pulumi.
- The first AWS milestone is **EKS foundation bring-up**. Public NLB/ALB
  exposure for the mock API is handled by an ALB Ingress. GPU node groups are
  intentionally a later milestone.

## Top-Down Mental Model

1. **Pulumi creates AWS resources**
   - EKS cluster
   - CPU node group for the mock API and system workloads
   - ECR repo for the backend image
   - S3 bucket for generated PNGs

2. **Kubernetes schedules the backend**
   - `Deployment` asks for one replica of the FastAPI container.
   - Readiness probe calls `/ready`.
   - Liveness probe calls `/health`.
   - Future GPU scheduling will add GPU node groups, node selectors,
     tolerations, and `nvidia.com/gpu` resource requests.

3. **Networking routes traffic**
   - `Service` gives pods a stable internal endpoint.
   - `Ingress` is the public HTTP front door.
   - The AWS Load Balancer Controller reconciles the Ingress into an ALB.

4. **GitHub Actions deploys the app**
   - Pulumi creates the ECR repository and cluster.
   - The manual deploy workflow builds `container/Dockerfile`.
   - The workflow pushes the image to ECR using the current Git SHA as the tag.
   - The workflow applies `k8s/aws/sdxl-kube.yaml` and prints the ALB hostname.

## Useful Commands

```bash
# AWS infra preview
export PULUMI_BACKEND_URL="s3://REPLACE_WITH_PULUMI_STATE_BUCKET"
export PULUMI_CONFIG_PASSPHRASE="replace-me"
pulumi login "$PULUMI_BACKEND_URL"
cd pulumi
bun install
pulumi stack select dev --create --secrets-provider passphrase
pulumi preview

# Manual hosted endpoint deploy
# Run the GitHub Actions workflow_dispatch with:
# action=deploy
# node_desired_size=1
# confirm=deploy

# Cluster orientation
kubectl get nodes -o wide
kubectl get ns
kubectl get deploy,rs,pods,svc
kubectl describe pod -l app=sdxl-kube
kubectl logs deployment/sdxl-kube
kubectl get events --sort-by=.lastTimestamp
```

ECR stores built images, not Dockerfiles. The future AWS image path is:
build from `container/Dockerfile`, push the image to ECR, then update the
Kubernetes Deployment image to the ECR image URI.

## What To Learn Here

- Why a pod can be `Pending`.
- How labels connect Deployments, Pods, and Services.
- Why EKS Ingress needs a controller.
- How GPU scheduling differs from normal CPU workloads.
- Why slow model startup changes readiness, liveness, and rollout strategy.
- How this compares to Modal's `gpu=...`, `modal.Image`, Volumes, and memory/GPU snapshots.

For a top-down walkthrough, use `docs/kubernetes-top-down.md`.
