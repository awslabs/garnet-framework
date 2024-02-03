import { Aws, Duration, Names, SecretValue } from "aws-cdk-lib"
import { Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster, ContainerImage, LogDrivers, Secret as ecsSecret } from "aws-cdk-lib/aws-ecs"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import {scorpiobroker_sqs_object} from "../../garnet-constructs/constants"
import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"

export interface GarnetScorpioFargateProps {
    vpc: Vpc
    sg_proxy: SecurityGroup,
    db_endpoint: string,
    db_port: string,
    secret_arn: string,
    image_context_broker: string
}

export class GarnetScorpioFargate extends Construct {
    public readonly fargate_alb : ApplicationLoadBalancedFargateService

    constructor(scope: Construct, id: string, props: GarnetScorpioFargateProps) {
        super(scope, id)

        // Check props
        if (!props.vpc){
            throw new Error('The property vpc is required to create an instance of ScorpioServerlessFargate Construct')
        }
        if (!props.sg_proxy){
            throw new Error('The property sg_proxy is required to create an instance of ScorpioServerlessFargate Construct')
        }
        if (!props.db_endpoint){
            throw new Error('The property db_endpoint is required to create an instance of ScorpioServerlessFargate Construct')
        }
        if (!props.db_port){
            throw new Error('The property db_port is required to create an instance of ScorpioServerlessFargate Construct')
        }
        if (!props.secret_arn){
            throw new Error('The property secret_arn is required to create an instance of ScorpioServerlessFargate Construct')
        }
        if (!props.image_context_broker){
            throw new Error('The property image_context_broker is required to create an instance of ScorpioServerlessFargate Construct')
        }

        const secret = Secret.fromSecretCompleteArn(this, 'Secret', props.secret_arn)

        const sg_fargate = new SecurityGroup(this, 'SecurityGroupScorpio', {
            vpc: props.vpc,
            securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-fargate-sg`
        })

        const sg_proxy = SecurityGroup.fromSecurityGroupId(this, 'sgDb', props.sg_proxy.securityGroupId)


        sg_proxy.addIngressRule(sg_fargate, Port.tcp(5432))

        const fargate_cluster = new Cluster(this, 'FargateScorpioCluster', {
            vpc: props.vpc,
            clusterName: `garnet-fargate-cluster-${Parameters.garnet_broker.toLowerCase()}`
        })

        const db_pass = SecretValue.secretsManager(secret.secretArn).toJSON()

        const fargate_task_role = new Role(this, 'TaskRole', {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com")
        })

        fargate_task_role.addToPolicy(
            new PolicyStatement({
                resources: [
                    `arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-scorpiobroker-*`
                ],
                actions: [
                    "sqs:*"
                ]
            })
        )

        fargate_task_role.addToPolicy(
            new PolicyStatement({
                resources: [
                    `*`
                ],
                actions: [
                    "sqs:ListQueues",
                    "sqs:CreateQueue"
                ]
            })
        )

   
        const fargate_alb = new ApplicationLoadBalancedFargateService(this, 'FargateServiceScorpio', {
            cluster: fargate_cluster,
            serviceName: `garnet-fargate-service-${Parameters.garnet_broker.toLowerCase()}`,
            circuitBreaker: {
                rollback: true
            },
            cpu: Parameters.garnet_fargate.fargate_cpu,
            minHealthyPercent: 50, 
            maxHealthyPercent: 400, 
            healthCheckGracePeriod: Duration.seconds(20),  
            publicLoadBalancer: false, 
            loadBalancerName: `garnet-loadbalancer`,
            // taskDefinition: [

            // ],
            taskImageOptions: {
                containerName: `garnet-scorpio-container`, 
                family: `garnet-scorpio-task-definition`, 
                image: ContainerImage.fromRegistry(props.image_context_broker),
                taskRole: fargate_task_role,
                secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
                },
                environment: {
                    DBHOST: props.db_endpoint,
                    DBPORT: props.db_port,   
                    DBNAME: Parameters.garnet_scorpio.dbname,
                    SCORPIO_STARTUPDELAY: '10s',
                    SCORPIO_ENTITY_MAX_LIMIT: '5000',
                    AWS_REGION: Aws.REGION,
                    QUARKUS_LOG_LEVEL: 'INFO',
                    MYSETTINGS_MESSAGECONNECTION_OPTIONS: "?greedy=true&delay=250",
                    QUARKUS_VERTX_EVENT_LOOPS_POOL_SIZE: '50',
                    ...scorpiobroker_sqs_object
                },
                containerPort: 9090,
                logDriver: LogDrivers.awsLogs({
                    streamPrefix: id, 
                    logRetention: RetentionDays.THREE_MONTHS
                })
            },
            memoryLimitMiB: Parameters.garnet_fargate.fargate_memory_limit, // Default is 512
            securityGroups: [sg_fargate]
        })

        /** ENV 
         *     QUARKUS_DATASOURCE_REACTIVE_MAX_SIZE: '30',
         *     SCORPIO_ENTITY_MAX_LIMIT: '5000',
               QUARKUS_VERTX_EVENT_LOOPS_POOL_SIZE: '50', 
         */


        fargate_alb.service.autoScaleTaskCount({  
            minCapacity: Parameters.garnet_fargate.autoscale_min_capacity, 
            maxCapacity: Parameters.garnet_fargate.autoscale_max_capacity
            }).scaleOnRequestCount('RequestScaling', {
            requestsPerTarget: Parameters.garnet_fargate.autoscale_requests_number,
            targetGroup: fargate_alb.targetGroup,
            scaleInCooldown: Duration.seconds(5), 
            scaleOutCooldown: Duration.seconds(10)
        })

        this.fargate_alb = fargate_alb
        fargate_alb.targetGroup.configureHealthCheck({
            path: '/q/health',
            port: '9090'
        })

    }


}