#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SdxlKubeStack } from "../lib/cdk-stack";

const app = new cdk.App();
new SdxlKubeStack(app, "SdxlKubeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: "SDXL image generation backend on EKS with GPU nodes",
});
