import { Aws, CustomResource, Duration,NestedStack, NestedStackProps, RemovalPolicy, Stack } from "aws-cdk-lib"




import { Provider } from "aws-cdk-lib/custom-resources"
import { garnet_bucket, garnet_constant, garnet_nomenclature } from "../../../constants"
import { GarnetBucket } from "./bucket/bucket-construct"
import { GarnetDataLakeAthena } from "./athena/athena-construct"
import { GarnetDataLakeStream } from "./stream/firehose-stream-construct"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"



export interface GarnetLakeProps extends NestedStackProps{
   
  }


export class GarnetLake extends NestedStack {
      public readonly delivery_stream: CfnDeliveryStream
      public readonly bucket_name: string
    
    constructor(scope: Stack, id: string, props: GarnetLakeProps) {
        super(scope, id)


      const bucket = new GarnetBucket(this, 'GarnetBucket', {})

      

      const athena = new GarnetDataLakeAthena(this, 'LakeAthena', {})
      const lake_stream = new GarnetDataLakeStream(this, 'LakeStream', {
        bucket_name: bucket.bucket_name
      })

      lake_stream.node.addDependency(bucket)

      this.bucket_name = bucket.bucket_name
      this.delivery_stream = lake_stream.datalake_kinesis_firehose_delivery_stream
  }
  


}