# sdxl-kube CDK

AWS CDK stack for the SDXL Kubernetes lab.

It creates:

- EKS cluster
- one small CPU node group for system workloads
- one GPU node group capped at one `g5.xlarge`, desired size 0 by default
- ECR repository for the FastAPI backend image
- S3 bucket for generated images
- Kubernetes namespace and IAM-backed service account

The stack does **not** install the AWS Load Balancer Controller yet. The first
milestone is proving the backend pod can schedule and boot on a GPU node.

## Useful Commands

```bash
bun install --frozen-lockfile
bun run build
node node_modules/aws-cdk/bin/cdk synth
node node_modules/aws-cdk/bin/cdk diff
node node_modules/aws-cdk/bin/cdk deploy
```

The CDK CLI currently runs under Node here. Bun is fine for installing and
compiling, but `bunx cdk` hit a WebAssembly runtime issue with this CDK version.
Use Node 20+ for the CDK CLI.
