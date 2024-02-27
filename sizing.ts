// SIZING OF THE GARNET DEPLOYMENT

/***
 * achitecture: if "concentrated", the AllinOne container is used. If "distributed", the microservice architecture is deployed.
 * fargate_cpu : https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
 * fargate_memory_limit: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
 * *_autoscale_min_capacity; minimum number of task for the container. 
 * aurora_min_capacity: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.min_capacity_considerations
 * aurora_max_capacity: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.max_capacity_considerations
 */

import { DBClusterStorageType } from "aws-cdk-lib/aws-rds";
import {Parameters} from "./parameters"

const sizing = Parameters.sizing

const enum ARCHITECTURE {
    Concentrated = "concentrated", 
    Distributed = "distributed"
}

type DeploymentParams = {
    architecture: string,
    autoscale_requests_number: number,
    lambda_broker_batch_window: number, 
    lambda_broker_batch_size: number, 
    lambda_broker_concurent_sqs: number,
    aurora_storage_type?: DBClusterStorageType,
    aurora_min_capacity: number, 
    aurora_max_capacity: number, 
    all_fargate_cpu?: number,
    all_fargate_memory_limit?: number, 
    all_autoscale_min_capacity?: number, 
    all_autoscale_max_capacity?: number,
    entitymanager_fargate_cpu?: number, 
    entitymanager_fargate_memory_limit?: number,
    entitymanager_autoscale_min_capacity?: number, 
    entitymanager_autoscale_max_capacity?: number,
    subscriptionmanager_fargate_cpu?: number, 
    subscriptionmanager_fargate_memory_limit?: number,
    subscriptionmanager_autoscale_min_capacity?: number, 
    subscriptionmanager_autoscale_max_capacity?: number,
    registrymanager_fargate_cpu?: number, 
    registrymanager_fargate_memory_limit?: number,
    registrymanager_autoscale_min_capacity?: number, 
    registrymanager_autoscale_max_capacity?: number,
    querymanager_fargate_cpu?: number, 
    querymanager_fargate_memory_limit?: number,
    querymanager_autoscale_min_capacity?: number, 
    querymanager_autoscale_max_capacity?: number,
    registrysubscriptionmanager_fargate_cpu?: number, 
    registrysubscriptionmanager_fargate_memory_limit?: number,
    registrysubscriptionmanager_autoscale_min_capacity?: number, 
    registrysubscriptionmanager_autoscale_max_capacity?: number,
    historyentitymanager_fargate_cpu?: number, 
    historyentitymanager_fargate_memory_limit?: number,
    historyentitymanager_autoscale_min_capacity?: number, 
    historyentitymanager_autoscale_max_capacity?: number,
    historyquerymanager_fargate_cpu?: number, 
    historyquerymanager_fargate_memory_limit?: number,
    historyquerymanager_autoscale_min_capacity?: number, 
    historyquerymanager_autoscale_max_capacity?: number,
    atcontextserver_fargate_cpu?: number, 
    atcontextserver_fargate_memory_limit?: number,
    atcontextserver_autoscale_min_capacity?: number, 
    atcontextserver_autoscale_max_capacity?: number
}



export let deployment_params: DeploymentParams 

