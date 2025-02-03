

// List of AZs that support VPC links for HTTP APIs as https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability

import { Aws } from "aws-cdk-lib"
const {version} = require('./package.json')

const garnet_scorpio_version = "5.0.71"

export const garnet_bucket =  `garnet-datalake-${Aws.REGION}-${Aws.ACCOUNT_ID}` // DO NOT CHANGE
export const garnet_bucket_athena = `${garnet_bucket}-athena-results`
export const garnet_broker = "Scorpio" 


export enum SIZING {
    Small = 2, 
    Medium = 3, 
    Large = 4, 
    Xlarge = 5
}



export const garnet_constant = {
    garnet_version: version,
    shadow_prefix: "Garnet",
    dbname: 'scorpio',
    subAllName: 'GarnetDataLakeSub-DoNotDelete',
    iotDomainName: 'garnet-iot-domain', 
    gluedbName: 'garnetdb'
}

export const garnet_scorpio_images = {
    allInOne: `public.ecr.aws/garnet/scorpio:${garnet_scorpio_version}`,
    at_context_server: `public.ecr.aws/garnet/scorpio/at-context-server:${garnet_scorpio_version}`,
    entity_manager: `public.ecr.aws/garnet/scorpio/entity-manager:${garnet_scorpio_version}`, 
    history_entity_manager: `public.ecr.aws/garnet/scorpio/history-entity-manager:${garnet_scorpio_version}`,
    history_query_manager: `public.ecr.aws/garnet/scorpio/history-query-manager:${garnet_scorpio_version}`,
    query_manager: `public.ecr.aws/garnet/scorpio/query-manager:${garnet_scorpio_version}`, 
    registry_manager: `public.ecr.aws/garnet/scorpio/registry-manager:${garnet_scorpio_version}`,
    registry_subscription_manager: `public.ecr.aws/garnet/scorpio/registry-subscription-manager:${garnet_scorpio_version}`,
    subscription_manager: `public.ecr.aws/garnet/scorpio/subscription-manager:${garnet_scorpio_version}`
}

export const scorpiobroker_sqs_object = {
    "SCORPIO_TOPICS_ENTITY": `garnet-scorpiobroker-entity`, 
    "SCORPIO_TOPICS_REGISTRY": `garnet-scorpiobroker-registry`,
    "SCORPIO_TOPICS_TEMPORAL": `garnet-scorpiobroker-temporal`,
    "SCORPIO_TOPICS_INTERNALNOTIFICATION": `garnet-scorpiobroker-internalnotification`,
    "SCORPIO_TOPICS_INTERNALREGSUB": `garnet-scorpiobroker-internalregsub`,
}

