# Kubernetes Top-Down: SDXL on EKS

Use this as the interrogation map. Start from the user request and walk down the
stack until an image lands in S3.

## 1. User-Facing Request

A client calls:

```http
POST /generate
```

The body contains a prompt and generation parameters. In this repo, FastAPI is
the application server that receives that request.

Key file:

- `backend/api.py`

## 2. Public Entry Point

In production EKS, public HTTP traffic usually enters through:

```text
AWS ALB -> Kubernetes Ingress -> Service -> Pod
```

Important caveat: this repo has an `Ingress` manifest, but CDK does not install
the AWS Load Balancer Controller yet. Without that controller, the Ingress is
just a Kubernetes object; no AWS ALB appears.

Key file:

- `k8s/ingress.yaml`

## 3. Stable Internal Address

Pods are disposable, so clients should not call pod IPs directly. A Kubernetes
`Service` selects matching pods by label and gives them a stable internal name:

```text
backend-svc.sdxl-kube.svc.cluster.local
```

Key file:

- `k8s/backend-service.yaml`

## 4. Running The App

A `Deployment` declares the desired state:

- run one backend replica;
- use this image;
- expose container port `8000`;
- load config from environment variables;
- only schedule on GPU nodes;
- request one NVIDIA GPU;
- call `/health` for readiness and liveness.

Key file:

- `k8s/backend-deployment.yaml`

## 5. Scheduling On A GPU Node

The backend pod needs:

```yaml
nodeSelector:
  workload: gpu
tolerations:
  - key: nvidia.com/gpu
resources:
  requests:
    nvidia.com/gpu: "1"
```

These three ideas are separate:

- `nodeSelector` says which labeled nodes are eligible.
- `tolerations` let the pod land on tainted GPU nodes.
- `nvidia.com/gpu` requests the GPU resource exposed by the NVIDIA device plugin.

If the pod is `Pending`, inspect scheduling first:

```bash
kubectl describe pod -n sdxl-kube <pod>
kubectl get events -n sdxl-kube --sort-by=.lastTimestamp
```

## 6. AWS Foundation

CDK creates the cloud-side primitives:

- EKS cluster
- CPU node group
- GPU node group
- ECR repository
- S3 bucket
- IAM-backed service account

Key file:

- `cdk/lib/cdk-stack.ts`

## 7. The SDXL Runtime

The container starts FastAPI, then loads:

- SDXL base model
- fp16 VAE
- optional LoRA adapter from `ADAPTER_PATH`
- CUDA/TF32/channels-last optimizations
- S3 client

Slow model startup is why readiness and liveness probes need generous delays.

Key files:

- `backend/Dockerfile`
- `backend/api.py`

## 8. Modal Comparison

For FDE interview purposes, translate every EKS concept into the Modal
abstraction:

| EKS/Kubernetes | Modal equivalent |
| --- | --- |
| GPU node group | `gpu="H100"` or similar |
| Docker image build/push/ECR | `modal.Image` |
| Deployment + pod scheduling | `@app.cls` / `@app.function` |
| Ingress + service | Modal web endpoint |
| S3 or PVC | Modal Volume or S3 |
| readiness/liveness tuning | function timeouts, startup timeout, snapshots |
| cold model load | memory/GPU snapshots |
| autoscaling node pools | Modal autoscaling/runtime scheduling |

The right takeaway is not “Kubernetes bad.” It is:

> EKS gives maximum control and enterprise-native integration; Modal removes
> most of the orchestration burden for spiky GPU workloads.

## 9. Debug Order

When something breaks, debug in this order:

1. **Cluster**: `kubectl get nodes -o wide`
2. **Namespace**: `kubectl get ns`
3. **Pod scheduling**: `kubectl get pods -n sdxl-kube -o wide`
4. **Pod reason**: `kubectl describe pod -n sdxl-kube <pod>`
5. **Container logs**: `kubectl logs -n sdxl-kube <pod>`
6. **Service selector**: `kubectl describe svc -n sdxl-kube backend-svc`
7. **Ingress/controller**: `kubectl describe ingress -n sdxl-kube sdxl-kube-ingress`
8. **AWS resources**: EKS node group, ECR image, S3 permissions, security groups

