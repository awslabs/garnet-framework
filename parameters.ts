import { Aws } from "aws-cdk-lib"
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2"
import {StorageType } from "aws-cdk-lib/aws-rds"
import { Broker } from "./lib/stacks/garnet-constructs/constants"

export const Parameters = {
    // GARNET PARAMETERS
    aws_region: "eu-west-1", // see regions in which you can deploy Garnet: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability
    garnet_broker: Broker.SCORPIO, // CHOOSE BETWEEN SCORPIO AND ORION. 
    garnet_bucket: `garnet-datalake-${Aws.REGION}-${Aws.ACCOUNT_ID}`, // Default name, change only if really needed.
    smart_data_model_url : 'https://raw.githubusercontent.com/smart-data-models/data-models/master/context.jsonld',  
    // FARGATE PARAMETERS
    garnet_fargate: {
        fargate_cpu: 1024,
        fargate_memory_limit: 4096,
        autoscale_requests_number: 500, 
        autoscale_min_capacity: 2, 
        autoscale_max_capacity: 10
    },
    // SCORPIO BROKER PARAMETERS
    garnet_scorpio: {
        image_context_broker: 'public.ecr.aws/garnet/scorpio:4.1.6', // Link to ECR Public gallery of Scorpio Broker image.
        rds_instance_type: InstanceType.of( InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MEDIUM), // see https://aws.amazon.com/rds/instance-types/
        rds_storage_type: StorageType.GP3, // see https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html
        dbname: 'scorpio'
    },
    // ORION-LD PARAMETERS
    garnet_orion: {
        image_context_broker: 'fiware/orion-ld:1.5.0-PRE-1467-debug', // Link to ECR Public gallery of Orion image.
        docdb_instance_type: InstanceType.of( InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MEDIUM), // https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-classes.html 
        docdb_nb_instances: 2
    }
}