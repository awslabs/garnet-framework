import {
  NestedStack,
  NestedStackProps,
  Stack
} from "aws-cdk-lib"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import {
  GARNET_EVENT_TABLE,
  GarnetDataLakeAthena
} from "./athena/athena-construct"
import { GarnetBucket } from "./bucket/bucket-construct"
import { GarnetTableCompaction } from "./optimization/table-compaction-construct"
import { GarnetDataLakeStream } from "./stream/firehose-stream-construct"

export interface GarnetLakeProps extends NestedStackProps {}

export class GarnetLake extends NestedStack {
  public readonly delivery_stream: CfnDeliveryStream
  public readonly bucket_name: string

  constructor(scope: Stack, id: string, props: GarnetLakeProps) {
    super(scope, id, props)

    const buckets = new GarnetBucket(this, "Buckets")
    const catalog = new GarnetDataLakeAthena(this, "Catalog", {
      data_bucket: buckets.bucket,
      results_bucket: buckets.athena_bucket
    })
    new GarnetTableCompaction(this, "TableCompaction", {
      bucket: buckets.bucket,
      database_name: catalog.database.ref,
      table: catalog.event_table,
      table_name: GARNET_EVENT_TABLE
    })
    const stream = new GarnetDataLakeStream(this, "Stream", {
      bucket: buckets.bucket,
      database_name: catalog.database.ref,
      table_name: GARNET_EVENT_TABLE
    })
    stream.node.addDependency(catalog.event_table)

    this.bucket_name = buckets.bucket_name
    this.delivery_stream =
      stream.datalake_kinesis_firehose_delivery_stream
  }
}
