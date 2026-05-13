import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { KubectlV33Layer } from "@aws-cdk/lambda-layer-kubectl-v33";
import { Construct } from "constructs";

export class SdxlKubeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // S3 — generated image storage
    // =========================================================================
    const galleryBucket = new s3.Bucket(this, "SdxlGallery", {
      bucketName: `sdxl-kube-gallery-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
    });

    // =========================================================================
    // ECR — backend container registry
    // Frontend moved to Vercel; only the inference API image lives in EKS.
    // =========================================================================

    const apiRepo = new ecr.Repository(this, "SdxlKubeApi", {
      repositoryName: "sdxl-kube-api",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          maxImageCount: 5,
          description: "Keep last 5 images",
        },
      ],
    });

    // =========================================================================
    // EKS Cluster
    // =========================================================================
    // Start with the smallest practical footprint:
    // - 1 CPU node for system workloads
    // - GPU node group capped at 1 node and scaled down to 0 by default
    // Backend replica count stays at 1 in the Deployment manifest.

    // We can always edit this in CFN console manually, but I don't want this burning cash so default is 0!

    const clusterName = process.env.EKS_CLUSTER_NAME ?? "sdxl-kube-eks";

    const cluster = new eks.Cluster(this, "SdxlKubeCluster", {
      clusterName,
      version: eks.KubernetesVersion.V1_33,
      defaultCapacity: 0,
      kubectlLayer: new KubectlV33Layer(this, "KubectlLayer"),
    });

    cluster.addNodegroupCapacity("CpuNodes", {
      instanceTypes: [new ec2.InstanceType("t3.medium")],
      minSize: 1,
      maxSize: 1,
      desiredSize: 1,
      diskSize: 50,
      labels: { workload: "general" },
    });

    cluster.addNodegroupCapacity("GpuNodes", {
      instanceTypes: [new ec2.InstanceType("g5.xlarge")],
      minSize: 0,
      maxSize: 1,
      desiredSize: 0,
      diskSize: 100,
      labels: { workload: "gpu" },
      taints: [
        {
          key: "nvidia.com/gpu",
          value: "true",
          effect: eks.TaintEffect.NO_SCHEDULE,
        },
      ],
    });

    const ns = cluster.addManifest("SdxlKubeNamespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "sdxl-kube" },
    });

    const backendSA = cluster.addServiceAccount("BackendSA", {
      name: "sdxl-kube-api",
      namespace: "sdxl-kube",
    });
    backendSA.node.addDependency(ns); // add dependency to ensure namespace before creating cluster (CFN failure)
    galleryBucket.grantReadWrite(backendSA); // ensure s3 can serve static assets

    // Leave ALB controller out of the initial bring-up. The first milestone is
    // proving the backend pod can start on a GPU node; ingress can come after.

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "GalleryBucketName", {
      value: galleryBucket.bucketName,
      description: "S3 bucket for generated images",
    });

    new cdk.CfnOutput(this, "ApiRepoUri", {
      value: apiRepo.repositoryUri,
      description: "ECR repo for backend API container",
    });

    new cdk.CfnOutput(this, "EksClusterName", {
      value: cluster.clusterName,
      description: "EKS cluster name",
    });
  }
}
