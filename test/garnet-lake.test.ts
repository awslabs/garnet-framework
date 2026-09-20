import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import { GarnetLake } from "../lib/stacks/garnet-lake/garnet-lake-stack"

describe("Garnet multi-tenant Iceberg lake", () => {
  it("partitions immutable events by tenant and day", () => {
    const app = new App()
    const parent = new Stack(app, "Parent", {
      env: {
        account: "111111111111",
        region: "eu-west-3"
      }
    })
    const lake = new GarnetLake(parent, "Lake", {})
    const template = Template.fromStack(lake)

    template.resourceCountIs("AWS::S3::Bucket", 2)
    template.hasResourceProperties("AWS::Glue::Database", {
      DatabaseInput: {
        Name: "garnet_framework"
      }
    })
    template.hasResourceProperties("AWS::Glue::Table", {
      Name: "entity_events",
      OpenTableFormatInput: {
        IcebergInput: {
          MetadataOperation: "CREATE",
          Version: "2",
          IcebergTableInput: Match.objectLike({
            PartitionSpec: {
              SpecId: 0,
              Fields: [
                {
                  FieldId: 1000,
                  Name: "tenant",
                  SourceId: 3,
                  Transform: "identity"
                },
                {
                  FieldId: 1001,
                  Name: "committed_day",
                  SourceId: 5,
                  Transform: "day"
                }
              ]
            },
            Schema: Match.objectLike({
              IdentifierFieldIds: [2]
            }),
            Properties: Match.objectLike({
              "write.object-storage.partitioned-paths": "true"
            })
          })
        }
      }
    })
    template.hasResourceProperties("AWS::Athena::WorkGroup", {
      Name: "garnet-framework-lake",
      WorkGroupConfiguration: Match.objectLike({
        EnforceWorkGroupConfiguration: true
      })
    })
    template.hasResourceProperties("AWS::Glue::TableOptimizer", {
      Type: "compaction",
      TableName: "entity_events",
      TableOptimizerConfiguration: Match.objectLike({
        Enabled: true,
        CompactionConfiguration: {
          IcebergConfiguration: {
            Strategy: "binpack",
            MinInputFiles: 10
          }
        }
      })
    })
    const optimizers = template.findResources(
      "AWS::Glue::TableOptimizer"
    )
    const optimizer = Object.values(optimizers)[0]
    expect(optimizer.DependsOn).toEqual(expect.arrayContaining([
      expect.stringMatching(/CatalogEntityEvents/),
      expect.stringMatching(/TableCompactionPolicy/)
    ]))
    const policies = template.findResources("AWS::IAM::Policy")
    const policy = Object.entries(policies).find(([logical_id]) =>
      logical_id.includes("TableCompactionPolicy")
    )?.[1]
    expect(policy).toBeDefined()
    const statements =
      policy!.Properties.PolicyDocument.Statement
    expect(statements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        Action: ["glue:GetTable", "glue:UpdateTable"],
        Effect: "Allow"
      }),
      expect.objectContaining({
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject"
        ],
        Effect: "Allow"
      }),
      expect.objectContaining({
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Effect: "Allow"
      })
    ]))
    expect(JSON.stringify(policy))
      .toContain("iceberg-compaction/logs:*")
    template.hasResourceProperties(
      "AWS::KinesisFirehose::DeliveryStream",
      {
        DeliveryStreamName: "garnet-framework-datalake",
        DeliveryStreamType: "DirectPut",
        IcebergDestinationConfiguration: Match.objectLike({
          AppendOnly: true,
          DestinationTableConfigurationList: [{
            DestinationDatabaseName: Match.anyValue(),
            DestinationTableName: "entity_events",
            S3ErrorOutputPrefix:
              "failed/table=!{firehose:error-output-type}/"
          }],
          ProcessingConfiguration: {
            Enabled: true,
            Processors: [Match.objectLike({
              Type: "Lambda"
            })]
          }
        })
      }
    )
    expect(JSON.stringify(template.toJSON()))
      .not.toContain("S3BackupMode")
    expect(JSON.stringify(template.toJSON()))
      .not.toContain("RecordDeAggregation")
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "garnet-framework-lake-transform",
      Architectures: ["arm64"],
      Runtime: "nodejs24.x"
    })
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "glue:GetDatabase",
              "glue:GetTable",
              "glue:UpdateTable"
            ]),
            Effect: "Allow"
          }),
          Match.objectLike({
            Action: "lambda:GetFunctionConfiguration",
            Effect: "Allow",
            Resource: Match.anyValue()
          })
        ])
      }
    })
    expect(
      JSON.stringify(template.toJSON())
        .match(/lakeformation:GetDataAccess/g)
    ).toHaveLength(2)
  })
})
