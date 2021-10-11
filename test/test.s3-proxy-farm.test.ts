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

import { SynthUtils } from '@aws-cdk/assert';
import { S3ProxyFarm, S3ProxyFarmProps } from "../lib";
import * as cdk from "@aws-cdk/core";
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as s3 from '@aws-cdk/aws-s3';
import '@aws-cdk/assert/jest';

test('snapshot test s3 proxy farm default params', () => {
  const stack = new cdk.Stack();

  const vpc = new ec2.Vpc(stack, 'test-vpc');

  const websiteBucket = new s3.Bucket(stack, 'WebsiteBucket');

  const props: S3ProxyFarmProps = {
    vpc,
    websiteBucket,
  };

  new S3ProxyFarm(stack, 'test-aws-s3-proxy-farm', props);

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test('snapshot test s3 proxy farm overwrite params', () => {
  const stack = new cdk.Stack();

  const vpc = new ec2.Vpc(stack, 'test-vpc');

  const websiteBucket = new s3.Bucket(stack, 'WebsiteBucket');

  const props: S3ProxyFarmProps = {
    vpc,
    websiteBucket,
    autoScalingGroupProps: {
      maxCapacity: 4,
    },
    cpuUtilizationScalingProps: {
      cooldown: cdk.Duration.seconds(100),
    },
    allowedCIDRRanges: ['10.0.128.0/18', '10.0.192.0/18'],
    websiteIndexDocument: 'test_index.html',
  };

  new S3ProxyFarm(stack, 'test-aws-s3-proxy-farm', props);

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});

test('snapshot test s3 proxy farm with load balancer', () => {
  const stack = new cdk.Stack();

  const vpc = new ec2.Vpc(stack, 'test-vpc');

  const websiteBucket = new s3.Bucket(stack, 'WebsiteBucket');

  const props: S3ProxyFarmProps = {
    vpc,
    websiteBucket,
  };

  const s3ProxyFarm = new S3ProxyFarm(stack, 'test-aws-s3-proxy-farm', props);

  const lb = new elbv2.NetworkLoadBalancer(stack, 's3-proxy-farm-load-balancer', {
    vpc,
    crossZoneEnabled: true,
    internetFacing: false,
    vpcSubnets: {
      subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
    },
  });

  s3ProxyFarm.createNetworkLoadBalancerListener(lb, {
    port: 80,
    protocol: elbv2.Protocol.TCP,
  })

  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
});