switch (true) {
    case sizing < 3:
        deployment_params = {
            architecture: ARCHITECTURE.Concentrated,
            autoscale_requests_number: 15, 

            lambda_broker_batch_window: 1,
            lambda_broker_batch_size: 10, 
            lambda_broker_concurent_sqs: 20,

            aurora_min_capacity: 1, 
            aurora_max_capacity: 2, 

            all_fargate_cpu: 1024, 
            all_fargate_memory_limit: 4096,

            all_autoscale_min_capacity: 2, 
            all_autoscale_max_capacity: 10,

        }
        break;
    case sizing == 3:
        deployment_params = {
            architecture: ARCHITECTURE.Distributed,
            aurora_min_capacity: 2, 
            aurora_max_capacity: 5,
            autoscale_requests_number: 15, 

            lambda_broker_batch_window: 1,
            lambda_broker_batch_size: 20, 
            lambda_broker_concurent_sqs: 30,

            entitymanager_fargate_cpu: 1024, 
            entitymanager_fargate_memory_limit: 4096,
            entitymanager_autoscale_min_capacity: 3, 
            entitymanager_autoscale_max_capacity: 15,

            subscriptionmanager_fargate_cpu: 1024, 
            subscriptionmanager_fargate_memory_limit: 4096,
            subscriptionmanager_autoscale_min_capacity: 3, 
            subscriptionmanager_autoscale_max_capacity: 12,

            registrymanager_fargate_cpu: 1024, 
            registrymanager_fargate_memory_limit: 4096,
            registrymanager_autoscale_min_capacity: 2, 
            registrymanager_autoscale_max_capacity: 10,

            querymanager_fargate_cpu: 1024, 
            querymanager_fargate_memory_limit: 4096,
            querymanager_autoscale_min_capacity: 2, 
            querymanager_autoscale_max_capacity: 10,

            registrysubscriptionmanager_fargate_cpu: 1024, 
            registrysubscriptionmanager_fargate_memory_limit: 4096,
            registrysubscriptionmanager_autoscale_min_capacity: 2, 
            registrysubscriptionmanager_autoscale_max_capacity: 10,

            historyentitymanager_fargate_cpu: 1024, 
            historyentitymanager_fargate_memory_limit: 4096,
            historyentitymanager_autoscale_min_capacity: 2, 
            historyentitymanager_autoscale_max_capacity: 10,

            historyquerymanager_fargate_cpu: 1024, 
            historyquerymanager_fargate_memory_limit: 4096,
            historyquerymanager_autoscale_min_capacity: 2, 
            historyquerymanager_autoscale_max_capacity: 10,

            atcontextserver_fargate_cpu: 1024, 
            atcontextserver_fargate_memory_limit: 4096,
            atcontextserver_autoscale_min_capacity: 2, 
            atcontextserver_autoscale_max_capacity: 10
        }
        break;
    case sizing == 4:
        deployment_params = {
            architecture: ARCHITECTURE.Distributed,
            aurora_min_capacity: 5, 
            aurora_max_capacity: 30,
            autoscale_requests_number: 20, 

            lambda_broker_batch_window: 1,
            lambda_broker_batch_size: 20, 
            lambda_broker_concurent_sqs: 50,

            entitymanager_fargate_cpu: 2048, 
            entitymanager_fargate_memory_limit: 16384,
            entitymanager_autoscale_min_capacity: 5, 
            entitymanager_autoscale_max_capacity: 30,

            subscriptionmanager_fargate_cpu: 2048, 
            subscriptionmanager_fargate_memory_limit: 16384,
            subscriptionmanager_autoscale_min_capacity: 5, 
            subscriptionmanager_autoscale_max_capacity: 25,

            registrymanager_fargate_cpu: 1024, 
            registrymanager_fargate_memory_limit: 4096,
            registrymanager_autoscale_min_capacity: 2, 
            registrymanager_autoscale_max_capacity: 15,

            querymanager_fargate_cpu: 1024, 
            querymanager_fargate_memory_limit: 4096,
            querymanager_autoscale_min_capacity: 2, 
            querymanager_autoscale_max_capacity: 15,

            registrysubscriptionmanager_fargate_cpu: 1024, 
            registrysubscriptionmanager_fargate_memory_limit: 4096,
            registrysubscriptionmanager_autoscale_min_capacity: 2, 
            registrysubscriptionmanager_autoscale_max_capacity: 15,

            historyentitymanager_fargate_cpu: 1024, 
            historyentitymanager_fargate_memory_limit: 4096,
            historyentitymanager_autoscale_min_capacity: 2, 
            historyentitymanager_autoscale_max_capacity: 15,

            historyquerymanager_fargate_cpu: 1024, 
            historyquerymanager_fargate_memory_limit: 4096,
            historyquerymanager_autoscale_min_capacity: 2, 
            historyquerymanager_autoscale_max_capacity: 15,

            atcontextserver_fargate_cpu: 1024, 
            atcontextserver_fargate_memory_limit: 4096,
            atcontextserver_autoscale_min_capacity: 2, 
            atcontextserver_autoscale_max_capacity: 15
        }
        break;
    case sizing > 4:
        deployment_params = {
            architecture: ARCHITECTURE.Distributed,
            aurora_min_capacity: 10, 
            aurora_max_capacity: 80,
            autoscale_requests_number: 20, 

            lambda_broker_batch_window: 1,
            lambda_broker_batch_size: 20, 
            lambda_broker_concurent_sqs: 100,

            entitymanager_fargate_cpu: 4096, 
            entitymanager_fargate_memory_limit: 30720,
            entitymanager_autoscale_min_capacity: 10, 
            entitymanager_autoscale_max_capacity: 60,

            subscriptionmanager_fargate_cpu: 4096, 
            subscriptionmanager_fargate_memory_limit: 30720,
            subscriptionmanager_autoscale_min_capacity: 10, 
            subscriptionmanager_autoscale_max_capacity: 50,

            registrymanager_fargate_cpu: 1024, 
            registrymanager_fargate_memory_limit: 4096,
            registrymanager_autoscale_min_capacity: 2, 
            registrymanager_autoscale_max_capacity: 30,

            querymanager_fargate_cpu: 1024, 
            querymanager_fargate_memory_limit: 4096,
            querymanager_autoscale_min_capacity: 2, 
            querymanager_autoscale_max_capacity: 30,

            registrysubscriptionmanager_fargate_cpu: 1024, 
            registrysubscriptionmanager_fargate_memory_limit: 4096,
            registrysubscriptionmanager_autoscale_min_capacity: 2, 
            registrysubscriptionmanager_autoscale_max_capacity: 30,

            historyentitymanager_fargate_cpu: 1024, 
            historyentitymanager_fargate_memory_limit: 4096,
            historyentitymanager_autoscale_min_capacity: 2, 
            historyentitymanager_autoscale_max_capacity: 30,

            historyquerymanager_fargate_cpu: 1024, 
            historyquerymanager_fargate_memory_limit: 4096,
            historyquerymanager_autoscale_min_capacity: 2, 
            historyquerymanager_autoscale_max_capacity: 30,

            atcontextserver_fargate_cpu: 1024, 
            atcontextserver_fargate_memory_limit: 4096,
            atcontextserver_autoscale_min_capacity: 2, 
            atcontextserver_autoscale_max_capacity: 30
        }
        break;
    default:
        deployment_params = {
            architecture: ARCHITECTURE.Concentrated,
            autoscale_requests_number: 20, 

            lambda_broker_batch_window: 1,
            lambda_broker_batch_size: 20, 
            lambda_broker_concurent_sqs: 10,

            aurora_min_capacity: 1, 
            aurora_max_capacity: 2, 

            all_fargate_cpu: 1024, 
            all_fargate_memory_limit: 4096,

            all_autoscale_min_capacity: 2, 
            all_autoscale_max_capacity: 10,

        }
        break;
}

deployment_params.aurora_storage_type = DBClusterStorageType.AURORA_IOPT1


