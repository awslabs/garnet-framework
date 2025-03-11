import { NestedStack, NestedStackProps, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, ContainerInsights, FargateService, FargateTaskDefinition, LogDrivers } from "aws-cdk-lib/aws-ecs";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import path = require("path");

interface GarnetLoadTestStackProps extends NestedStackProps {
    vpc: Vpc
    garnetSecurityGroup: SecurityGroup
    garnetEndpoint: string
  }
  
export class GarnetLoadTestStack extends NestedStack {
    constructor(scope: Construct, id: string, props: GarnetLoadTestStackProps) {
      super(scope, id, props)

        // Create ECS Cluster
      const cluster = new Cluster(this, 'LoadTestCluster', {
        vpc: props.vpc,
        containerInsightsV2: ContainerInsights.ENHANCED,
      })

       // Create security group for load test containers
    const loadTestSG = new SecurityGroup(this, 'LoadTestSG', {
        vpc: props.vpc,
        description: 'Security group for load test containers',
        allowAllOutbound: true
      })

     // Allow communication with Garnet
     loadTestSG.addIngressRule(
        props.garnetSecurityGroup,
        Port.tcp(8080),
        'Allow inbound from Garnet'
      )

       // Allow traffic between load test and Garnet
    loadTestSG.addEgressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      'Allow outbound HTTP traffic'
    )

    // Create Task Role with CloudWatch permissions
    const taskRole = new Role(this, 'LoadTestTaskRole', {
        assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    })

    taskRole.addManagedPolicy(
       ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
    )


    // Create Task Definition
    const taskDef = new FargateTaskDefinition(this, 'LoadTestTask', {
      memoryLimitMiB: 32768,  // 32GB
      cpu: 8192,              // 8 vCPU
        taskRole: taskRole
    })

    const logGroup = new LogGroup(this, 'LoadTestLogGroup', {
        logGroupName: '/ecs/garnet-load-test',
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY
    })

    let endp = `http://${props.garnetEndpoint}`
    // Add container to task definition
    taskDef.addContainer('k6', {
        image: ContainerImage.fromAsset(path.join(__dirname, 'load-test')),
        logging: LogDrivers.awsLogs({
          streamPrefix: 'k6',
          logGroup: logGroup
        }),
        environment: {
          GARNET_ENDPOINT: endp,
          K6_OUT: 'k6',
          K6_STATSD_PUSH: 'true',
          K6_STATSD_ENABLE_TAGS: 'true',
          K6_STATSD_ADDR: '127.0.0.1:8125',
        }
      })


       // Create Fargate Service
    new FargateService(this, 'LoadTestService', {
        cluster,
        taskDefinition: taskDef,
        desiredCount: 100, // Start with 5 instances
        securityGroups: [loadTestSG],
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS
        }
      })



    }   

}