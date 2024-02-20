import { Aws, CustomResource, Duration, Lazy, Names, RemovalPolicy } from "aws-cdk-lib"
import { InterfaceVpcEndpoint, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { CfnAuthorizer, CfnDomainConfiguration, CfnTopicRule } from "aws-cdk-lib/aws-iot"
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose"
import { Runtime, Function, Code, Architecture, CfnPermission, LayerVersion } from "aws-cdk-lib/aws-lambda"
import {  ARecord, PrivateHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53"
import { InterfaceVpcEndpointTarget } from "aws-cdk-lib/aws-route53-targets"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"
import { Provider } from "aws-cdk-lib/custom-resources"
import { garnet_bucket, garnet_constant, garnet_nomenclature } from "../../../../constants"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { deployment_params } from "../../../../sizing"

export interface GarnetLakeProps {
    vpc: Vpc, 
    bucket_name: string
    dns_context_broker: string,
    az1: string
    az2: string
  }


export class GarnetLake extends Construct {

    public readonly iot_rule_lake_name: string
    public readonly iot_domain_name: string

    constructor(scope: Construct, id: string, props: GarnetLakeProps) {
        super(scope, id)


    // LAMBDA LAYER (SHARED LIBRARIES)
    const layer_lambda_path = `./lib/layers`;
    const layer_lambda = new LayerVersion(this, "LayerLambda", {
      code: Code.fromAsset(layer_lambda_path),
      compatibleRuntimes: [Runtime.NODEJS_20_X],
    })



    // KINESIS FIREHOSE TO DATALAKE BUCKET 

    // DATALAKE BUCKET
    const bucket = Bucket.fromBucketName(this, "GarnetBucket", props.bucket_name)


    // ROLE THAT GRANTS ACCESS TO FIREHOSE TO READ/WRITE BUCKET
    const role_firehose = new Role(this, "FirehoseRole", {
      assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
    });
    bucket.grantReadWrite(role_firehose)


    // LAMBDA THAT EXTRACT ENTITIES FROM SUBSCRIPTION IN FIREHOSE STREAM
    const lambda_transform_path = `${__dirname}/lambda/transform`
    const lambda_transform = new Function(this, 'LakeTransformLambda', {
    functionName: garnet_nomenclature.garnet_lake_transform_lambda, 
        description: 'Garnet Lake - Function that transforms the Kinesis Firehose records to extract entities from notifications',
        runtime: Runtime.NODEJS_20_X,
        layers: [layer_lambda],
        code: Code.fromAsset(lambda_transform_path),
        handler: 'index.handler',
        timeout: Duration.minutes(1),
        architecture: Architecture.ARM_64
    })
    
      
    // KINESIS FIREHOSE DELIVERY STREAM
    const kinesis_firehose = new CfnDeliveryStream( this, "GarnetFirehose", {
        deliveryStreamName: garnet_nomenclature.garnet_lake_iot_firehose_stream,
        deliveryStreamType: "DirectPut",
        extendedS3DestinationConfiguration: {
          bucketArn: bucket.bucketArn,
          roleArn: role_firehose.roleArn,
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 64,
          },
          processingConfiguration: {
            enabled: true,
            processors: [
              {
                type: "RecordDeAggregation",
                parameters: [
                  {
                    parameterName: "SubRecordType",
                    parameterValue: "JSON",
                  }
                ]
              },
                {
                    type: 'Lambda',
                    parameters: [{
                        parameterName: 'LambdaArn',
                        parameterValue: lambda_transform.functionArn
                    }]
                }
              // ,{
              //   type: "MetadataExtraction",
              //   parameters: [
              //     {
              //       parameterName: "MetadataExtractionQuery",
              //       parameterValue: "{type:.type}",
              //     },
              //     {
              //       parameterName: "JsonParsingEngine",
              //       parameterValue: "JQ-1.6",
              //     },
              //   ],
              // }
            ],
          },
          dynamicPartitioningConfiguration: {
            enabled: true,
          },
          prefix: `type=!{partitionKeyFromLambda:type}/dt=!{timestamp:yyyy}-!{timestamp:MM}-!{timestamp:dd}-!{timestamp:HH}/`,
          errorOutputPrefix: `type=!{firehose:error-output-type}/dt=!{timestamp:yyy}-!{timestamp:MM}-!{timestamp:dd}-!{timestamp:HH}/`,
        },
      }
    )

    lambda_transform.grantInvoke(role_firehose)

    // IOT RULE THAT LISTENS TO SUBSCRIPTIONS AND PUSH TO FIREHOSE
    const iot_rule_lake_name = garnet_nomenclature.garnet_lake_rule
    this.iot_rule_lake_name = iot_rule_lake_name

    const iot_rule_lake_role = new Role(this, "RoleGarnetLakeIotRuleIngestion", {
        assumedBy: new ServicePrincipal("iot.amazonaws.com"),
    })

    const iot_rule_lake_policy = new Policy(this, 'PolicyGarnetIotRuleIngestion', {
      statements: [
        new PolicyStatement({
          resources: [ `${kinesis_firehose.attrArn}` ],
          actions: [
            "firehose:DescribeDeliveryStream",
            "firehose:ListDeliveryStreams",
            "firehose:ListTagsForDeliveryStream",
            "firehose:PutRecord",
            "firehose:PutRecordBatch",
          ]
        })
      ]
    })

    iot_rule_lake_role.attachInlinePolicy(iot_rule_lake_policy)


    const iot_rule_sub = new CfnTopicRule(this, "IotRuleSub", {
        ruleName: iot_rule_lake_name, 
        topicRulePayload: {
        awsIotSqlVersion: "2016-03-23",
        ruleDisabled: false,
        sql: `SELECT VALUE data FROM 'garnetsubdatalake'`,
        actions: [
            {
            firehose: {
                deliveryStreamName: kinesis_firehose.ref,
                roleArn: iot_rule_lake_role.roleArn,
                separator: "\n",
                batchMode: true
            },
            },
        ],
        },
    })


    // SECURITY GROUP
    const sg_garnet_vpc_endpoint = new SecurityGroup(this, 'LakeSecurityGroup', {
        securityGroupName: `garnet-lake-endpoint-sg`,
        vpc: props.vpc,
        allowAllOutbound: true
    })
    
    sg_garnet_vpc_endpoint.addIngressRule(Peer.anyIpv4(), Port.tcp(443))

    // VPC ENDPOINT  
    const vpc_endpoint = new InterfaceVpcEndpoint(this, 'GarnetLakeIoTEndpoint', {
        vpc: props.vpc,
        subnets: {
          availabilityZones: [props.az1, props.az2]
        },
        service: {
        name: `com.amazonaws.${Aws.REGION}.iot.data`,
        port: 443
        },
        privateDnsEnabled: false,
        securityGroups: [sg_garnet_vpc_endpoint]
    })

    // LAMBDA FUNCTION FOR AUTHORIZER 
    const lambda_garnet_authorizer_log = new LogGroup(this, 'LambdaGarnetIotAuthorizerLogs', {
      retention: RetentionDays.ONE_MONTH,
      logGroupName: `garnet-iot-authorizer-lambda-logs`,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const lambda_garnet_authorizer_path = `${__dirname}/lambda/authorizer`
    const lambda_garnet_authorizer = new Function(this, 'LakeAuthorizerLambda', {
      functionName: garnet_nomenclature.garnet_iot_authorizer_lambda, 
      logGroup: lambda_garnet_authorizer_log,
      description: 'Garnet Lake - Function for the AWS IoT Authorizer',
          runtime: Runtime.NODEJS_20_X,
          code: Code.fromAsset(lambda_garnet_authorizer_path),
          handler: 'index.handler',
          timeout: Duration.seconds(50),
          architecture: Architecture.ARM_64,
          environment: {
              VPC_ENDPOINT: vpc_endpoint.vpcEndpointId,
              LAKERULENAME: iot_rule_lake_name,
          }
    })


    // AWS IoT AUTHORIZER

    const iot_authorizer = new CfnAuthorizer(this, 'IotAuthorizer', {
        authorizerFunctionArn: lambda_garnet_authorizer.functionArn, 
        authorizerName: `garnet-iot-authorizer`,
        status: "ACTIVE",
        signingDisabled: true,
        enableCachingForHttp: true
    })

    new CfnPermission(this, 'AuthorizerLambdaPermission', {
        principal: `iot.amazonaws.com`,
        action: 'lambda:InvokeFunction',
        functionName: lambda_garnet_authorizer.functionName,
        sourceArn: `${iot_authorizer.attrArn}`
    })

    const lambda_custom_iot_domain_log = new LogGroup(this, 'LambdaGarnetVersionLogs', {
      retention: RetentionDays.ONE_MONTH,
      logGroupName: `garnet-custom-iot-domain-lambda-logs`,
      removalPolicy: RemovalPolicy.DESTROY
    })
    const lambda_custom_iot_domain_path = `${__dirname}/lambda/domain`
    const lambda_custom_iot_domain = new Function(this, 'IoTCustomDomainLambda', {
        functionName: `garnet-custom-iot-domain-lambda`,
        description: 'Garnet Lake - Function that updates or creates the IoT custom domain for the IoT Rule Data Lake',
          runtime: Runtime.NODEJS_20_X,
          code: Code.fromAsset(lambda_custom_iot_domain_path),
          handler: 'index.handler',
          timeout: Duration.seconds(50),
          architecture: Architecture.ARM_64,
          logGroup: lambda_custom_iot_domain_log,
          environment: {
            DOMAIN_NAME: garnet_constant.iotDomainName,
            AUTHORIZER_NAME: Lazy.string( { produce(): string  { return iot_authorizer.authorizerName! } })
          }
    })

    lambda_custom_iot_domain.addToRolePolicy(new PolicyStatement({
      actions: [
        "iot:CreateDomainConfiguration",
        "iot:DescribeDomainConfiguration",
        "iot:UpdateDomainConfiguration"
      ],
      resources: ['*'] 
      }))
  
      const custom_iot_domain_provider_log = new LogGroup(this, 'CustomIotDomainProviderLogs', {
        retention: RetentionDays.ONE_MONTH,
        logGroupName: `garnet-provider-iot-domain-lambda-logs`,
        removalPolicy: RemovalPolicy.DESTROY
      })
      const custom_iot_domain_provider = new Provider(this, 'CustomIotDomainProvider', {
      onEventHandler: lambda_custom_iot_domain,
      providerFunctionName: `garnet-provider-iot-domain-lambda`,
      logGroup: custom_iot_domain_provider_log

    }) 
    
    const custom_iot_domain_resource = new CustomResource(this, 'CustomIotDomainResource', {
      serviceToken: custom_iot_domain_provider.serviceToken
    })

    this.iot_domain_name = custom_iot_domain_resource.getAtt('domainName').toString()

    custom_iot_domain_resource.node.addDependency(iot_authorizer)
    lambda_custom_iot_domain.node.addDependency(iot_authorizer)



    // ROUTE 53 HOSTED ZONE 
    const lake_hosted_zone = new PrivateHostedZone(this, 'LakeHostedZone', {
        zoneName: custom_iot_domain_resource.getAtt('domainName').toString(),
        vpc: props.vpc
    })

    lake_hosted_zone.node.addDependency(custom_iot_domain_resource)

    // ROUTE 53 RECORD 
    const lake_record = new ARecord(this, 'LakeARecord', {
        zone: lake_hosted_zone, 
        target: RecordTarget.fromAlias(new InterfaceVpcEndpointTarget(vpc_endpoint))
    })

    lake_record.node.addDependency(lake_hosted_zone)
  


    // LAMBDA THAT CREATE A SUBSCRIPTION IN THE BROKER TO SUBSCRIBE TO ALL ENTITIES
    const lambda_garnet_all_sub_log = new LogGroup(this, 'LambdaGarnetSubAllFunctionLogs', {
      retention: RetentionDays.ONE_MONTH,
      logGroupName: `garnet-sub-all-lambda-logs`,
      removalPolicy: RemovalPolicy.DESTROY
  })
    const lambda_garnet_all_sub_path = `${__dirname}/lambda/suball`
    const lambda_garnet_all_sub = new Function(this, 'GarnetSubAllFunction', {
    functionName: `garnet-sub-all-lambda`, 
        description: 'Garnet Lake - Function that subscribe to all types in the broker to feed the Garnet Lake',
        runtime: Runtime.NODEJS_20_X,
        logGroup: lambda_garnet_all_sub_log,
        code: Code.fromAsset(lambda_garnet_all_sub_path),
        handler: 'index.handler',
        timeout: Duration.seconds(50),
        layers: [layer_lambda],
        architecture: Architecture.ARM_64,
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
        environment: {
          DNS_CONTEXT_BROKER: props.dns_context_broker,
          LAKERULENAME: iot_rule_lake_name,
          URL_SMART_DATA_MODEL: Parameters.smart_data_model_url,
          IOTDOMAINNAME: custom_iot_domain_resource.getAtt('domainName').toString(),
          SUBNAME: garnet_constant.subAllName
        }
    })


    const bucket_provider_log = new LogGroup(this, 'CustomSubAllProviderLogs', {
      retention: RetentionDays.ONE_MONTH,
      logGroupName: `garnet-provider-sub-all-lambda-logs`,
      removalPolicy: RemovalPolicy.DESTROY
  })

    const bucket_provider = new Provider(this, 'CustomSubAllProvider', {
      onEventHandler: lambda_garnet_all_sub,
      providerFunctionName: `garnet-provider-sub-all-lambda`,
      logGroup: bucket_provider_log

    }) 

   new CustomResource(this, 'CustomSubAllResource', {
        serviceToken: bucket_provider.serviceToken
    })


          // CUSTOM RESOURCE WITH A LAMBDA THAT WILL CREATE ATHENA WORKGROUP AND GLUE DB
          const lambda_athena_log = new LogGroup(this, 'LambdaAthenaFunctionLogs', {
            retention: RetentionDays.ONE_MONTH,
            logGroupName: `garnet-lake-athena-lambda-logs`,
            removalPolicy: RemovalPolicy.DESTROY
          })
          const lambda_athena_path = `${__dirname}/lambda/athena`
          const lambda_athena = new Function(this, 'AthenaFunction', {
                functionName: `garnet-lake-athena-lambda`,
                description: 'Garnet Lake  - Function that creates Athena resources',
                logGroup: lambda_athena_log,
                runtime: Runtime.NODEJS_20_X,
                code: Code.fromAsset(lambda_athena_path),
                handler: 'index.handler',
                timeout: Duration.seconds(50),
                architecture: Architecture.ARM_64,
                environment: {
                  BUCKET_NAME: garnet_bucket,
                  CATALOG_ID: Aws.ACCOUNT_ID,
                  GLUEDB_NAME: garnet_constant.gluedbName
                }
          })
    
          lambda_athena.addToRolePolicy(new PolicyStatement({
              actions: [
                  "athena:CreateWorkGroup",
                  "glue:CreateDatabase"
              ],
              resources: ["*"] 
              }))
    
          const athena_provider_log = new LogGroup(this, 'LambdaAthenaProviderLogs', {
            retention: RetentionDays.ONE_MONTH,
            logGroupName: `garnet-provider-custom-athena-lambda-logs`,
            removalPolicy: RemovalPolicy.DESTROY
        })

          const athena_provider = new Provider(this, 'AthenaProvider', {
            onEventHandler: lambda_athena,
            providerFunctionName:  `garnet-provider-custom-athena-lambda`,
            logGroup: athena_provider_log
          }) 
    
         const athena_resource = new CustomResource(this, 'CustomBucketAthenaResource', {
              serviceToken: athena_provider.serviceToken,
              
          })


    }
  


}