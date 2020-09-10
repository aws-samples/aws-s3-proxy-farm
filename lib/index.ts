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

import { Construct, Duration } from '@aws-cdk/core';
import * as autoscaling from '@aws-cdk/aws-autoscaling';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as s3 from '@aws-cdk/aws-s3';
import * as deepmerge from 'deepmerge';

import { isPlainObject } from './utils';

/**
 * @summary The properties for the S3ProxyFarm class.
 */
export interface S3ProxyFarmProps {
  /**
   * VPC where proxy farm will be deployed
   */
  readonly vpc: ec2.Vpc,
  /**
   * S3 Bucket hosting a static website
   */
  readonly websiteBucket: s3.Bucket,
  /**
   * User provided props to override the default props for the proxy farm Auto Scaling Group.
   *
   * @default - Default props are used
   */
  readonly autoScalingGroupProps?: Partial<autoscaling.AutoScalingGroupProps>,
  /**
   * User provided props to override the default props for the proxy farm CPU Utilization Scaling Policy.
   *
   * @default - Default props are used
   */
  readonly cpuUtilizationScalingProps?: Partial<autoscaling.CpuUtilizationScalingProps>,
  /**
   * CIDR range of the peers that can access the reverse proxy
   *
   * @default - []
   */
  readonly allowedCIDRRanges?: Array<string>,
  /**
   * Name of the index file for the static website
   *
   * @default - index.html
   */
  readonly websiteIndexDocument?: string,
}

export class S3ProxyFarm extends Construct {
  public readonly proxyPort: number = 8080;
  public readonly allowedCIDRRanges: Array<string> = [];
  public readonly websiteIndexDocument: string = 'index.html';
  public readonly proxyFarmSecurityGroup: ec2.SecurityGroup;
  public readonly proxyFarmAsg: autoscaling.AutoScalingGroup;

  /**
   * @summary Constructs a new instance of the S3ProxyFarmProps class.
   * @param {cdk.App} scope - represents the scope for all the resources.
   * @param {string} id - this is a a scope-unique id.
   * @param {S3ProxyFarmProps} props - user provided props for the construct
   * @access public
   */
  constructor(scope: Construct, id: string, props: S3ProxyFarmProps) {
    super(scope, id);

    this.websiteIndexDocument = props.websiteIndexDocument || this.websiteIndexDocument;
    this.allowedCIDRRanges = Array.isArray(props.allowedCIDRRanges) && props.allowedCIDRRanges.length ? props.allowedCIDRRanges : this.allowedCIDRRanges;

    this.proxyFarmSecurityGroup = new ec2.SecurityGroup(this, 'autoscaling-group-security-group', {
      vpc: props.vpc,
    });

    for (const cidrRange of this.allowedCIDRRanges) {
      this.proxyFarmSecurityGroup.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(this.proxyPort), 'allow proxy access from CIDR range');  
    }

    const proxyFarmAsgProps = deepmerge({
      vpc: props.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage(),
      associatePublicIpAddress: false,
      securityGroup: this.proxyFarmSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
      minCapacity: 1,
      maxCapacity: 3,
    }, props.autoScalingGroupProps || {}, {
      isMergeableObject: isPlainObject
    });

    this.proxyFarmAsg = new autoscaling.AutoScalingGroup(this, 'autoscaling-group', proxyFarmAsgProps);

    const cpuUtilizationScalingProps: autoscaling.CpuUtilizationScalingProps = deepmerge({
      targetUtilizationPercent: 80,
      cooldown: Duration.seconds(300),
    }, props.cpuUtilizationScalingProps || {}, {
      isMergeableObject: isPlainObject
    });

    this.proxyFarmAsg.scaleOnCpuUtilization('scaling-policy', cpuUtilizationScalingProps);

    // Configure Proxy (Nginx) on instance startup
    this.proxyFarmAsg.userData.addCommands(`
#!/bin/bash

amazon-linux-extras enable nginx1

yum -y install nginx

cat <<EOF > /etc/nginx/conf.d/reverse-proxy.conf
server {
  listen ${this.proxyPort};
  listen [::]:${this.proxyPort};

${this.allowedCIDRRanges.map((cidrRange) => `  allow ${cidrRange};`).join('\n')}
  deny all;

  location = / {
    proxy_pass ${props.websiteBucket.bucketWebsiteUrl}/${this.websiteIndexDocument};
  }

  location / {
    proxy_pass ${props.websiteBucket.bucketWebsiteUrl};
  }
}
EOF

service nginx restart
    `);
  }

  /**
   * @summary Expose the proxy farm using a network load balancer.
   * @param {elbv2.NetworkLoadBalancer} lb
   * @param {elbv2.BaseNetworkListenerProps} listenerProps
   * @access public
   */
  public createNetworkLoadBalancerListener(lb: elbv2.NetworkLoadBalancer, listenerProps: elbv2.BaseNetworkListenerProps) {
    const listener = lb.addListener('load-balancer-listener', listenerProps);

    listener.addTargets('load-balancer-listener-targets', {
      port: this.proxyPort,
      targets: [this.proxyFarmAsg],
    });
  }

}