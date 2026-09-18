

// List of AZs that support VPC links for HTTP APIs as https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability

import { Aws } from "aws-cdk-lib"
const {version} = require('./package.json')

export const garnet_stack_name = "GarnetFramework"
export const garnet_resource_prefix = "garnet-framework"
export const garnet_resource_name = (name: string): string =>
    `${garnet_resource_prefix}-${name}`

export const garnet_bucket =
    `${garnet_resource_prefix}-datalake-${Aws.REGION}-${Aws.ACCOUNT_ID}`
export const garnet_bucket_athena = `${garnet_bucket}-athena-results`
export const garnet_broker = "Garnet Broker"
export const garnet_sigv4_server_id =
    `garnet:${Aws.ACCOUNT_ID}:${Aws.REGION}`
export const garnet_sts_endpoint =
    `https://sts.${Aws.REGION}.${Aws.URL_SUFFIX}`

export const garnet_constant = {
    garnet_version: version,
    dbname: "garnet",
    gluedbName: "garnet_framework"
}

export const garnet_nomenclature = {
    aws_iot_thing: "AwsIotThing",
    aws_iot_thing_group: "AwsIotThingGroup",
    
    garnet_ingestion_update_broker_lambda:
        garnet_resource_name("ingestion-update-broker"),
    garnet_ingestion_update_broker_role:
        garnet_resource_name("ingestion-update-broker-role"),
    garnet_lake_transform_lambda:
        garnet_resource_name("lake-transform"),
    garnet_iot_lifecycle_lambda:
        garnet_resource_name("iot-thing-lifecycle"),
    garnet_iot_lifecycle_role:
        garnet_resource_name("iot-thing-lifecycle-role"),
    garnet_iot_presence_lambda:
        garnet_resource_name("iot-presence"),
    garnet_iot_presence_role:
        garnet_resource_name("iot-presence-role"),
    garnet_iot_group_membership_lambda:
        garnet_resource_name("iot-group-membership"),
    garnet_iot_group_membership_role:
        garnet_resource_name("iot-group-membership-role"),
    garnet_iot_group_lifecycle_lambda:
        garnet_resource_name("iot-group-lifecycle"),
    garnet_iot_group_lifecycle_role:
        garnet_resource_name("iot-group-lifecycle-role"),
    garnet_private_sub_lambda:
        garnet_resource_name("private-subscription"),
    garnet_subscriptions_rule: "garnet_framework_subscriptions",
    garnet_iot_presence_rule: "garnet_framework_iot_presence",
    
    garnet_ingestion_queue:
        `${garnet_resource_prefix}-ingestion-${Aws.REGION}`,
    garnet_ingestion_dlq:
        `${garnet_resource_prefix}-ingestion-dlq-${Aws.REGION}`,
    garnet_iot_presence_queue:
        `${garnet_resource_prefix}-iot-presence-${Aws.REGION}`,

    garnet_lake_firehose_stream:
        garnet_resource_name("datalake"),
    garnet_sub_firehose_stream:
        garnet_resource_name("subscriptions"),
    garnet_lake_firehose_interval: 60, // seconds
    garnet_lake_buffer_size: 64, // MB

    garnet_api_client_secret:
        `${garnet_resource_prefix}/secret/api-client`,

    garnet_utils_az_lambda:
        garnet_resource_name("utils-get-az"),
}

export const garnet_broker_connector_role_names = Object.freeze([
    garnet_nomenclature.garnet_ingestion_update_broker_role,
    garnet_nomenclature.garnet_iot_lifecycle_role,
    garnet_nomenclature.garnet_iot_presence_role,
    garnet_nomenclature.garnet_iot_group_membership_role,
    garnet_nomenclature.garnet_iot_group_lifecycle_role
])



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
