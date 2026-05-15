import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";

const project = pulumi.getProject();
const stack = pulumi.getStack();
const config = new pulumi.Config();
const clusterName = "sdxl-kube-eks";
const nodeDesiredSize = config.getNumber("nodeDesiredSize") ?? 1;
const commonTags = {
  Project: project,
  Stack: stack,
  ManagedBy: "pulumi",
};

const caller = aws.getCallerIdentityOutput({});

const vpc = new awsx.ec2.Vpc("sdxl-kube-vpc", {
  cidrBlock: "10.42.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  numberOfAvailabilityZones: 2,
  natGateways: {
    // Lower-cost learning setup: one NAT gateway for all private subnets.
    // Production usually uses one NAT gateway per AZ.
    strategy: awsx.ec2.NatGatewayStrategy.Single,
  },
  tags: commonTags,
});

const apiRepository = new aws.ecr.Repository("sdxl-kube-api", {
  name: "sdxl-kube-api",
  imageScanningConfiguration: {
    scanOnPush: true,
  },
  forceDelete: true,
  tags: commonTags,
});

new aws.ecr.LifecyclePolicy("sdxl-kube-api-lifecycle", {
  repository: apiRepository.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: "Keep the last 10 images",
        selection: {
          tagStatus: "any",
          countType: "imageCountMoreThan",
          countNumber: 10,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});

const galleryBucket = new aws.s3.Bucket("sdxl-kube-gallery", {
  bucket: pulumi.interpolate`sdxl-kube-gallery-${caller.accountId}-${stack}`,
  forceDestroy: false,
  tags: commonTags,
});

new aws.s3.BucketPublicAccessBlock("sdxl-kube-gallery-public-access-block", {
  bucket: galleryBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

new aws.s3.BucketServerSideEncryptionConfiguration("sdxl-kube-gallery-encryption", {
  bucket: galleryBucket.id,
  rules: [
    {
      applyServerSideEncryptionByDefault: {
        sseAlgorithm: "AES256",
      },
    },
  ],
});

const cluster = new eks.Cluster("sdxl-kube-cluster", {
  name: clusterName,
  authenticationMode: eks.AuthenticationMode.Api,
  vpcId: vpc.vpcId,
  publicSubnetIds: vpc.publicSubnetIds,
  privateSubnetIds: vpc.privateSubnetIds,
  skipDefaultNodeGroup: true,
  endpointPrivateAccess: true,
  endpointPublicAccess: true,
  tags: commonTags,
});

const nodeRole = new aws.iam.Role("sdxl-kube-node-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
  tags: commonTags,
});

const workerNodePolicy = new aws.iam.RolePolicyAttachment("sdxl-kube-worker-node-policy", {
  role: nodeRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
});

const cniPolicy = new aws.iam.RolePolicyAttachment("sdxl-kube-cni-policy", {
  role: nodeRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
});

const registryPolicy = new aws.iam.RolePolicyAttachment("sdxl-kube-registry-policy", {
  role: nodeRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
});

new eks.ManagedNodeGroup(
  "sdxl-kube-cpu-node-group",
  {
    cluster,
    nodeRole,
    nodeGroupName: "sdxl-kube-cpu",
    subnetIds: vpc.privateSubnetIds,
    instanceTypes: ["t3.small"],
    diskSize: 50,
    labels: {
      workload: "general",
    },
    scalingConfig: {
      minSize: 0,
      desiredSize: nodeDesiredSize,
      maxSize: 1,
    },
  },
  {
    dependsOn: [workerNodePolicy, cniPolicy, registryPolicy],
  },
);

export const eksClusterName = clusterName;
export const kubeconfig = cluster.kubeconfig;
export const ecrRepositoryUrl = apiRepository.repositoryUrl;
export const imageUriStub = pulumi.interpolate`${apiRepository.repositoryUrl}:replace-me`;
export const galleryBucketName = galleryBucket.bucket;
export const vpcId = vpc.vpcId;
