import { Aws, Duration,  RemovalPolicy, SecretValue } from "aws-cdk-lib"
import { InterfaceVpcEndpoint, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { AlternateTarget, Cluster, ContainerImage, ContainerInsights, DeploymentControllerType, DeploymentStrategy, FargateService, FargateTaskDefinition, ListenerRuleConfiguration, LogDrivers, Secret as ecsSecret } from "aws-cdk-lib/aws-ecs"

import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import {garnet_constant, garnet_nomenclature, garnet_scorpio_images, scorpiobroker_sqs_object} from "../../../../constants"
import { Construct } from "constructs"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { ApplicationListenerRule, ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, ListenerAction, ListenerCondition, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2"

import { ARCHITECTURE, deployment_params, DEPLOYMENT_STRATEGY } from "../../../../architecture"
import { Parameters } from "../../../../configuration"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"

export interface GarnetScorpioFargateProps {
    vpc: Vpc
    sg_proxy: SecurityGroup,
    db_endpoint: string,
    // db_reader_endpoint: string,
    db_port: string,
    secret_arn: string,
    image_context_broker: string,
    delivery_stream: CfnDeliveryStream
}

export class GarnetScorpioFargate extends Construct {
    public readonly fargate_alb : ApplicationLoadBalancer
    public readonly sg_broker: SecurityGroup

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
        if (deployment_params.architecture != 'concentrated' && deployment_params.architecture != 'distributed'){
            throw new Error('The selected architecture is not valid. Please select concentrated or distributed')
        }
        

        // SECRET FOR DATABASE CREDENTIALS
        const secret = Secret.fromSecretCompleteArn(this, 'Secret', props.secret_arn)
        const db_pass = SecretValue.secretsManager(secret.secretArn).toJSON()


        // SECURITY GROUP APPLICATION LOAD BALANCER
        const sg_alb = new SecurityGroup(this, "SecurityGroupAlbScorpio", {
            vpc: props.vpc,
            securityGroupName:  garnet_nomenclature.garnet_broker_sg_alb
        })


        // FARGATE SECURITY GROUP 
        const sg_fargate = new SecurityGroup(this, 'SecurityGroupScorpio', {
            vpc: props.vpc,
            securityGroupName: garnet_nomenclature.garnet_broker_sg_fargate
        })

        this.sg_broker = sg_fargate

        // SECURITY GROUP FOR RDS PROXY
        const sg_proxy = SecurityGroup.fromSecurityGroupId(this, 'sgDb', props.sg_proxy.securityGroupId)

        sg_proxy.addIngressRule(sg_fargate, Port.tcp(5432))


        // FARGATE CLUSTER 
        const fargate_cluster = new Cluster(this, 'FargateScorpioCluster', {
            vpc: props.vpc,
            containerInsightsV2: ContainerInsights.ENHANCED,
            clusterName: garnet_nomenclature.garnet_broker_cluster,
            defaultCloudMapNamespace: {
                name: 'garnet.local'
            }
        })


        // FARGATE TASK ROLE
        const fargate_task_role = new Role(this, 'TaskRole', {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com")
        })
        fargate_task_role.addToPolicy(
            new PolicyStatement({
                resources: [
                    `arn:aws:sqs:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-*`
                ],
                actions: [
                    "sqs:*"
                ]
            })
        )
        fargate_task_role.addToPolicy(
            new PolicyStatement({
                resources: [
                    `arn:aws:sns:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-*`
                ],
                actions: [
                    "sns:*"
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
                    "sqs:CreateQueue",
                    "sns:CreateTopic",
                    "sns:ListTopics"
                ]
            })
        )

        fargate_task_role.addToPolicy(
            new PolicyStatement({
                resources: [
                    `arn:aws:firehose:${Aws.REGION}:${Aws.ACCOUNT_ID}:deliverystream/${props.delivery_stream.deliveryStreamName!}`
                ],
                actions: [
                   'firehose:PutRecord',
                   'firehose:PutRecordBatch'
                ]
            })
        )

        // SCORPIO TASK ENV
        const scorpio_task_env = {
            DBHOST: props.db_endpoint,
            DBPORT: props.db_port,
            DBNAME: garnet_constant.dbname,
            SCORPIO_AT_CONTEXT_SERVER: `http://${garnet_nomenclature.garnet_broker_atcontextserver}:2023`,
            // SCORPIO_DISTRIBUTED_CONTEXT_URL: `http://${garnet_nomenclature.garnet_broker_atcontextserver}:2023/ngsi-ld/v1/jsonldContexts/`,
            SCORPIO_ENTITY_MANAGER_SERVER: `http://${garnet_nomenclature.garnet_broker_entitymanager}:1025`,
            SCORPIO_DISTRIBUTED_GATEWAYURL: `http://${garnet_nomenclature.garnet_broker_atcontextserver}:2023`,
            SCORPIO_CONCENTRATED_GATEWAYURL:`http://localhost:9090`,
            SCORPIO_STARTUPDELAY: "10s",
            SCORPIO_ENTITY_MAX_LIMIT: "1000",
            SCORPIO_MESSAGING_MAX_SIZE: "100",
            ATCONTEXT_CACHE_DURATION: "30m",
            QUARKUS_EUREKA_SERVICE_URL_DEFAULT: "http://eureka:8761/eureka",
            AWS_REGION: Aws.REGION,
            QUARKUS_LOG_LEVEL: "INFO",
            MYSETTINGS_SUBSCRIPTION_DELIVERY_STREAM: props.delivery_stream.deliveryStreamName!, 
            MYSETTINGS_MESSAGECONNECTION_OPTIONS: "?delay=250&greedy=true",

            // Core Connection Pool Settings
            QUARKUS_DATASOURCE_REACTIVE_MAX_SIZE: "150",
            QUARKUS_DATASOURCE_REACTIVE_IDLE_TIMEOUT: "40s",
            QUARKUS_DATASOURCE_REACTIVE_ACQUISITION_TIMEOUT: "20s",
            QUARKUS_DATASOURCE_REACTIVE_INITIAL_SIZE: "80",
            QUARKUS_DATASOURCE_REACTIVE_MAX_LIFETIME: "1800s",
            QUARKUS_DATASOURCE_REACTIVE_BACKGROUND_VALIDATION_INTERVAL: "30s",

            QUARKUS_FLYWAY_MIGRATE_AT_START: "false", 
            QUARKUS_FLYWAY_REPAIR_AT_START: "false", 
            
            // quarkus.flyway.lock-retry-count=50 ; quarkus.flyway.connect-retries=15
            //quarkus.datasource.jdbc.acquisition-timeout=30s  # Longer wait for pool acquisition
            //quarkus.vertx.max-worker-execute-time=120s  # For Vert.x tasks
            //quarkus.datasource.jdbc.max-size=10  # Limit per-instance connections to reduce contention

            // QUARKUS_FLYWAY_LOCK_RETRY_COUNT: "300", 
            // QUARKUS_FLYWAY_CONNECT_RETRIES:"50",
            // QUARKUS_VERTX_MAX_WORKER_EXECUTE_TIME: "120s",
            // QUARKUS_DATASOURCE_JDBC_ACQUISITION_TIMEOUT: "30s",

            // QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_RECONNECT_ATTEMPTS: "7",
            // QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_RECONNECT_INTERVAL: "PT2S",


            // // Transaction Settings
            // QUARKUS_TRANSACTION_MANAGER_DEFAULT_TRANSACTION_TIMEOUT: "120",
            // QUARKUS_HTTP_LIMITS_MAX_BODY_SIZE: "20M",
            // QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_CACHE_PREPARED_STATEMENTS: "true",
            // QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_PIPELINE_DEPTH: "64",
            // // New optimization settings
            // QUARKUS_CACHE_CAFFEINE_ENTITY_CACHE_MAXIMUM_SIZE: "20000",
            // QUARKUS_CACHE_CAFFEINE_ENTITY_CACHE_EXPIRE_AFTER_WRITE: "300S",
            ...scorpiobroker_sqs_object 
        }

        // SECURITY GROUP FOR SQS VPC ENDPOINT 
        const sg_garnet_vpc_endpoint = new SecurityGroup(this, 'SqsVpcEndpointSecurityGroup', {
            securityGroupName: `garnet-sqs-endpoint-sg`,
            vpc: props.vpc,
            allowAllOutbound: true
        })
        sg_garnet_vpc_endpoint.addIngressRule(Peer.anyIpv4(), Port.tcp(443))



        // VPC ENDPOINT FOR SQS
        const vpc_endpoint = new InterfaceVpcEndpoint(this, 'VpcEndpointSqs', {
            vpc: props.vpc,
            service: {
            name: `com.amazonaws.${Aws.REGION}.sqs`,
            port: 443
            },
            privateDnsEnabled: false,
            securityGroups: [sg_garnet_vpc_endpoint]
        })

        // SECURITY GROUP FOR SNS VPC ENDPOINT 
        const sg_garnet_sns_vpc_endpoint = new SecurityGroup(this, 'SnsVpcEndpointSecurityGroup', {
            securityGroupName: `garnet-sns-endpoint-sg`,
            vpc: props.vpc,
            allowAllOutbound: true
        })
        sg_garnet_sns_vpc_endpoint.addIngressRule(Peer.anyIpv4(), Port.tcp(443))



        // VPC ENDPOINT FOR SNS
        const vpc_sns_endpoint = new InterfaceVpcEndpoint(this, 'VpcEndpointSns', {
            vpc: props.vpc,
            service: {
            name: `com.amazonaws.${Aws.REGION}.sns`,
            port: 443
            },
            privateDnsEnabled: false,
            securityGroups: [sg_garnet_sns_vpc_endpoint]
        })
        
        const blue_green = deployment_params.deployment_strategy == DEPLOYMENT_STRATEGY.BlueGreen

        /**
         * Deployment safety settings shared by every broker service.
         *
         * The circuit breaker is what makes a bad rollout self-correcting: without it
         * ECS keeps retrying a task that cannot start and a failed deployment can hang
         * for hours instead of rolling back.
         *
         * Under blue/green ECS needs room to run a whole second task set, so the
         * minimum healthy percent goes to 100 (never drop capacity) and the strategy
         * and bake time are set here rather than repeated per service.
         */
        const deployment_config = {
            circuitBreaker: {
                enable: true,
                rollback: true
            },
            minHealthyPercent: blue_green ? 100 : 50,
            maxHealthyPercent: blue_green ? 200 : 400,
            ...(blue_green ? {
                deploymentController: { type: DeploymentControllerType.ECS },
                deploymentStrategy: DeploymentStrategy.BLUE_GREEN,
                bakeTime: Duration.minutes(deployment_params.deployment_bake_time_minutes)
            } : {})
        }

        /**
         * Blue/green shifts traffic by swapping the target group behind one production
         * listener rule. In the distributed architecture each service is registered in
         * two or three target groups (its own routes plus the /q/* diagnostics route),
         * and only the one carrying the alternate target configuration would swap: the
         * remaining groups would keep sending requests to the retired task set, so
         * during a bake /q/* would report a different version than the one serving
         * traffic. CDK synthesizes that without complaint, so it is rejected here
         * rather than deployed as a silently broken rollout.
         */
        if (blue_green && deployment_params.architecture == ARCHITECTURE.Distributed) {
            throw new Error(
                'deployment_strategy BlueGreen is currently supported only with the Concentrated architecture. ' +
                'The Distributed architecture registers each broker service in multiple target groups, which native ' +
                'ECS blue/green cannot shift atomically. Use DEPLOYMENT_STRATEGY.Rolling (the circuit breaker still ' +
                'rolls back a failed deployment automatically). See DEPLOYMENT.md.'
            )
        }

  if (deployment_params.architecture == 'distributed') {

        // APPLICATION LOAD BALANCER
        const fargate_alb = new ApplicationLoadBalancer(this, "ScorpioLoadBalancer", {
            vpc: props.vpc,
            internetFacing: false, 
            securityGroup: sg_alb, 
            loadBalancerName: `${garnet_nomenclature.garnet_load_balancer}-${deployment_params.architecture}`,
            idleTimeout: Duration.seconds(60),
            dropInvalidHeaderFields: true,
            deletionProtection: false
        })

        // LISTENER FOR APPLICATION LOAD BALANCER 
        const fargate_alb_listener = fargate_alb.addListener("ScorpioFargateAlbListener", {
            defaultAction: ListenerAction.fixedResponse(404, {
                messageBody: "Not Found"
            }), 
            port: 80
        })
    
        this.fargate_alb = fargate_alb

        // SCORPIO ENTITY MANAGER 
        const entity_manager_log = new LogGroup(this, 'ScorpioEntityManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_entitymanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
          })

        const entity_manager_task_def = new FargateTaskDefinition( this,"ScorpioEntityManagerFargateDefinition", {
              taskRole: fargate_task_role,
              cpu: deployment_params.entitymanager_fargate_cpu!,
              memoryLimitMiB: deployment_params.entitymanager_fargate_memory_limit!,
              family: `garnet-scorpio-entity-manager-definition`
        })
        entity_manager_task_def.addContainer("entityManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.entity_manager),
            environment: scorpio_task_env,
            secrets: {
              DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
              DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName:`${garnet_nomenclature.garnet_broker_entitymanager}-container`,
            portMappings: [
              {
                name: garnet_nomenclature.garnet_broker_entitymanager,
                containerPort: 1025,
                hostPort: 1025,
              },
            ],
            logging: LogDrivers.awsLogs({
              streamPrefix: `garnet/scorpio`,
              logGroup: entity_manager_log
            })
        })
        const entity_manager_service = new FargateService(this, "EntityManagerService",{
            cluster: fargate_cluster,
            taskDefinition: entity_manager_task_def,
            serviceConnectConfiguration: {
              namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
              services: [
                {
                  portMappingName: `${garnet_nomenclature.garnet_broker_entitymanager}`,
                  dnsName: `${garnet_nomenclature.garnet_broker_entitymanager}`,
                  port: 1025,
                },
              ],
            },
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_entitymanager}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate],
          }
        )

        const entity_manager_target = fargate_alb_listener.addTargets("EntityManagerTarget", {
          targets: [entity_manager_service],
          conditions: [
            ListenerCondition.pathPatterns([
              "/ngsi-ld/v1/entities",
              "/ngsi-ld/v1/entities/*",
              "/ngsi-ld/v1/entityOperations/*",
            ])
          ],
          priority: 110,
          targetGroupName: "EntityManager",
          healthCheck: {
            path: "/q/health",
            port: "1025",
          },
          protocol: ApplicationProtocol.HTTP,
        })
    
        fargate_alb_listener.addTargets("EntityManagerTargetQ", {
            targets: [entity_manager_service],
            conditions: [
              ListenerCondition.httpRequestMethods(["GET"]),
              ListenerCondition.pathPatterns([
                "/q/*",
              ]),
              ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_entitymanager])
            ],
            targetGroupName: "EntityManagerTargetGroupQ",
            priority: 480,
            healthCheck: {
              path: "/q/health",
              port: "1025",
            },
            protocol: ApplicationProtocol.HTTP,
        })
    
        entity_manager_service.autoScaleTaskCount({
            minCapacity: deployment_params.entitymanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.entitymanager_autoscale_max_capacity!
        }).scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: entity_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
    
        sg_fargate.addIngressRule(sg_alb, Port.tcp(1025));
        sg_fargate.addIngressRule(sg_fargate, Port.tcp(1025));



        // SCORPIO QUERY MANAGER 
        const query_manager_log = new LogGroup(this, 'ScorpioQueryManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_querymanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
          })
        const query_manager_task_def = new FargateTaskDefinition( this, "ScorpioQueryManagerFargateDefinition", {
              taskRole: fargate_task_role,
              cpu: deployment_params.querymanager_fargate_cpu,
              memoryLimitMiB: deployment_params.querymanager_fargate_memory_limit,
              family: `garnet-scorpio-query-manager-definition`
        })
        query_manager_task_def.addContainer("queryManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.query_manager),
            environment: scorpio_task_env,
            secrets: {
              DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
              DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName:`${garnet_nomenclature.garnet_broker_querymanager}-container`,
            portMappings: [
              {
                containerPort: 1026,
                hostPort: 1026,
              },
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup: query_manager_log
            })
        })

        const query_manager_service =  new FargateService(this, "QueryManagerService", {
            cluster: fargate_cluster, 
            taskDefinition: query_manager_task_def,
            serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName
            },
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_querymanager}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate],
        })
     
        const query_manager_target = fargate_alb_listener.addTargets("QueryManagerTarget", {
        targets: [query_manager_service],
        conditions: [
            ListenerCondition.httpRequestMethods(["GET"]),
            ListenerCondition.pathPatterns([
            "/ngsi-ld/v1/entities",
            "/ngsi-ld/v1/entities/*",
            "/ngsi-ld/v1/types",
            "/ngsi-ld/v1/types/*",
            ])
        ],
        targetGroupName: "QueryManager",
        priority: 100,
        healthCheck: {
            path: "/q/health",
            port: "1026",
        },
        protocol: ApplicationProtocol.HTTP,
        })
     
        fargate_alb_listener.addTargets("QueryManagerTargetAttributes", {
        targets: [query_manager_service],
        conditions: [
            ListenerCondition.httpRequestMethods(["GET"]),
            ListenerCondition.pathPatterns([
            "/ngsi-ld/v1/attributes",
            "/ngsi-ld/v1/attributes/*",
            ]),
        ],
        targetGroupName: "QueryManagerAttr",
        priority: 95,
        healthCheck: {
            path: "/q/health",
            port: "1026",
        },
        protocol: ApplicationProtocol.HTTP,
        })
     
        fargate_alb_listener.addTargets("QueryManagerTargetQ", {
            targets: [query_manager_service],
            conditions: [
            ListenerCondition.httpRequestMethods(["GET"]),
            ListenerCondition.pathPatterns([
                "/q/*",
            ]),
            ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_querymanager]),
            ],
            targetGroupName: "QueryManagerQ",
            priority: 500,
            healthCheck: {
            path: "/q/health",
            port: "1026",
            },
            protocol: ApplicationProtocol.HTTP,
        })
    
        query_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.querymanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.querymanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number,
            targetGroup: query_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
     
        sg_fargate.addIngressRule(sg_alb, Port.tcp(1026));
     
        
        
        // SCORPIO SUBSCRIPTION MANAGER   
        const subscription_manager_log =  new LogGroup(this, 'ScorpioSubscriptionManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_subscriptionmanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
          })
        const subscription_manager_task_def = new FargateTaskDefinition( this, "ScorpioSubscriptionManagerFargateDefinition",{
              taskRole: fargate_task_role,
              cpu: deployment_params.subscriptionmanager_fargate_cpu!,
              memoryLimitMiB: deployment_params.subscriptionmanager_fargate_memory_limit!,
              family: `garnet-scorpio-subscription-manager-definition`
        })
        subscription_manager_task_def.addContainer("subscriptionManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.subscription_manager),
            environment: scorpio_task_env,
            secrets: {
              DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
              DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName: `${garnet_nomenclature.garnet_broker_subscriptionmanager}-container`,
            portMappings: [
              {
                containerPort: 2026,
                hostPort: 2026,
              }
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup:subscription_manager_log
            })
        })
        const subscription_manager_service = new FargateService( this, "SubscriptionManagerService", {
              cluster: fargate_cluster,
              taskDefinition: subscription_manager_task_def,
              serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
              },
              ...deployment_config,
              serviceName: `${garnet_nomenclature.garnet_broker_subscriptionmanager}-service`,
              assignPublicIp: false,
              securityGroups: [sg_fargate],
            }
        )
      
        const subscription_manager_target = fargate_alb_listener.addTargets( "SubscriptionManagerTarget",{
            targets: [subscription_manager_service],
            conditions: [
            ListenerCondition.pathPatterns([
                "/ngsi-ld/v1/subscriptions",
                "/ngsi-ld/v1/subscriptions/*",
                "/remotenotify",
                "/remotenotify/*",
            ]),
            ],
            priority: 50,
            targetGroupName: "SubscriptionManager",
            healthCheck: {
            path: "/q/health",
            port: "2026",
            },
            protocol: ApplicationProtocol.HTTP,
        }
        )
    
        fargate_alb_listener.addTargets("SubscriptionManagerTargetQ", {
            targets: [subscription_manager_service],
            conditions: [
            ListenerCondition.httpRequestMethods(["GET"]),
            ListenerCondition.pathPatterns([
                "/q/*",
            ]),
            ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_subscriptionmanager]),
            ],
            targetGroupName: "SubscriptionManagerQ",
            priority: 450,
            healthCheck: {
            path: "/q/health",
            port: "2026",
            },
            protocol: ApplicationProtocol.HTTP,
        })
      
        subscription_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.subscriptionmanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.subscriptionmanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: subscription_manager_target,
            scaleInCooldown: Duration.seconds(5),
            scaleOutCooldown: Duration.seconds(10),
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(2026))


        // SCORPIO HISTORY ENTITY MANAGER 
        const history_entity_manager_log = new LogGroup(this, 'ScorpioHistoryEntityManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_historyentitymanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
          })
        const history_entity_manager_task_def = new FargateTaskDefinition( this, "ScorpioHistoryEntityManagerFargateDefinition", {
            taskRole: fargate_task_role,
            cpu: deployment_params.historyentitymanager_fargate_cpu!,
            memoryLimitMiB: deployment_params.historyentitymanager_fargate_memory_limit!,
            family: `garnet-scorpio-history-entity-manager-definition`
        })

        history_entity_manager_task_def.addContainer("historyEntityManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.history_entity_manager),
            environment: scorpio_task_env,
            secrets: {
              DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
              DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName: `${garnet_nomenclature.garnet_broker_historyentitymanager}-container`,
            portMappings: [
              {
                containerPort: 1040,
                hostPort: 1040,
              }
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup: history_entity_manager_log
            })
        })

        const history_entity_manager_service = new FargateService( this, "HistoryEntityManagerService",{
              cluster: fargate_cluster,
              taskDefinition: history_entity_manager_task_def,
              serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
              },
              ...deployment_config,
              serviceName: `${garnet_nomenclature.garnet_broker_historyentitymanager}-service`,
              assignPublicIp: false,
              securityGroups: [sg_fargate],
            }
        )
      
        const history_entity_manager_target = fargate_alb_listener.addTargets( "HistoryEntityManager", {
            targets: [history_entity_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["POST", "DELETE", "PATCH"]),
                ListenerCondition.pathPatterns(["/ngsi-ld/v1/temporal/entities/*"])
            ],
            priority: 30,
            targetGroupName: "HistoryEntityManager",
            healthCheck: {
                path: "/q/health",
                port: "1040",
            },
            protocol: ApplicationProtocol.HTTP
        })
      
        fargate_alb_listener.addTargets("HistoryEntityManagerTargetQ", {
            targets: [history_entity_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns([
                    "/q/*"
                ]),
                ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_historyentitymanager])
            ],
            targetGroupName: "HistoryEntityManagerQ",
            priority: 470,
            healthCheck: {
                path: "/q/health",
                port: "1040"
            },
            protocol: ApplicationProtocol.HTTP,
        })
      
        history_entity_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.historyentitymanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.historyentitymanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: history_entity_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(1040))



        // SCORPIO HISTORY QUERY MANAGER 
        const history_query_manager_log = new LogGroup(this, 'ScorpioHistoryQueryManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_historyquerymanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const history_query_manager_task_def = new FargateTaskDefinition( this, "ScorpioHistoryQueryManagerFargateDefinition", {
            taskRole: fargate_task_role,
            cpu: deployment_params.historyquerymanager_fargate_cpu!,
            memoryLimitMiB: deployment_params.historyquerymanager_fargate_memory_limit!,
            family: `garnet-scorpio-history-query-manager-definition`
        })
        history_query_manager_task_def.addContainer("historyQueryManager", {
        essential: true,
        image: ContainerImage.fromRegistry(garnet_scorpio_images.history_query_manager),
        environment: { ...scorpio_task_env, QUARKUS_HTTP_PORT: "1041" },
        secrets: {
            DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
            DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
        },
        containerName: `${garnet_nomenclature.garnet_broker_historyquerymanager}-container`,
        portMappings: [
            {
            containerPort: 1041,
            hostPort: 1041,
            }
        ],
        logging: LogDrivers.awsLogs({
            streamPrefix: `garnet/scorpio`,
            logGroup: history_query_manager_log
        })
        })
        const history_query_manager_service = new FargateService(this, "HistoryQueryManagerService", {
            cluster: fargate_cluster,
            taskDefinition: history_query_manager_task_def,
            serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
            },
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_historyquerymanager}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate]
        })
      
        const history_query_manager_target = fargate_alb_listener.addTargets("HistoryQueryManager", {
            targets: [history_query_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns(["/ngsi-ld/v1/temporal/entities/*"])
            ],
            priority: 40,
            targetGroupName: "HistoryQueryManager",
            healthCheck: {
                path: "/q/health",
                port: "1041"
            },
            protocol: ApplicationProtocol.HTTP,
        })
      
        fargate_alb_listener.addTargets("HistoryQueryManagerTargetGroupQ", {
            targets: [history_query_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns(["/q/*"]),
                ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_historyquerymanager])
            ],
            targetGroupName: "HistoryQueryManagerQ",
            priority: 460,
            healthCheck: {
                path: "/q/health",
                port: "1041"
            },
            protocol: ApplicationProtocol.HTTP
        })
      
        history_query_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.historyquerymanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.historyquerymanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number,
            targetGroup: history_query_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(1041));
      

        // SCORPIO AT CONTEXT SERVER 
        const at_context_server_log = new LogGroup(this, 'ScorpioAtContextServerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_atcontextserver}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const at_context_server_task_def = new FargateTaskDefinition( this, "ScorpioAtContextServerFargateDefinition", {
            taskRole: fargate_task_role,
            cpu: deployment_params.atcontextserver_fargate_cpu,
            memoryLimitMiB: deployment_params.atcontextserver_fargate_memory_limit,
            family: `garnet-scorpio-at-context-server-definition`
        })
        at_context_server_task_def.addContainer("atContextServer", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.at_context_server),
            environment: {...scorpio_task_env, QUARKUS_FLYWAY_MIGRATE_AT_START: "true",  QUARKUS_FLYWAY_REPAIR_AT_START: "true", },
            secrets: {
                DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
                DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName: `${garnet_nomenclature.garnet_broker_atcontextserver}-container`,
            portMappings: [
                {
                name: garnet_nomenclature.garnet_broker_atcontextserver,
                containerPort: 2023,
                hostPort: 2023,
                },
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup: at_context_server_log
            })
        })
        const at_context_server_service = new FargateService(this,"AtContextServerService", {
            cluster: fargate_cluster,
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_atcontextserver}-service`,
            taskDefinition: at_context_server_task_def,
            assignPublicIp: false,
            securityGroups: [sg_fargate],
            serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
                services: [
                    {
                        portMappingName: garnet_nomenclature.garnet_broker_atcontextserver,
                        dnsName: garnet_nomenclature.garnet_broker_atcontextserver,
                        port: 2023
                    }
                ]
            }
        })
        
        fargate_alb_listener.addTargets("AtContextServerTargetGroupQ", {
            targets: [at_context_server_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns(["/q/*"]),
                ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_atcontextserver])
            ],
            targetGroupName: "AtContextServerQ",
            priority: 420,
            healthCheck: {
                path: "/q/health",
                port: "2023"
            },
            protocol: ApplicationProtocol.HTTP
        })
    
        fargate_alb_listener.addTargets("AtContextServerTarget", {
            targets: [at_context_server_service],
            conditions: [
                ListenerCondition.pathPatterns(
                    [
                        "/ngsi-ld/v1/jsonldContexts/",
                        "/ngsi-ld/v1/jsonldContexts/*",
                        "/createcache/",
                        "/createcache/*"
                    ]
                ),
            ],
            priority: 111,
            targetGroupName: "AtContextServer",
            healthCheck: {
                path: "/q/health",
                port: "2023",
            },
            protocol: ApplicationProtocol.HTTP
        })
        
      
        at_context_server_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.atcontextserver_autoscale_min_capacity!,
            maxCapacity: deployment_params.atcontextserver_autoscale_max_capacity!,
        })
        .scaleOnCpuUtilization("CpuUtilizationScaling", {
            targetUtilizationPercent: 50,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
      
        sg_fargate.addIngressRule(sg_fargate, Port.tcp(2023));
        sg_fargate.addIngressRule(sg_alb, Port.tcp(2023));
      
        
        
        // SCORPIO REGISTRY MANAGER
        const registry_manager_log = new LogGroup(this, 'ScorpioRegistryManagerLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_registrymanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })            
        const registry_manager_task_def = new FargateTaskDefinition( this, "ScorpioRegistryManagerFargateDefinition",{
            taskRole: fargate_task_role,
            cpu: deployment_params.registrymanager_fargate_cpu!,
            memoryLimitMiB: deployment_params.registrymanager_fargate_memory_limit!,
            family: `garnet-scorpio-registry-manager-definition`
        })
        registry_manager_task_def.addContainer("registryManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.registry_manager),
            environment: scorpio_task_env,
            secrets: {
                DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
                DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName: `${garnet_nomenclature.garnet_broker_registrymanager}-container`,
            portMappings: [
                {
                containerPort: 1030,
                hostPort: 1030,
                }
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup: registry_manager_log
            })
        })
        const registry_manager_service = new FargateService(this,"RegistryManagerService",{
            cluster: fargate_cluster,
            taskDefinition: registry_manager_task_def,
            serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
            },
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_registrymanager}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate]
        })
      
        const registry_manager_target = fargate_alb_listener.addTargets("RegistryManagerTargetGroup", {
            targets: [registry_manager_service],
            conditions: [
                ListenerCondition.pathPatterns(["/ngsi-ld/v1/csourceRegistrations","/ngsi-ld/v1/csourceRegistrations/*"])
            ],
            priority: 300,
            targetGroupName: "RegistryManager",
            healthCheck: {
                path: "/q/health",
                port: "1030"
            },
            protocol: ApplicationProtocol.HTTP
        })
      
        fargate_alb_listener.addTargets("RegistryManagerQ", {
            targets: [registry_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns(["/q/*"]),
                ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_registrymanager])
            ],
            targetGroupName: "RegistryManagerQ",
            priority: 440,
            healthCheck: {
                path: "/q/health",
                port: "1030"
            },
            protocol: ApplicationProtocol.HTTP
        })
      
        registry_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.registrymanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.registrymanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: registry_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30)
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(1030))

      
        // SCORPIO REGISTRY SUBSCRIPTION MANAGER 
        const registry_subscription_manager_log = new LogGroup(this, 'ScorpioRegistrySubscriptionManagerFargateLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_registrysubscriptionmanager}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
            })
        const registry_subscription_manager_task_def = new FargateTaskDefinition(this, "ScorpioRegistrySubscriptionManagerFargateDefinition", {
            taskRole: fargate_task_role,
            cpu: deployment_params.registrysubscriptionmanager_fargate_cpu!,
            memoryLimitMiB: deployment_params.registrysubscriptionmanager_fargate_memory_limit!,
            family: `garnet-scorpio-registry-subscription-manager-definition`
        })
        registry_subscription_manager_task_def.addContainer( "registrySubscriptionManager", {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.registry_subscription_manager),
            environment: scorpio_task_env,
            secrets: {
                DBPASS: ecsSecret.fromSecretsManager(secret, "password"),
                DBUSER: ecsSecret.fromSecretsManager(secret, "username"),
            },
            containerName: `${garnet_nomenclature.garnet_broker_registrysubscriptionmanager}-container`,
            portMappings: [
                {
                containerPort: 2025,
                hostPort: 2025,
                },
            ],
            logging: LogDrivers.awsLogs({
                streamPrefix: `garnet/scorpio`,
                logGroup: registry_subscription_manager_log
            })
            }
        )
      
        const registry_subscription_manager_service = new FargateService(this,"RegistrySubscriptionManagerService",{
            cluster: fargate_cluster,
            taskDefinition: registry_subscription_manager_task_def,
            serviceConnectConfiguration: {
                namespace: fargate_cluster.defaultCloudMapNamespace?.namespaceName,
            },
            ...deployment_config,
            serviceName: `${garnet_nomenclature.garnet_broker_registrysubscriptionmanager}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate]
        })
    
        const registry_subscription_manager_target = fargate_alb_listener.addTargets("RegistrySubscriptionManagerTargetGroup", {
            targets: [registry_subscription_manager_service],
            conditions: [
                ListenerCondition.pathPatterns(["/ngsi-ld/v1/csourceSubscriptions","/ngsi-ld/v1/csourceSubscriptions/*"]),
            ],
            priority: 200,
            targetGroupName: "RegistrySubManager",
            healthCheck: {
                path: "/q/health",
                port: "2025"
            },
            protocol: ApplicationProtocol.HTTP
        })
      
        fargate_alb_listener.addTargets("RegistrySubscriptionManagerQ", {
            targets: [registry_subscription_manager_service],
            conditions: [
                ListenerCondition.httpRequestMethods(["GET"]),
                ListenerCondition.pathPatterns(["/q/*"]),
                ListenerCondition.httpHeader("container", [garnet_nomenclature.garnet_broker_registrysubscriptionmanager]),
            ],
            targetGroupName: "RegistrySubManagerQ",
            priority: 430,
            healthCheck: {
                path: "/q/health",
                port: "2025"
            },
            protocol: ApplicationProtocol.HTTP
        })
      
      
        registry_subscription_manager_service
        .autoScaleTaskCount({
            minCapacity: deployment_params.registrysubscriptionmanager_autoscale_min_capacity!,
            maxCapacity: deployment_params.registrysubscriptionmanager_autoscale_max_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number,
            targetGroup: registry_subscription_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(2025))

        entity_manager_service.node.addDependency(at_context_server_service)
        query_manager_service.node.addDependency(at_context_server_service)
        registry_manager_service.node.addDependency(at_context_server_service)
        subscription_manager_service.node.addDependency(at_context_server_service)
        history_query_manager_service.node.addDependency(at_context_server_service)
        history_entity_manager_service.node.addDependency(at_context_server_service)
        registry_subscription_manager_service.node.addDependency(at_context_server_service)
        at_context_server_service.node.addDependency(fargate_cluster)

    } else {

        const all_in_one_log = new LogGroup(this, 'ScorpioAllInOneLogs', {
            retention: RetentionDays.ONE_MONTH, 
            // logGroupName: `${garnet_nomenclature.garnet_broker_allinone}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })
        const all_in_one_container_name = `${garnet_nomenclature.garnet_broker_allinone}-container`
        const all_in_one_environment = {...scorpio_task_env, QUARKUS_FLYWAY_MIGRATE_AT_START: "true",  QUARKUS_FLYWAY_REPAIR_AT_START: "true" }
        const all_in_one_secrets = {
            DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
            DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
        }
        const all_in_one_log_driver = LogDrivers.awsLogs({
            streamPrefix: `garnet/scorpio`,
            logGroup: all_in_one_log
        })

    if (blue_green) {

        /**
         * Blue/green needs the service registered against a listener *rule* whose
         * target group ECS can swap. ApplicationLoadBalancedFargateService attaches its
         * target group as the listener default action and does not accept a deployment
         * strategy, so the concentrated path is built explicitly here instead.
         *
         * Note this is a different resource topology from the rolling path: switching an
         * existing stack between strategies replaces the load balancer and the broker
         * gets a new internal DNS name. See DEPLOYMENT.md before flipping it.
         */
        const fargate_alb = new ApplicationLoadBalancer(this, 'ScorpioLoadBalancerBlueGreen', {
            vpc: props.vpc,
            internetFacing: false,
            securityGroup: sg_alb,
            loadBalancerName: `${garnet_nomenclature.garnet_load_balancer}-${deployment_params.architecture}`,
            idleTimeout: Duration.seconds(60),
            dropInvalidHeaderFields: true,
            deletionProtection: false
        })

        const production_listener = fargate_alb.addListener('ScorpioProductionListener', {
            port: 80,
            defaultAction: ListenerAction.fixedResponse(404, { messageBody: "Not Found" })
        })

        // Routes to whichever task set is not yet live, so a release can be exercised
        // end to end before any production request reaches it. Internal only.
        const test_listener = fargate_alb.addListener('ScorpioTestListener', {
            port: Parameters.deployment_test_listener_port,
            protocol: ApplicationProtocol.HTTP,
            defaultAction: ListenerAction.fixedResponse(404, { messageBody: "Not Found" })
        })

        const make_target_group = (id: string, name: string) => new ApplicationTargetGroup(this, id, {
            vpc: props.vpc,
            port: 9090,
            protocol: ApplicationProtocol.HTTP,
            targetType: TargetType.IP,
            targetGroupName: name,
            healthCheck: { path: '/q/health', port: '9090' },
            deregistrationDelay: Duration.seconds(30)
        })

        // ECS swaps which of these two sits behind the production rule on each deployment
        const blue_target_group = make_target_group('ScorpioBlueTargetGroup', 'garnet-broker-blue')
        const green_target_group = make_target_group('ScorpioGreenTargetGroup', 'garnet-broker-green')

        const production_rule = new ApplicationListenerRule(this, 'ScorpioProductionRule', {
            listener: production_listener,
            priority: 1,
            conditions: [ListenerCondition.pathPatterns(['/*'])],
            targetGroups: [blue_target_group]
        })

        const test_rule = new ApplicationListenerRule(this, 'ScorpioTestRule', {
            listener: test_listener,
            priority: 1,
            conditions: [ListenerCondition.pathPatterns(['/*'])],
            targetGroups: [green_target_group]
        })

        const all_in_one_task_def = new FargateTaskDefinition(this, 'ScorpioAllInOneFargateDefinition', {
            taskRole: fargate_task_role,
            cpu: deployment_params.all_fargate_cpu!,
            memoryLimitMiB: deployment_params.all_fargate_memory_limit!,
            family: `garnet-scorpio-all-in-one-task-definition`
        })

        all_in_one_task_def.addContainer('allInOne', {
            essential: true,
            image: ContainerImage.fromRegistry(garnet_scorpio_images.allInOne),
            containerName: all_in_one_container_name,
            environment: all_in_one_environment,
            secrets: all_in_one_secrets,
            portMappings: [{ containerPort: 9090, hostPort: 9090 }],
            logging: all_in_one_log_driver
        })

        const all_in_one_service = new FargateService(this, 'FargateServiceScorpioBlueGreen', {
            cluster: fargate_cluster,
            taskDefinition: all_in_one_task_def,
            serviceName: `${garnet_nomenclature.garnet_broker_allinone}-service`,
            assignPublicIp: false,
            securityGroups: [sg_fargate],
            healthCheckGracePeriod: Duration.seconds(120),
            ...deployment_config
        })

        blue_target_group.addTarget(all_in_one_service.loadBalancerTarget({
            containerName: all_in_one_container_name,
            containerPort: 9090,
            alternateTarget: new AlternateTarget('ScorpioAlternateTarget', {
                alternateTargetGroup: green_target_group,
                productionListener: ListenerRuleConfiguration.applicationListenerRule(production_rule),
                testListener: ListenerRuleConfiguration.applicationListenerRule(test_rule)
            })
        }))

        all_in_one_service.autoScaleTaskCount({
            minCapacity: deployment_params.all_autoscale_min_capacity!,
            maxCapacity: deployment_params.all_autoscale_max_capacity!
        }).scaleOnRequestCount('RequestScaling', {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: blue_target_group,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30)
        })

        this.fargate_alb = fargate_alb

    } else {

        const fargate_alb = new ApplicationLoadBalancedFargateService(this, 'FargateServiceScorpio', {
            cluster: fargate_cluster,
            serviceName: `${garnet_nomenclature.garnet_broker_allinone}-service`,
            circuitBreaker: {
                rollback: true
            },
            cpu: deployment_params.all_fargate_cpu!,
            memoryLimitMiB: deployment_params.all_fargate_memory_limit,
            minHealthyPercent: 50,
            maxHealthyPercent: 400,

            // The container waits SCORPIO_STARTUPDELAY then runs Flyway migrations before
            // /q/health answers, so a short grace period kills tasks mid-startup
            healthCheckGracePeriod: Duration.seconds(120),
            publicLoadBalancer: false,
            loadBalancerName: `${garnet_nomenclature.garnet_load_balancer}-${deployment_params.architecture}`,
            taskImageOptions: {
                containerName: all_in_one_container_name,
                family: `garnet-scorpio-all-in-one-task-definition`,
                image: ContainerImage.fromRegistry(garnet_scorpio_images.allInOne),
                taskRole: fargate_task_role,
                secrets: all_in_one_secrets,
                environment: all_in_one_environment,
                containerPort: 9090,
                logDriver: all_in_one_log_driver
            },
        // Default is 512
            securityGroups: [sg_fargate]
        })



        fargate_alb.service.autoScaleTaskCount({
            minCapacity: deployment_params.all_autoscale_min_capacity!,
            maxCapacity: deployment_params.all_autoscale_max_capacity!
            }).scaleOnRequestCount('RequestScaling', {
            requestsPerTarget: deployment_params.autoscale_requests_number!,
            targetGroup: fargate_alb.targetGroup,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30)
        })

        this.fargate_alb = fargate_alb.loadBalancer

        fargate_alb.targetGroup.configureHealthCheck({
            path: '/q/health',
            port: '9090'
        })

        // Default drain is 300s, which holds scaled-in tasks (and their DB
        // connections) far longer than the 10s scale-in cooldown expects
        fargate_alb.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30')

    }

}
   
       

    }


}
