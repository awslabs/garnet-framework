import { Aws } from "aws-cdk-lib"
import {DBClusterStorageType} from "aws-cdk-lib/aws-rds"
import { Broker } from "./lib/stacks/garnet-constructs/constants"

export const Parameters = {
    // GARNET PARAMETERS
    aws_region: "eu-west-1", // see regions in which you can deploy Garnet: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability
    garnet_broker: Broker.SCORPIO, // DO NOT CHANGE 
    garnet_bucket: `garnet-datalake-${Aws.REGION}-${Aws.ACCOUNT_ID}`, // DO NOT CHANGE
    smart_data_model_url : 'https://raw.githubusercontent.com/awslabs/garnet-framework/main/context.jsonld',  
    // FARGATE PARAMETERS
    garnet_fargate: {
        fargate_cpu: 2048, // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
        fargate_memory_limit: 16384, // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
        autoscale_requests_number: 10, 
        autoscale_min_capacity: 30, 
        autoscale_max_capacity: 100
    },
    // SCORPIO BROKER PARAMETERS
    garnet_scorpio: {
        image_context_broker: 'public.ecr.aws/garnet/scorpio:4.1.12', // Link to ECR Public gallery of Scorpio Broker image: https://gallery.ecr.aws/garnet/scorpio.
        aurora_min_capacity: 2, // https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.min_capacity_considerations
        aurora_max_capacity: 30, // https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.max_capacity_considerations
        storage_type: DBClusterStorageType.AURORA_IOPT1, //  https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html#aurora-storage-type
        dbname: 'scorpio'
    }, 
    garnet_iot: {
        lambda_broker_batch_window: 2, // The maximum amount of time to gather records before invoking the function, in seconds.
        lambda_broker_concurent_sqs: 10, // The maximum concurrency setting limits the number of concurrent instances of the function that an Amazon SQS event source can invoke.
        lambda_broker_batch_size: 20
    }
}