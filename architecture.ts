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
    authorization_cutover_stopped: boolean,
    lambda_broker_batch_window: number,
    lambda_broker_batch_size: number,
    lambda_broker_concurent_sqs: number,
    nat_gateway_count: 1 | 2,
    database_reader_enabled: boolean,
    database_reader_count: number,
    aws_iot_core_mqtt_connector_enabled: boolean,
    ecs_instance_type: string,
    worker_spot_scale_out: boolean,
    database_deletion_protection: boolean,
    database_backup_retention_days: number,
    temporal_history_retention_days: number,
    temporal_history_retention_max_gib: number,
    temporal_history_retention_max_partitions: number,
    aurora_storage_type: DBClusterStorageType,
    aurora_min_capacity: number, 
    aurora_max_capacity: number,
    entity_mutation_batch_max: number,
    entity_mutation_batch_workers_per_process: number,
    entity_mutation_batch_window_ms: number,
    entity_mutation_batch_queue_max_per_process: number,
    entity_mutation_batch_diagnostics: boolean
}



export const deployment_params: DeploymentParams = {
        architecture: ARCHITECTURE.Distributed,
        aurora_min_capacity: Parameters.aurora_min_capacity,
        aurora_max_capacity: Parameters.aurora_max_capacity,
        entity_mutation_batch_max:
            Parameters.entity_mutation_batch_max,
        entity_mutation_batch_workers_per_process:
            Parameters.entity_mutation_batch_workers_per_process,
        entity_mutation_batch_window_ms:
            Parameters.entity_mutation_batch_window_ms,
        entity_mutation_batch_queue_max_per_process:
            Parameters.entity_mutation_batch_queue_max_per_process,
        entity_mutation_batch_diagnostics:
            Parameters.entity_mutation_batch_diagnostics,
        aurora_storage_type:
            Parameters.aurora_storage === "io-optimized"
                ? DBClusterStorageType.AURORA_IOPT1
                : DBClusterStorageType.AURORA,
        nat_gateway_count: Parameters.nat_gateway_count,
        database_reader_enabled: Parameters.database_reader_enabled,
        database_reader_count: Parameters.database_reader_count,
        aws_iot_core_mqtt_connector_enabled:
            Parameters.aws_iot_core_mqtt_connector_enabled,
        ecs_instance_type: Parameters.ecs_instance_type,
        worker_spot_scale_out: Parameters.worker_spot_scale_out,
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
        authorization_cutover_stopped:
            Parameters.garnet_authorization_cutover_stopped,

        lambda_broker_batch_window: 1,
        lambda_broker_batch_size: 20, 
        lambda_broker_concurent_sqs: 30
}
