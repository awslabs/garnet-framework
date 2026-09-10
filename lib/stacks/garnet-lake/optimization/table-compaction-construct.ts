import { Aws } from "aws-cdk-lib"
import { CfnTable, CfnTableOptimizer } from "aws-cdk-lib/aws-glue"
import {
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
    props.bucket.grantReadWrite(role)
    role.addToPolicy(new PolicyStatement({
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
    }))
    role.addToPolicy(new PolicyStatement({
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      resources: [
        `arn:${Aws.PARTITION}:logs:${Aws.REGION}:` +
          `${Aws.ACCOUNT_ID}:log-group:/aws-glue/iceberg-*`
      ]
    }))

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
    optimizer.node.addDependency(props.table)
  }
}
