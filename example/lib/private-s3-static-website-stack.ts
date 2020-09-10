/**
 *  Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import * as s3Deployment from '@aws-cdk/aws-s3-deployment';
import * as cdk from '@aws-cdk/core';

import { S3ProxyFarm, S3ProxyFarmProps } from '../../lib';

export class PrivateS3StaticWebsiteStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Private S3 Static Website

    const websiteBucket = new s3.Bucket(this, 's3-proxy-farm-website-bucket', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    new s3Deployment.BucketDeployment(this, 's3-proxy-farm-website-deployment', {
      sources: [s3Deployment.Source.asset('./website')],
      destinationBucket: websiteBucket,
    });

    // Proxy farm VPC
    // Use a VPC with a VPN connection or a Direct connection to your remote network

    const vpc = new ec2.Vpc(this, 's3-proxy-farm-vpc');

    // Create S3 VPC endpoint if it does not already exist and allow access to static website bucket from this endpoint

    const s3VpcEndpoint = vpc.addGatewayEndpoint('s3-proxy-farm-s3-vpc-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.AnyPrincipal()],
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      conditions: {
        StringEquals: {
          "aws:SourceVpce": s3VpcEndpoint.vpcEndpointId,
        },
      },
    }));

    // Create proxy farm

    const s3ProxyFarmProps: S3ProxyFarmProps = {
      vpc,
      websiteBucket,
      autoScalingGroupProps: {
        maxCapacity: 4,
      },
      allowedCIDRRanges: ['0.0.0.0/0'],
    };

    const s3ProxyFarm = new S3ProxyFarm(this, 's3-proxy-farm', s3ProxyFarmProps);

    // Expose proxy farm using a private Network Load Balancer
    const lb = new elbv2.NetworkLoadBalancer(this, 's3-proxy-farm-load-balancer', {
      vpc,
      crossZoneEnabled: true,
      internetFacing: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
    });

    s3ProxyFarm.createNetworkLoadBalancerListener(lb, {
      port: 80,
      protocol: elbv2.Protocol.TCP,
    })

    // Use this URL to access the S3 static website from your remote network

    new cdk.CfnOutput(this, 's3-proxy-farm-website-url', {
      value: `http://${lb.loadBalancerDnsName}`,
    });

  }
}
