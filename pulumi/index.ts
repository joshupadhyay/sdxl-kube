import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

/**
 * I personally enjoy the AWS CDK. I find it cleaner, but I wanted to explore 3rd party solutions
 * for particularly multi-cloud setups
 */

const project = pulumi.getProject();
const stack = pulumi.getStack();
const config = new pulumi.Config();
const clusterName = "sdxl-kube-eks";
const nodeDesiredSize = config.getNumber("nodeDesiredSize") ?? 1;
const loadBalancerControllerNamespace = "kube-system";
const loadBalancerControllerServiceAccount = "aws-load-balancer-controller";
const commonTags = {
  Project: project,
  Stack: stack,
  ManagedBy: "pulumi",
};

const caller = aws.getCallerIdentityOutput({});
const currentRegion = aws.getRegionOutput({});

const vpc = new awsx.ec2.Vpc("sdxl-kube-vpc", {
  cidrBlock: "10.42.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  numberOfAvailabilityZones: 2,
  subnetStrategy: awsx.ec2.SubnetAllocationStrategy.Legacy,
  natGateways: {
    // Lower-cost learning setup: one NAT gateway for all private subnets.
    // Production usually uses one NAT gateway per AZ.
    strategy: awsx.ec2.NatGatewayStrategy.Single,
  },
  subnetSpecs: [
    {
      type: awsx.ec2.SubnetType.Public,
      name: "public",
      tags: {
        [`kubernetes.io/cluster/${clusterName}`]: "shared",
        "kubernetes.io/role/elb": "1",
      },
    },
    {
      type: awsx.ec2.SubnetType.Private,
      name: "private",
      tags: {
        [`kubernetes.io/cluster/${clusterName}`]: "shared",
        "kubernetes.io/role/internal-elb": "1",
      },
    },
  ],
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

new aws.s3.BucketServerSideEncryptionConfiguration(
  "sdxl-kube-gallery-encryption",
  {
    bucket: galleryBucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: "AES256",
        },
      },
    ],
  },
);

const cluster = new eks.Cluster("sdxl-kube-cluster", {
  name: clusterName,
  authenticationMode: eks.AuthenticationMode.Api,
  vpcId: vpc.vpcId,
  publicSubnetIds: vpc.publicSubnetIds,
  privateSubnetIds: vpc.privateSubnetIds,
  createOidcProvider: true,
  skipDefaultNodeGroup: true,
  endpointPrivateAccess: true,
  endpointPublicAccess: true,
  tags: commonTags,
});

const loadBalancerControllerRole = new aws.iam.Role("sdxl-kube-lbc-role", {
  assumeRolePolicy: pulumi
    .all([cluster.oidcProviderArn, cluster.oidcIssuer])
    .apply(([oidcProviderArn, oidcIssuer]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Federated: oidcProviderArn,
            },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                [`${oidcIssuer.replace("https://", "")}:aud`]:
                  "sts.amazonaws.com",
                [`${oidcIssuer.replace("https://", "")}:sub`]: `system:serviceaccount:${loadBalancerControllerNamespace}:${loadBalancerControllerServiceAccount}`,
              },
            },
          },
        ],
      }),
    ),
  tags: commonTags,
});

const loadBalancerControllerElbPolicyAttachment =
  new aws.iam.RolePolicyAttachment("sdxl-kube-lbc-elb-policy", {
    role: loadBalancerControllerRole.name,
    policyArn: "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess",
  });

const loadBalancerControllerEc2PolicyAttachment =
  new aws.iam.RolePolicyAttachment("sdxl-kube-lbc-ec2-policy", {
    role: loadBalancerControllerRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2FullAccess",
  });

const k8sProvider = new k8s.Provider("sdxl-kube-k8s", {
  kubeconfig: cluster.kubeconfigJson,
});

const loadBalancerControllerServiceAccountResource =
  new k8s.core.v1.ServiceAccount(
    "sdxl-kube-lbc-service-account",
    {
      metadata: {
        name: loadBalancerControllerServiceAccount,
        namespace: loadBalancerControllerNamespace,
        annotations: {
          "eks.amazonaws.com/role-arn": loadBalancerControllerRole.arn,
        },
      },
    },
    {
      provider: k8sProvider,
      dependsOn: [
        loadBalancerControllerElbPolicyAttachment,
        loadBalancerControllerEc2PolicyAttachment,
      ],
    },
  );

const nodeRole = new aws.iam.Role("sdxl-kube-node-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
  tags: commonTags,
});

const workerNodePolicy = new aws.iam.RolePolicyAttachment(
  "sdxl-kube-worker-node-policy",
  {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
  },
);

const cniPolicy = new aws.iam.RolePolicyAttachment("sdxl-kube-cni-policy", {
  role: nodeRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
});

const registryPolicy = new aws.iam.RolePolicyAttachment(
  "sdxl-kube-registry-policy",
  {
    role: nodeRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  },
);

const cpuNodeGroup = new eks.ManagedNodeGroup(
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

new k8s.helm.v3.Release(
  "sdxl-kube-lbc",
  {
    chart: "aws-load-balancer-controller",
    version: "1.14.0",
    namespace: loadBalancerControllerNamespace,
    repositoryOpts: {
      repo: "https://aws.github.io/eks-charts",
    },
    values: {
      clusterName,
      region: currentRegion.name,
      vpcId: vpc.vpcId,
      serviceAccount: {
        create: false,
        name: loadBalancerControllerServiceAccount,
      },
    },
  },
  {
    provider: k8sProvider,
    dependsOn: [cpuNodeGroup, loadBalancerControllerServiceAccountResource],
  },
);

export const eksClusterName = clusterName;
export const kubeconfig = cluster.kubeconfig;
export const ecrRepositoryUrl = apiRepository.repositoryUrl;
export const imageUriStub = pulumi.interpolate`${apiRepository.repositoryUrl}:replace-me`;
export const galleryBucketName = galleryBucket.bucket;
export const vpcId = vpc.vpcId;
