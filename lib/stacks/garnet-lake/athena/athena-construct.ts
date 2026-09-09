import { Aws, RemovalPolicy } from "aws-cdk-lib"
import { CfnWorkGroup } from "aws-cdk-lib/aws-athena"
import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-glue"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"
import {
  garnet_constant,
  garnet_resource_name
} from "../../../../constants"

export const GARNET_EVENT_TABLE = "entity_events"

export interface GarnetDataLakeAthenaProps {
  data_bucket: Bucket
  results_bucket: Bucket
}

export class GarnetDataLakeAthena extends Construct {
  public readonly database: CfnDatabase
  public readonly event_table: CfnTable
  public readonly workgroup: CfnWorkGroup

  constructor(
    scope: Construct,
    id: string,
    props: GarnetDataLakeAthenaProps
  ) {
    super(scope, id)

    this.database = new CfnDatabase(this, "Database", {
      catalogId: Aws.ACCOUNT_ID,
      databaseInput: {
        name: garnet_constant.gluedbName,
        description: "Garnet Broker multi-tenant event lake"
      }
    })

    this.event_table = new CfnTable(this, "EntityEvents", {
      catalogId: Aws.ACCOUNT_ID,
      databaseName: this.database.ref,
      name: GARNET_EVENT_TABLE,
      openTableFormatInput: {
        icebergInput: {
          metadataOperation: "CREATE",
          version: "2",
          icebergTableInput: {
            location:
              `s3://${props.data_bucket.bucketName}/iceberg/entity-events/`,
            schema: {
              schemaId: 0,
              type: "struct",
              identifierFieldIds: [2],
              fields: [
                {
                  id: 1,
                  name: "schema_version",
                  required: true,
                  type: "int"
                },
                {
                  id: 2,
                  name: "event_id",
                  required: true,
                  type: "string"
                },
                {
                  id: 3,
                  name: "tenant",
                  required: true,
                  type: "string"
                },
                {
                  id: 4,
                  name: "entity_id",
                  required: true,
                  type: "string"
                },
                {
                  id: 5,
                  name: "committed_at",
                  required: true,
                  type: "timestamp"
                },
                {
                  id: 6,
                  name: "aggregate_version",
                  required: true,
                  type: "string"
                },
                {
                  id: 7,
                  name: "control_cursor",
                  required: true,
                  type: "string"
                },
                {
                  id: 8,
                  name: "operation",
                  required: true,
                  type: "string"
                },
                {
                  id: 9,
                  name: "entity_type",
                  required: false,
                  type: "string"
                },
                {
                  id: 10,
                  name: "payload_json",
                  required: true,
                  type: "string"
                }
              ]
            },
            partitionSpec: {
              specId: 0,
              fields: [
                {
                  fieldId: 1000,
                  name: "tenant",
                  sourceId: 3,
                  transform: "identity"
                },
                {
                  fieldId: 1001,
                  name: "committed_day",
                  sourceId: 5,
                  transform: "day"
                }
              ]
            },
            properties: {
              "format-version": "2",
              "write.parquet.compression-codec": "zstd",
              "write.target-file-size-bytes": "536870912",
              "write.object-storage.partitioned-paths": "true"
            }
          }
        }
      }
    })
    this.event_table.applyRemovalPolicy(RemovalPolicy.RETAIN)

    this.workgroup = new CfnWorkGroup(this, "WorkGroup", {
      name: garnet_resource_name("lake"),
      description: "Queries for the Garnet Broker Iceberg event lake",
      state: "ENABLED",
      recursiveDeleteOption: false,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        requesterPaysEnabled: false,
        resultConfiguration: {
          expectedBucketOwner: Aws.ACCOUNT_ID,
          outputLocation:
            `s3://${props.results_bucket.bucketName}/queries/`,
          encryptionConfiguration: {
            encryptionOption: "SSE_S3"
          }
        }
      }
    })
  }
}
