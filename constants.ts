

// List of AZs that support VPC links for HTTP APIs as https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability

import { Aws } from "aws-cdk-lib"
const {version} = require('./package.json')

const garnet_scorpio_version = "4.1.15"

export const garnet_bucket =  `garnet-datalake-${Aws.REGION}-${Aws.ACCOUNT_ID}` // DO NOT CHANGE
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
    "SCORPIO_TOPICS_ENTITYBATCH": `garnet-scorpiobroker-entitybatch`,
    "SCORPIO_TOPICS_REGISTRY": `garnet-scorpiobroker-registry`,
    "SCORPIO_TOPICS_TEMPORAL": `garnet-scorpiobroker-temporal`,
    "SCORPIO_TOPICS_INTERNALNOTIFICATION": `garnet-scorpiobroker-internalnotification`,
    "SCORPIO_TOPICS_INTERNALREGSUB": `garnet-scorpiobroker-internalregsub`,
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







