import { Aws, Duration, Names, RemovalPolicy } from "aws-cdk-lib"

import { CfnIntegration, CfnRoute, CfnVpcLink } from "aws-cdk-lib/aws-apigatewayv2"
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import { Runtime, Function, Code, CfnPermission, LayerVersion, Architecture } from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Construct } from "constructs"
import { garnet_broker, garnet_constant } from "../../../../constants"
import { deployment_params } from "../../../../sizing"


export interface GarnetIotApiProps {
    readonly api_ref: string,
    readonly vpc: Vpc,
    dns_context_broker: string,
    garnet_iot_sqs_url: string, 
    garnet_iot_sqs_arn: string, 
    garnet_private_endpoint: string
}

export class GarnetIotApi extends Construct {
   
    constructor(scope: Construct, id: string, props: GarnetIotApiProps){
        super(scope, id)
        
        // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`
        const layer_lambda = new LayerVersion(this, 'LayerLambda', {
            code: Code.fromAsset(layer_lambda_path),
            compatibleRuntimes: [Runtime.NODEJS_20_X]
        })


// ********************************************** 

        /**
         *  GARNET VERSION 
         */

        // LAMBDA GARNET API VERSION
        const lambda_garnet_version_path = `${__dirname}/lambda/garnetVersion`
        const lambda_garnet_version = new Function(this, 'LambdaGarnetVersion', {
            functionName: `garnet-api-version-lambda`,
            vpc: props.vpc, 
            description: 'Garnet API - Function that returns the Garnet Version',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_garnet_version_path),
            handler: 'index.handler',
            timeout: Duration.seconds(30),
            logGroup: new LogGroup(this, 'LambdaGarnetVersionLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-api-version-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                    CONTEXT_BROKER: garnet_broker,
                    GARNET_VERSION: garnet_constant.garnet_version, 
                    GARNET_PRIVATE_ENDPOINT: props.garnet_private_endpoint, 
                    GARNET_IOT_SQS_URL: props.garnet_iot_sqs_url, 
                    GARNET_IOT_SQS_ARN: props.garnet_iot_sqs_arn,
                    DNS_CONTEXT_BROKER: props.dns_context_broker,
                    GARNET_ARCHITECTURE: deployment_params.architecture
            }   
        })

        const garnet_version_integration = new CfnIntegration(this, 'GarnetVersionIntegration', {
            apiId: props.api_ref,
            integrationMethod: "GET",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_garnet_version.functionArn,
            connectionType: "INTERNET",
            description: "GARNET VERSION INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const garnet_version_route = new CfnRoute(this, 'GarnetVersionRoute', {
            apiId: props.api_ref,
            routeKey: "GET /",
            target: `integrations/${garnet_version_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionGarnetVersion', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_garnet_version.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END GARNET VERSION
        */


// ********************************************** 



// ********************************************** 

        /**
         *  POST THING
         */

        // LAMBDA THAT POSTS THING
        const lambda_post_thing_path = `${__dirname}/lambda/postThing`
        const lambda_post_thing = new Function(this, 'LambdaPostThing', {
            functionName: `garnet-iot-api-post-thing-lambda`,
            description: 'Garnet API - Function to POST THING',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_post_thing_path),
            handler: 'index.handler',
            timeout: Duration.seconds(30),
            logGroup: new LogGroup(this, 'LambdaPostThingLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-iot-api-post-thing-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                AWSIOTREGION: Aws.REGION,
                SHADOW_PREFIX: garnet_constant.shadow_prefix,
                }   
        })

        lambda_post_thing.addToRolePolicy(new PolicyStatement({
            actions: [
                "iot:UpdateThingGroup",
                "iot:CreateThingGroup",
                "iot:CreateThing",
                "iot:AddThingToThingGroup",
                "iot:UpdateThingGroupsForThing",
                "iot:UpdateThingShadow"
            ],
            resources: [
                `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thinggroup/*`,
                `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*`
            ]
        }))

        const post_thing_integration = new CfnIntegration(this, 'postThingIntegration', {
            apiId: props.api_ref,
            integrationMethod: "POST",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_post_thing.functionArn,
            connectionType: "INTERNET",
            description: "POST THING INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const post_thing_route = new CfnRoute(this, 'PostThingRoute', {
            apiId: props.api_ref,
            routeKey: "POST /iot/things",
            target: `integrations/${post_thing_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionPostThing', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_post_thing.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END POST THING 
        */


// ********************************************** 

        /**
        *  DELETE THING 
        */

        // LAMBDA THAT DELETE THING
        const lambda_delete_thing_path = `${__dirname}/lambda/deleteThing`
        const lambda_delete_thing = new Function(this, 'LambdaDeleteThing', {
            functionName: `garnet-iot-api-delete-thing-lambda`,
            description: 'Garnet API - Function to DELETE THING',
            vpc: props.vpc, 
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS
            },
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_delete_thing_path),
            handler: 'index.handler',
            timeout: Duration.seconds(30),
            logGroup: new LogGroup(this, 'LambdaDeleteThingLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-iot-api-delete-thing-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                AWSIOTREGION: Aws.REGION,
                SHADOW_PREFIX: garnet_constant.shadow_prefix,
                DNS_CONTEXT_BROKER: props.dns_context_broker
            }   
        })

        lambda_delete_thing.addToRolePolicy(new PolicyStatement({
            actions: [
                "iot:DeleteThing",
                "iot:DeleteThingShadow",
                "iot:ListNamedShadowsForThing",

            ],
            resources: [
                `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*`
            ]
        }))

