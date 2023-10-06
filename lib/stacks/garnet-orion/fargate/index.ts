import { Duration, Names, SecretValue } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, CpuArchitecture, LogDrivers, OperatingSystemFamily, Secret as ecsSecret } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { Parameters } from "../../../../parameters";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

export interface GarnetOrionFargateProps {
  vpc: Vpc;
  sg_database: SecurityGroup;
  db_endpoint: string;
  secret_arn: string;
  image_context_broker: string;
}

export class GarnetOrionFargate extends Construct {
  public readonly fargate_alb: ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: GarnetOrionFargateProps) {
    super(scope, id);
            // Check props
            if (!props.vpc){
              throw new Error('The property vpc is required to create an instance of GarnetOrionFargate Construct')
          }

          if (!props.sg_database){
              throw new Error('The property sg_database is required to create an instance of GarnetOrionFargate Construct')
          }
          if (!props.db_endpoint){
              throw new Error('The property db_endpoint is required to create an instance of GarnetOrionFargate Construct')
          }
          if (!props.secret_arn){
              throw new Error('The property secret_arn is required to create an instance of GarnetOrionFargate Construct')
          }
          if (!props.image_context_broker){
              throw new Error('The property image_context_broker is required to create an instance of ScorpioServerlessFargate Construct')
          }

    const secret = Secret.fromSecretCompleteArn(this, 'Secret', props.secret_arn)

    const sg_orion = new SecurityGroup(this, "SecurityGroupOrion", {
      vpc: props.vpc,
      securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-fargate-sg-${Names.uniqueId(this).slice(-4).toLowerCase()}`
    })
    props.sg_database.addIngressRule(sg_orion, Port.tcp(27017))
    sg_orion.addIngressRule(Peer.anyIpv4() ,Port.tcp(1026))

    const pwd = ecsSecret.fromSecretsManager(secret, 'password')
    const usn = ecsSecret.fromSecretsManager(secret, 'username')

    const fargate_cluster = new Cluster(
      this,
      "EcsClusterGarnetOrionLdDocumentDb",
      { vpc: props.vpc, 
        clusterName: `garnet-fargate-cluster-${Parameters.garnet_broker.toLowerCase()}-${Names.uniqueId(this).slice(-4).toLowerCase()}`,
      }
    )
    const fargate_alb = new ApplicationLoadBalancedFargateService( this, "FargateServiceGarnetOrionLdDocumentDb", {
        cluster: fargate_cluster,
        serviceName: `garnet-fargate-service-${Parameters.garnet_broker.toLowerCase()}-${Names.uniqueId(this).slice(-4).toLowerCase()}`,
        cpu: Parameters.garnet_fargate.fargate_cpu,
        minHealthyPercent: 50, 
        maxHealthyPercent: 200,  
        publicLoadBalancer: true,
        loadBalancerName: `garnet-loadbalancer-${Names.uniqueId(this).slice(-4).toLowerCase()}`,
        taskImageOptions: {
          image: ContainerImage.fromRegistry(props.image_context_broker),
          secrets: {
            ORIONLD_MONGO_PASSWORD: ecsSecret.fromSecretsManager(secret, 'password'),
            ORIONLD_MONGO_USER: ecsSecret.fromSecretsManager(secret, 'username')
            },
          environment: {
            ORIONLD_MONGOCONLY: "TRUE",
            ORIONLD_MONGO_URI: `mongodb://${secret.secretValueFromJson('username').toString()}:${secret.secretValueFromJson('password').toString()}@${props.db_endpoint}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`,
            ORIONLD_SUBCACHE_IVAL: '3'
          },
          containerPort: 1026,
          logDriver: LogDrivers.awsLogs({
            streamPrefix: id, 
            logRetention: RetentionDays.THREE_MONTHS
        })
        },
        memoryLimitMiB: Parameters.garnet_fargate.fargate_memory_limit, // Default is 512

        securityGroups: [sg_orion]
      }
    )

    fargate_alb.service.autoScaleTaskCount({  
      minCapacity: Parameters.garnet_fargate.autoscale_min_capacity, 
      maxCapacity: Parameters.garnet_fargate.autoscale_max_capacity
      }).scaleOnRequestCount('RequestScaling', {
      requestsPerTarget: Parameters.garnet_fargate.autoscale_requests_number,
      targetGroup: fargate_alb.targetGroup,
      scaleInCooldown: Duration.seconds(20), 
      scaleOutCooldown: Duration.seconds(60)
  })

  
    this.fargate_alb = fargate_alb
    fargate_alb.targetGroup.configureHealthCheck({
      path: "/ngsi-ld/ex/v1/version",
      port: "1026",
    })


  }
}
