import { Aws } from "aws-cdk-lib"
import { CfnTable, CfnTableOptimizer } from "aws-cdk-lib/aws-glue"
import {
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"

export interface GarnetTableCompactionProps {
  bucket: Bucket
  database_name: string
  table: CfnTable
  table_name: string
}

export class GarnetTableCompaction extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: GarnetTableCompactionProps
  ) {
    super(scope, id)

    const role = new Role(this, "Role", {
      assumedBy: new ServicePrincipal("glue.amazonaws.com")
    })
    const policy = new Policy(this, "Policy", {
      roles: [role],
      statements: [
        new PolicyStatement({
          actions: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:DeleteObject"
          ],
          resources: [props.bucket.arnForObjects("*")]
        }),
        new PolicyStatement({
          actions: ["s3:ListBucket"],
          resources: [props.bucket.bucketArn]
        }),
        new PolicyStatement({
          actions: ["glue:GetTable", "glue:UpdateTable"],
          resources: [
            `arn:${Aws.PARTITION}:glue:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:catalog`,
            `arn:${Aws.PARTITION}:glue:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:database/${props.database_name}`,
            `arn:${Aws.PARTITION}:glue:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:table/${props.database_name}/` +
              props.table_name
          ]
        }),
        new PolicyStatement({
          actions: ["lakeformation:GetDataAccess"],
          resources: ["*"]
        }),
        new PolicyStatement({
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: [
            `arn:${Aws.PARTITION}:logs:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:log-group:/aws-glue/` +
              "iceberg-compaction/logs:*",
            `arn:${Aws.PARTITION}:logs:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:log-group:/aws-glue/` +
              "iceberg-retention/logs:*",
            `arn:${Aws.PARTITION}:logs:${Aws.REGION}:` +
              `${Aws.ACCOUNT_ID}:log-group:/aws-glue/` +
              "iceberg-orphan-file-deletion/logs:*"
          ]
        })
      ]
    })

    const optimizer = new CfnTableOptimizer(this, "Optimizer", {
      catalogId: Aws.ACCOUNT_ID,
      databaseName: props.database_name,
      tableName: props.table_name,
      type: "compaction",
      tableOptimizerConfiguration: {
        enabled: true,
        roleArn: role.roleArn,
        compactionConfiguration: {
          icebergConfiguration: {
            strategy: "binpack",
            minInputFiles: 10
          }
        }
      }
    })
    optimizer.node.addDependency(props.table, policy)
  }
}
