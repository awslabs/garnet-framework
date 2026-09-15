import { DBClusterStorageType } from "aws-cdk-lib/aws-rds";
import {Parameters} from "./configuration"

export const enum ARCHITECTURE {
    Distributed = "distributed"
}

export const enum DEPLOYMENT_STRATEGY {
    Rolling = "rolling",
    BlueGreen = "bluegreen"
}

export const enum SCHEMA_COMPATIBILITY {
    Unchanged = "unchanged",
    BackwardCompatible = "backward-compatible"
}

type DeploymentParams = {
    architecture: ARCHITECTURE,
    /**
     * Blue/green gives the externally routed API an alternate target group,
     * pre-production validation and an alarm-guarded traffic switch. Workers
     * remain rolling because duplicate consumers cannot be isolated by an ALB.
     */
    deployment_strategy: DEPLOYMENT_STRATEGY,
    schema_compatibility: SCHEMA_COMPATIBILITY,
    /**
     * How long the previous task set is kept after traffic shifts, so a
     * regression can be rolled back without a redeploy. Blue/green only.
     */
    deployment_bake_time_minutes: number,
    deployment_test_listener_port: number,
    lambda_broker_batch_window: number,
    lambda_broker_batch_size: number,
    lambda_broker_concurent_sqs: number,
    nat_gateway_count: 1 | 2,
    database_deletion_protection: boolean,
    database_backup_retention_days: number,
    temporal_history_retention_days: number,
    temporal_history_retention_max_gib: number,
    temporal_history_retention_max_partitions: number,
    aurora_storage_type?: DBClusterStorageType,
    aurora_min_capacity: number, 
    aurora_max_capacity: number
}



export const deployment_params: DeploymentParams = {
        architecture: ARCHITECTURE.Distributed,
        aurora_min_capacity: 8,
        aurora_max_capacity: 256,
        nat_gateway_count: Parameters.nat_gateway_count,
        database_deletion_protection:
            Parameters.database_deletion_protection,
        database_backup_retention_days:
            Parameters.database_backup_retention_days,
        temporal_history_retention_days:
            Parameters.temporal_history_retention_days,
        temporal_history_retention_max_gib:
            Parameters.temporal_history_retention_max_gib,
        temporal_history_retention_max_partitions:
            Parameters.temporal_history_retention_max_partitions,

        deployment_strategy:
            Parameters.deployment_strategy as DEPLOYMENT_STRATEGY,
        schema_compatibility:
            Parameters.garnet_schema_compatibility as
                SCHEMA_COMPATIBILITY,
        deployment_bake_time_minutes: Parameters.deployment_bake_time_minutes,
        deployment_test_listener_port:
            Parameters.deployment_test_listener_port,

        lambda_broker_batch_window: 1,
        lambda_broker_batch_size: 20, 
        lambda_broker_concurent_sqs: 30
}

deployment_params.aurora_storage_type = DBClusterStorageType.AURORA_IOPT1