export const garnet_nomenclature = {
    // DEPRECATED 
    garnet_iot_rule: `garnet_iot_rule`, 
    garnet_iot_update_shadow_lambda: `garnet-iot-update-shadow-lambda`, 
    garnet_iot_update_broker_lambda: `garnet-iot-update-broker-lambda`,


    // GARNET MODEL 

    aws_iot_thing: "AwsIotThing",
    aws_iot_lorawan_thing: "AwsIotLorawanThing",
    aws_iot_lorawan_gateway: "AwsIotLorawanGateway", 
    
    //GARNET INGESTION LAMBDA
    garnet_ingestion_update_broker_lambda: `garnet-ingestion-update-broker-lambda`,
    garnet_lake_transform_lambda: `garnet-lake-transform-lambda`, 
    garnet_iot_presence_shadow_lambda: `garnet-iot-presence-shadow-lambda`,
    garnet_iot_authorizer_lambda: `garnet-iot-authorizer-lambda`,
    garnet_private_sub_lambda: `garnet-private-sub-lambda`, 
    garnet_lake_rule:`garnet_lake_rule`,
    garnet_subscriptions_rule: `garnet_subscriptions_rule`,
    garnet_iot_presence_rule: `garnet_iot_presence_rule`,
    
    // GARNET API AUTH
    garnet_api_auth_jwt_lambda: `garnet-api-auth-jwt-lambda`,
    garnet_api_authorizer_lambda: `garnet-api-authorizer-lambda`,
    
    garnet_api_auth_audience: `garnet-api`, 
    garnet_api_auth_issuer: `garnet-framework`, 
    garnet_api_auth_sub: `garnet:default-user`, 

    // GARNET IOT SQS
    garnet_iot_queue: `garnet-iot-sqs-${Aws.REGION}`, // DEPRECATED 
    garnet_ingestion_queue: `garnet-ingestion-queue-${Aws.REGION}`, // DEPRECATED 
    garnet_iot_contextbroker_queue: `garnet-iot-sqs-contextbroker-${Aws.REGION}`,
    garnet_iot_presence_queue: `garnet-iot-sqs-presence-${Aws.REGION}`,

    // GARNET FIREHOSE 
    garnet_lake_iot_firehose_stream: `garnet-datalake-firehose-stream`,
    garnet_sub_firehose_stream: `garnet-subs-firehose-stream`, 

    // GARNET BROKER CLUSTER
    garnet_broker_cluster: `garnet-broker-cluster`,
    
    // GARNET BROKER SERVICES 
    garnet_broker_entitymanager: `garnet-broker-entity-manager`,
    garnet_broker_querymanager: `garnet-broker-query-manager`, 
    garnet_broker_subscriptionmanager: `garnet-broker-subscription-manager`,
    garnet_broker_historyentitymanager: `garnet-broker-history-entity-manager`,
    garnet_broker_historyquerymanager: `garnet-broker-history-querymanager`, 
    garnet_broker_atcontextserver: `garnet-broker-at-context-server`,
    garnet_broker_registrymanager: `garnet-broker-registry-manager`,
    garnet_broker_registrysubscriptionmanager: `garnet-broker-registry-subscription-manager`, 
    garnet_broker_allinone: `garnet-broker-all-in-one`, 

    // GARNET LOAD BALANCER 
    garnet_load_balancer: `garnet-broker-alb`, 

    // SECRET 
    garnet_secret: `garnet/secret/brokerdb`,
    garnet_api_jwt_secret: `garnet/secret/api`,

    // SECURITY GROUPS
    garnet_broker_sg_database: `garnet-broker-database-sg`,
    garnet_broker_sg_rds: `garnet-broker-rds-proxy-sg`,
    garnet_broker_sg_alb: `garnet-broker-alb-sg`,
    garnet_broker_sg_fargate: `garnet-broker-fargate-sg`,

  // GARNET DB 
  garnet_proxy_rds: `garnet-proxy-rds`,
  garnet_db_cluster_id: `garnet-aurora-cluster`,


  // GARNET UTILS 

  garnet_utils_clean_ecs_taks_lambda :`garnet-utils-clean-ecstasks-lambda`,
  garnet_utils_scorpio_sqs_lambda :`garnet-utils-scorpio-cleansqs-lambda`,
  garnet_utils_az_lambda :`garnet-utils-getaz-lambda`,
  garnet_utils_bucket_create_lambda: `garnet-utils-bucket-create-lambda`,
  garnet_utils_bucket_check_lambda: `garnet-utils-bucket-check-lambda`,
  garnet_utils_bucket_provider: `garnet-utils-bucket-provider-lambda`
}



export const azlist: any = {
    "us-east-2": ["use2-az1", "use2-az2", "use2-az3"], 
    "us-east-1": ["use1-az1", "use1-az2", "use1-az4", "use1-az5", "use1-az6"],
    "us-west-1": ["usw1-az1", "usw1-az3"],
    "us-west-2": ["usw2-az1", "usw2-az2", "usw2-az3", "usw2-az4"],
    "ap-east-1": ["ape1-az2", "ape1-az3"],
    "ap-south-1": ["aps1-az1", "aps1-az2", "aps1-az3"],
    "ap-northeast-2": ["apne2-az1", "apne2-az2", "apne2-az3"],
    "ap-southeast-1": ["apse1-az1", "apse1-az2", "apse1-az3"],
    "ap-southeast-2": ["apse2-az1", "apse2-az2", "apse2-az3"],
    "ap-northeast-1": ["apne1-az1", "apne1-az2", "apne1-az4"],
    "ca-central-1": ["cac1-az1", "cac1-az2"],
    "eu-central-1": ["euc1-az1", "euc1-az2", "euc1-az3"],
    "eu-west-1": ["euw1-az1", "euw1-az2", "euw1-az3"],
    "eu-west-2": ["euw2-az1", "euw2-az2", "euw2-az3"],
    "eu-west-3": ["euw3-az1", "euw3-az3"],
    "eu-north-1": ["eun1-az1", "eun1-az2", "eun1-az3"],
    "me-south-1": ["mes1-az1", "mes1-az2", "mes1-az3"],
    "sa-east-1": ["sae1-az1", "sae1-az2", "sae1-az3"],
    "us-gov-west-1": ["usgw1-az1", "usgw1-az2", "usgw1-az3"]
}