        const delete_thing_integration = new CfnIntegration(this, 'deleteThingIntegration', {
            apiId: props.api_ref,
            integrationMethod: "DELETE",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_delete_thing.functionArn,
            connectionType: "INTERNET",
            description: "DELETE THING INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const delete_thing_route = new CfnRoute(this, 'DeleteThingRoute', {
            apiId: props.api_ref,
            routeKey: "DELETE /iot/things/{thingName}",
            target: `integrations/${delete_thing_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionDeleteThing', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_delete_thing.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

    /***
     * END DELETE THING 
     */

/************************************************************************** */


        /**
         *  GET THING
         */

        // LAMBDA THAT GETS THING
        const lambda_get_thing_path = `${__dirname}/lambda/getThing`
        const lambda_get_thing = new Function(this, 'LambdaGetThing', {
            functionName: `garnet-iot-api-get-thing-lambda`,
            description: 'Garnet API - Function to GET THING',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_get_thing_path),
            handler: 'index.handler',
            timeout: Duration.seconds(30),
            logGroup: new LogGroup(this, 'LambdaGetThingLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-iot-api-get-thing-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                AWSIOTREGION: Aws.REGION,
                SHADOW_PREFIX: garnet_constant.shadow_prefix,
                }   
        })

        lambda_get_thing.addToRolePolicy(new PolicyStatement({
            actions: [
                "iot:GetThing",
                "iot:ListThings",
                "iot:ListNamedShadowsForThing",
                "iot:getThingShadow"
            ],
            resources: [
                `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*`
            ]
        }))

        const get_thing_integration = new CfnIntegration(this, 'getThingIntegration', {
            apiId: props.api_ref,
            integrationMethod: "GET",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_get_thing.functionArn,
            connectionType: "INTERNET",
            description: "GET THING INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const get_thing_route = new CfnRoute(this, 'GetThingRoute', {
            apiId: props.api_ref,
            routeKey: "GET /iot/things/{thingName}",
            target: `integrations/${get_thing_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionGetThing', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_get_thing.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END GET THING 
        */

        /************************************************************************** */


        /**
         *  GET THINGS
         */

        // LAMBDA THAT GETS THING
        const lambda_get_things_path = `${__dirname}/lambda/getThings`
        const lambda_get_things = new Function(this, 'LambdaGetThings', {
            functionName: `garnet-iot-api-get-things-lambda`,
            description: 'Garnet API - Function to GET THINGS',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_get_things_path),
            handler: 'index.handler',
            timeout: Duration.minutes(3),
            logGroup: new LogGroup(this, 'LambdaGetThingsLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-iot-api-get-things-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                AWSIOTREGION: Aws.REGION,
                SHADOW_PREFIX: garnet_constant.shadow_prefix,
                }   
        })

        lambda_get_things.addToRolePolicy(new PolicyStatement({
            actions: [
                "iot:ListThings"
            ],
            resources: [
                `*`
            ]
        }))

        const get_things_integration = new CfnIntegration(this, 'getThingsIntegration', {
            apiId: props.api_ref,
            integrationMethod: "GET",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_get_things.functionArn,
            connectionType: "INTERNET",
            description: "GET THINGS INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const get_things_route = new CfnRoute(this, 'GetThingsRoute', {
            apiId: props.api_ref,
            routeKey: "GET /iot/things",
            target: `integrations/${get_things_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionGetThings', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_get_things.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END GET THINGS
        */



        /************************************************************************** */


        /**
         *  POST SHADOWS
         */

        // LAMBDA THAT POST SHADOWS
        const lambda_post_shadows_path = `${__dirname}/lambda/postShadows`
        const lambda_post_shadows = new Function(this, 'LambdaPostShadows', {
            functionName: `garnet-iot-api-post-shadows-lambda`,
            description: 'Garnet API - Function to POST SHADOW',
            runtime: Runtime.NODEJS_20_X,
            code: Code.fromAsset(lambda_post_shadows_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            logGroup: new LogGroup(this, 'LambdaPostShadowsLogs', {
                retention: RetentionDays.ONE_MONTH,
                logGroupName: `garnet-iot-api-post-shadows-lambda-logs`,
                removalPolicy: RemovalPolicy.DESTROY
            }),
            layers: [layer_lambda],
            architecture: Architecture.ARM_64,
            environment: {
                AWSIOTREGION: Aws.REGION,
                SHADOW_PREFIX: garnet_constant.shadow_prefix,
                }   
        })

        lambda_post_shadows.addToRolePolicy(new PolicyStatement({
            actions: [
                "iot:UpdateThingShadow"
            ],
            resources: [
                `arn:aws:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:thing/*`
            ]
        }))

        const post_shadows_integration = new CfnIntegration(this, 'postShadowsIntegration', {
            apiId: props.api_ref,
            integrationMethod: "POST",
            integrationType: "AWS_PROXY",
            integrationUri: lambda_post_shadows.functionArn,
            connectionType: "INTERNET",
            description: "GET THING INTEGRATION",
            payloadFormatVersion: "1.0",
        })

        const post_shadows_route = new CfnRoute(this, 'PostShadowsRoute', {
            apiId: props.api_ref,
            routeKey: "POST /iot/things/{thingName}/shadows",
            target: `integrations/${post_shadows_integration.ref}`
        })

        new CfnPermission(this, 'ApiGatewayLambdaPermissionPostShadows', {
            principal: `apigateway.amazonaws.com`,
            action: 'lambda:InvokeFunction',
            functionName: lambda_post_shadows.functionName,
            sourceArn: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${props.api_ref}/*/*/*`
        })

        /**
        *  END POST SHADOWS
        */







    }
}