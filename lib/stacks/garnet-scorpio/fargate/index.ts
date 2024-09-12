import { Aws, Duration,  RemovalPolicy, SecretValue } from "aws-cdk-lib"
import { InterfaceVpcEndpoint, Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDrivers, Secret as ecsSecret } from "aws-cdk-lib/aws-ecs"

import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import {garnet_broker, garnet_constant, garnet_nomenclature, garnet_scorpio_images, scorpiobroker_sqs_object} from "../../../../constants"
import { Construct, Dependable } from "constructs"
import { Parameters } from "../../../../parameters"
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction, ListenerCondition } from "aws-cdk-lib/aws-elasticloadbalancingv2"

import { deployment_params } from "../../../../sizing"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"

export interface GarnetScorpioFargateProps {
    vpc: Vpc
    sg_proxy: SecurityGroup,
    db_endpoint: string,
    db_port: string,
    secret_arn: string,
    image_context_broker: string
}

export class GarnetScorpioFargate extends Construct {
    public readonly fargate_alb : ApplicationLoadBalancer

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

        // SECURITY GROUP FOR RDS PROXY
        const sg_proxy = SecurityGroup.fromSecurityGroupId(this, 'sgDb', props.sg_proxy.securityGroupId)

        sg_proxy.addIngressRule(sg_fargate, Port.tcp(5432))


        // FARGATE CLUSTER 
        const fargate_cluster = new Cluster(this, 'FargateScorpioCluster', {
            vpc: props.vpc,
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
                    `arn:aws:sns:${Aws.REGION}:${Aws.ACCOUNT_ID}:garnet-scorpiobroker-*`
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

        // SCORPIO TASK ENV
        let scorpio_task_env = {
            DBHOST: props.db_endpoint,
            DBPORT: props.db_port,
            DBNAME: garnet_constant.dbname,
            SCORPIO_AT_CONTEXT_SERVER: `http://${garnet_nomenclature.garnet_broker_atcontextserver}:2023`,
            SCORPIO_ENTITY_MANAGER_SERVER: `http://${garnet_nomenclature.garnet_broker_entitymanager}:1025`,
            SCORPIO_STARTUPDELAY: "5s",
            SCORPIO_ENTITY_MAX_LIMIT: "1000",
            SCORPIO_MESSAGING_MAX_SIZE: "100",
            ATCONTEXT_CACHE_DURATION: "10m",
            AWS_REGION: Aws.REGION,
            QUARKUS_LOG_LEVEL: "INFO",
            MYSETTINGS_MESSAGECONNECTION_OPTIONS: "?delay=250&greedy=true",
            QUARKUS_DATASOURCE_REACTIVE_IDLE_TIMEOUT: "20",
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
            logGroupName: `${garnet_nomenclature.garnet_broker_entitymanager}-logs`,
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_querymanager}-logs`,
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_subscriptionmanager}-logs`,
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
              minHealthyPercent: 50,
              maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_historyentitymanager}-logs`,
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
              minHealthyPercent: 50,
              maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_historyquerymanager}-logs`,
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
        environment: { QUARKUS_HTTP_PORT: "1041", ...scorpio_task_env },
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_atcontextserver}-logs`,
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
            environment: scorpio_task_env,
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
                ListenerCondition.pathPatterns(["/ngsi-ld/v1/jsonldContexts/","/ngsi-ld/v1/jsonldContexts/*"]),
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
            logGroupName: `${garnet_nomenclature.garnet_broker_registrymanager}-logs`,
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
            logGroupName: `${garnet_nomenclature.garnet_broker_registrysubscriptionmanager}-logs`,
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
            minHealthyPercent: 50,
            maxHealthyPercent: 400,
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
            maxCapacity: deployment_params.registrysubscriptionmanager_autoscale_min_capacity!,
        })
        .scaleOnRequestCount("RequestScaling", {
            requestsPerTarget: deployment_params.autoscale_requests_number,
            targetGroup: registry_subscription_manager_target,
            scaleInCooldown: Duration.seconds(10),
            scaleOutCooldown: Duration.seconds(30),
        })
      
        sg_fargate.addIngressRule(sg_alb, Port.tcp(2025))

        // entity_manager_service.node.addDependency(at_context_server_service)
        // query_manager_service.node.addDependency(entity_manager_service)
        // registry_manager_service.node.addDependency(entity_manager_service)
        // subscription_manager_service.node.addDependency(entity_manager_service)
        // history_query_manager_service.node.addDependency(entity_manager_service)
        // history_entity_manager_service.node.addDependency(entity_manager_service)
        // registry_subscription_manager_service.node.addDependency(entity_manager_service)
        // at_context_server_service.node.addDependency(fargate_cluster)

    } else {

        const all_in_one_log = new LogGroup(this, 'ScorpioAllInOneLogs', {
            retention: RetentionDays.ONE_MONTH, 
            logGroupName: `${garnet_nomenclature.garnet_broker_allinone}-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })
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

            healthCheckGracePeriod: Duration.seconds(20),  
            publicLoadBalancer: false, 
            loadBalancerName: `${garnet_nomenclature.garnet_load_balancer}-${deployment_params.architecture}`,
            taskImageOptions: {
                containerName: `${garnet_nomenclature.garnet_broker_allinone}-container`, 
                family: `garnet-scorpio-all-in-one-task-definition`, 
                image: ContainerImage.fromRegistry(garnet_scorpio_images.allInOne),
                taskRole: fargate_task_role,
                secrets: {
                    DBPASS: ecsSecret.fromSecretsManager(secret, 'password'),
                    DBUSER: ecsSecret.fromSecretsManager(secret, 'username')
                },
                environment: scorpio_task_env,
                containerPort: 9090,
                logDriver: LogDrivers.awsLogs({
                    streamPrefix: `garnet/scorpio`,
                    logGroup: all_in_one_log
                })
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

}
   
       

    }


}
