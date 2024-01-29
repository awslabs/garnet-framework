import { Aws, Duration, Names, SecretValue } from "aws-cdk-lib"
import { Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster, ContainerImage, FargateTaskDefinition, LogDrivers, TaskDefinition, Secret as ecsSecret } from "aws-cdk-lib/aws-ecs"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import {scorpiobroker_sqs_object} from "../../garnet-constructs/constants"
import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { ApplicationTargetGroup, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2"

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

        let task_env = {
            DBHOST: props.db_endpoint,
            DBPORT: props.db_port,   
            DBNAME: Parameters.garnet_scorpio.dbname,
            SCORPIO_STARTUPDELAY: '5s',
            SCORPIO_ENTITY_MAX_LIMIT: '5000',
            AWS_REGION: Aws.REGION,
            QUARKUS_LOG_LEVEL: 'INFO',
            MYSETTINGS_MESSAGECONNECTION_OPTIONS: "?greedy=true&delay=200",
            ...scorpiobroker_sqs_object
        }


        const task_def = new FargateTaskDefinition(this, 'FargateDefinition', {
            taskRole: fargate_task_role,
            
        })
    

        task_def.addContainer('entityManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/entity-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'scorpioEntityManager', 
            portMappings: [{
                containerPort:  1025, 
                hostPort: 1025
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/entityManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('historyEntityManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/history-entity-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'scorpioHistoryEntityManager', 
            portMappings: [{
                containerPort:  1040, 
                hostPort: 1040
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/historyEntityManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('historyQueryManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/history-query-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'scorpioHistoryQueryManager', 
            portMappings: [{
                containerPort:  1041, 
                hostPort: 1041
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/historyQueryManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('atContextServer', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/at-context-server:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'atContextServer', 
            portMappings: [{
                containerPort:  1042, 
                hostPort: 1042
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/atContextServer`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('queryManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/query-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'queryManager', 
            portMappings: [{
                containerPort:  1026, 
                hostPort: 1026
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/queryManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('registryManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/registry-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'registryManager', 
            portMappings: [{
                containerPort:  1030, 
                hostPort: 1030
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/registryManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })

        task_def.addContainer('registrySubscriptionManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/registry-subscription-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'registrySubscriptionManager', 
            portMappings: [{
                containerPort:  2025, 
                hostPort: 2025
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/registrySubscriptionManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })
        task_def.addContainer('subscriptionManager', {
            essential: true, 
            image: ContainerImage.fromRegistry(`public.ecr.aws/scorpiobroker/subscription-manager:java-sqs-latest`),
            environment: task_env,
            secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            },
            containerName: 'subscriptionManager', 
            portMappings: [{
                containerPort:  2026, 
                hostPort: 2026
            }],
            logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/fargate/scorpio/subscriptionManager`, 
            logRetention: RetentionDays.THREE_MONTHS
            })
        })


        const fargate_alb = new ApplicationLoadBalancedFargateService(this, 'FargateServiceScorpio', {
            cluster: fargate_cluster,
            serviceName: `garnet-fargate-service-${Parameters.garnet_broker.toLowerCase()}`,
            circuitBreaker: {
                rollback: true
            },
            cpu: Parameters.garnet_fargate.fargate_cpu,
            memoryLimitMiB: Parameters.garnet_fargate.fargate_memory_limit, // Default is 512
            securityGroups: [sg_fargate],
            minHealthyPercent: 50, 
            maxHealthyPercent: 400, 
            healthCheckGracePeriod: Duration.seconds(20),  
            publicLoadBalancer: false, 
            loadBalancerName: `garnet-loadbalancer`,  
            taskDefinition: task_def
            // taskImageOptions: {
            //     image: ContainerImage.fromRegistry(props.image_context_broker),
            //     taskRole: fargate_task_role,
            //     secrets: {
            //         DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
            //         DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
            //     },
            //     environment: {
            //         DBHOST: props.db_endpoint,
            //         DBPORT: props.db_port,   
            //         DBNAME: Parameters.garnet_scorpio.dbname,
            //         SCORPIO_STARTUPDELAY: '5s',
            //         SCORPIO_ENTITY_MAX_LIMIT: '5000',
            //         AWS_REGION: Aws.REGION,
            //         QUARKUS_LOG_LEVEL: 'INFO',
            //         MYSETTINGS_MESSAGECONNECTION_OPTIONS: "?greedy=true&delay=200",
            //         ...scorpiobroker_sqs_object
            //     },
            //     containerPort: 9090,
            //     logDriver: LogDrivers.awsLogs({
            //         streamPrefix: `garnet/fargate/scorpio`, 
            //         logRetention: RetentionDays.THREE_MONTHS
            //     })
            // },

        })


        /** ENV 
         *     QUARKUS_DATASOURCE_REACTIVE_MAX_SIZE: '30',
         *     SCORPIO_ENTITY_MAX_LIMIT: '5000',
               QUARKUS_VERTX_EVENT_LOOPS_POOL_SIZE: '10', 
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

     
    

        fargate_alb.targetGroup.configureHealthCheck({
            path: '/q/health',
            port: '1026'
        })



        this.fargate_alb = fargate_alb

    }


}