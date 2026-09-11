import { Duration, RemovalPolicy } from "aws-cdk-lib"
import { Code, LayerVersion, Runtime, Function, Architecture } from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_nomenclature } from "../../../../constants"
import { Parameters } from "../../../../configuration"
import {
    provision_bootstrap_token
} from "./bootstrap-token"

const bootstrap_token_max_age = Duration.days(31)

export interface GarnetApiAuthJwtProps {
    secret_api_jwt: Secret
}

export class GarnetApiAuthJwt extends Construct {
    public readonly garnet_api_token_secret: ISecret
    public readonly lambda_authorizer_arn: string
    constructor(scope: Construct, id: string, props: GarnetApiAuthJwtProps){
        super(scope, id)

        const bootstrap_tenant =
            Parameters.garnet_bootstrap_tenant.trim()
        if (
            bootstrap_tenant === "" ||
            /[\0\r\n]/.test(bootstrap_tenant)
        ) {
            throw new Error(
                "garnet_bootstrap_tenant must be a non-empty HTTP header value"
            )
        }
        // LAMBDA LAYER (SHARED LIBRARIES)
        const layer_lambda_path = `./lib/layers`;
        const layer_lambda = new LayerVersion(this, "LayerLambda", {
          code: Code.fromAsset(layer_lambda_path),
          compatibleRuntimes: [Runtime.NODEJS_24_X],
        })


        const api_token_secret = provision_bootstrap_token(this, {
            layer: layer_lambda,
            signing_secret: props.secret_api_jwt,
            tenant: bootstrap_tenant
        })

        this.garnet_api_token_secret = api_token_secret


        // Logs for the lambda authorizer
        const api_authorizer_logs = new LogGroup(this, 'ApiAuthorizerLogs', {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        })

        const api_authorizer_lambda_path = `${__dirname}/lambda/apiAuthorizer`
        const api_authorizer_lambda = new Function(this, 'ApiAuthorizerLambda', {
            functionName: garnet_nomenclature.garnet_api_authorizer_lambda,
            description: 'Garnet API - Lambda Authorizer for the Garnet API',
            runtime: Runtime.NODEJS_24_X,
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
                JWT_AUD: garnet_nomenclature.garnet_api_auth_audience,
                JWT_MAX_AGE_SECONDS:
                    bootstrap_token_max_age.toSeconds().toString()
            }
        })

        api_authorizer_lambda.node.addDependency(api_authorizer_logs)

        props.secret_api_jwt.grantRead(api_authorizer_lambda)
        
        this.lambda_authorizer_arn = api_authorizer_lambda.functionArn
    }
}
