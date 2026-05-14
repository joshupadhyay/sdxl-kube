# Pulumi EKS

This directory contains the Pulumi TypeScript infrastructure for the AWS/EKS
version of the SDXL Kubernetes lab.

## State Backend

This repo uses a self-managed Pulumi S3 backend. Create the state bucket manually
in AWS first, then point Pulumi at it:

```bash
export PULUMI_BACKEND_URL="s3://REPLACE_WITH_PULUMI_STATE_BUCKET"
export PULUMI_CONFIG_PASSPHRASE="replace-me"
pulumi login "$PULUMI_BACKEND_URL"
```

## Preview

```bash
cd pulumi
bun install
pulumi stack select dev --create --secrets-provider passphrase
pulumi config set nodeDesiredSize 1
pulumi preview
```

## What This Creates

- VPC with public and private subnets across two availability zones.
- One NAT gateway so private worker nodes can pull images and reach AWS APIs.
- EKS cluster named `sdxl-kube-eks`.
- One managed CPU node group using `t3.small`.
- ECR repository named `sdxl-kube-api`.
- S3 bucket for future generated images.

This first pass is internal-only: it does not create an ALB, NLB, Ingress, or
public app endpoint.

## Scaling Down

The CPU node group supports a desired size of `0` or `1`.

```bash
pulumi config set nodeDesiredSize 0
pulumi up
```

GitHub Actions runs preview on PRs and pushes to `main`. It only runs
`pulumi up` from the manual workflow when `action=deploy` and `confirm=deploy`.

## Image Flow

ECR stores built images, not Dockerfiles. The future deploy flow is:

```bash
docker build -t sdxl-kube-api ./container
docker tag sdxl-kube-api <ecr-repo-url>:<tag>
docker push <ecr-repo-url>:<tag>
```

Then the Kubernetes Deployment image should be updated to:

```text
<ecr-repo-url>:<tag>
```
