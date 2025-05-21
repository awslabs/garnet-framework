import { CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib"
import { Code, LayerVersion, Runtime, Function, Architecture } from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_nomenclature } from "../../../../constants"
import { Provider } from "aws-cdk-lib/custom-resources"
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam"

export interface GarnetApiAuthJwtProps {
    secret_api_jwt: Secret
}

export class GarnetApiAuthJwt extends Construct {
    public readonly garnet_api_token: string
    public readonly lambda_authorizer_arn: string
    constructor(scope: Construct, id: string, props: GarnetApiAuthJwtProps){
        super(scope, id)





        // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_22_X],
        })


        // Logs for the lambda that generates the JWT
        const api_auth_jwt_generator_logs = new LogGroup(this, 'ApiAuthJwtGeneratorLogs', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const api_auth_jwt_generator_lambda_path = `${__dirname}/lambda/apiAuthJwt`
        const api_auth_jwt_generator_lambda = new Function(this, 'ApiAuthJwtGeneratorLambda', {
            functionName: garnet_nomenclature.garnet_api_auth_jwt_lambda,
            description: 'Garnet API - Function that generates a JWT token',
            runtime: Runtime.NODEJS_22_X,
            logGroup: api_auth_jwt_generator_logs,
            layers: [layer_lambda], 
            code: Code.fromAsset(api_auth_jwt_generator_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
                SECRET_ARN: props.secret_api_jwt.secretArn,
                JWT_SUB: garnet_nomenclature.garnet_api_auth_sub, 
                JWT_ISS: garnet_nomenclature.garnet_api_auth_issuer,
                JWT_AUD: garnet_nomenclature.garnet_api_auth_audience
            }
        })

        api_auth_jwt_generator_lambda.node.addDependency(api_auth_jwt_generator_logs)

        props.secret_api_jwt.grantRead(api_auth_jwt_generator_lambda)

        const api_auth_jwt_generator_provider_logs = new LogGroup(this, 'LambdaJwtAuthProviderLogs', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const api_auth_jwt_generator_provider = new Provider(this, 'LambdaJwtAuthProvider', {
        onEventHandler: api_auth_jwt_generator_lambda,
        logGroup: api_auth_jwt_generator_provider_logs
        }) 
        api_auth_jwt_generator_provider.node.addDependency(api_auth_jwt_generator_provider_logs)

        const api_auth_jwt_generator_resource = new CustomResource(this, 'ApiAuthJwtResource', {
        serviceToken: api_auth_jwt_generator_provider.serviceToken
        })
        
        this.garnet_api_token = api_auth_jwt_generator_resource.getAttString('token')


        // Logs for the lambda authorizer
        const api_authorizer_logs = new LogGroup(this, 'ApiAuthorizerLogs', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const api_authorizer_lambda_path = `${__dirname}/lambda/apiAuthorizer`
        const api_authorizer_lambda = new Function(this, 'ApiAuthorizerLambda', {
            functionName: garnet_nomenclature.garnet_api_authorizer_lambda,
            description: 'Garnet API - Lambda Authorizer for the Garnet API',
            runtime: Runtime.NODEJS_22_X,
            logGroup: api_authorizer_logs,
            layers: [layer_lambda], 
            code: Code.fromAsset(api_authorizer_lambda_path),
            handler: 'index.handler',
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            environment: {
                SECRET_ARN: props.secret_api_jwt.secretArn,
                JWT_SUB: garnet_nomenclature.garnet_api_auth_sub, 
                JWT_ISS: garnet_nomenclature.garnet_api_auth_issuer,
                JWT_AUD: garnet_nomenclature.garnet_api_auth_audience
            }
        })

        api_authorizer_lambda.node.addDependency(api_authorizer_logs)

        props.secret_api_jwt.grantRead(api_authorizer_lambda)
        api_authorizer_lambda.grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'))
        
        this.lambda_authorizer_arn = api_authorizer_lambda.functionArn
    }
}