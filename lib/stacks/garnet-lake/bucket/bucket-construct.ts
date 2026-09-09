import { RemovalPolicy } from "aws-cdk-lib"
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption
} from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"
import {
  garnet_bucket,
  garnet_bucket_athena
} from "../../../../constants"

export class GarnetBucket extends Construct {
  public readonly bucket: Bucket
  public readonly athena_bucket: Bucket
  public readonly bucket_name: string

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.bucket = new Bucket(this, "DataLake", {
      bucketName: garnet_bucket,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN
    })
    this.athena_bucket = new Bucket(this, "AthenaResults", {
      bucketName: garnet_bucket_athena,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN
    })
    this.bucket_name = this.bucket.bucketName
  }
}
