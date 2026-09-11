import { CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib"
import {
    Alarm,
    ComparisonOperator,
    Metric,
    TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch"
import { Provider } from "aws-cdk-lib/custom-resources"
import { Rule, Schedule } from "aws-cdk-lib/aws-events"
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets"
import {
    Architecture,
    Code,
    Function,
    ILayerVersion,
    Runtime
} from "aws-cdk-lib/aws-lambda"
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs"
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs"
import { Construct } from "constructs"
import {
    garnet_nomenclature,
    garnet_resource_name
} from "../../../../constants"

const token_ttl = Duration.days(30)

export interface BootstrapTokenProps {
    layer: ILayerVersion
    signing_secret: ISecret
    tenant: string
}

export const provision_bootstrap_token = (
    scope: Construct,
    props: BootstrapTokenProps
): ISecret => {
    const generator_logs = new LogGroup(
        scope,
        "ApiAuthJwtGeneratorLogs",
        {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        }
    )
    const refresh_dlq = new Queue(
        scope,
        "ApiTokenRefreshDeadLetterQueue",
        {
            queueName:
                garnet_resource_name("api-token-refresh-dlq"),
            encryption: QueueEncryption.SQS_MANAGED,
            enforceSSL: true,
            retentionPeriod: Duration.days(14),
            removalPolicy: RemovalPolicy.DESTROY
        }
    )
    const token_secret = new Secret(scope, "ApiClientToken", {
        secretName: garnet_nomenclature.garnet_api_client_secret,
        description:
            "Rotating Authorization header used by trusted Garnet API clients",
        generateSecretString: {
            excludePunctuation: true
        }
    })
    const generator = new Function(
        scope,
        "ApiAuthJwtGeneratorLambda",
        {
            functionName:
                garnet_nomenclature.garnet_api_auth_jwt_lambda,
            description:
                "Garnet API - Function that generates a JWT token",
            runtime: Runtime.NODEJS_24_X,
            logGroup: generator_logs,
            layers: [props.layer],
            code: Code.fromAsset(`${__dirname}/lambda/apiAuthJwt`),
            handler: "index.handler",
            timeout: Duration.seconds(50),
            architecture: Architecture.ARM_64,
            deadLetterQueue: refresh_dlq,
            maxEventAge: Duration.hours(6),
            retryAttempts: 2,
            environment: {
                SECRET_ARN: props.signing_secret.secretArn,
                TOKEN_SECRET_ARN: token_secret.secretArn,
                JWT_SUB: garnet_nomenclature.garnet_api_auth_sub,
                JWT_ISS: garnet_nomenclature.garnet_api_auth_issuer,
                JWT_AUD: garnet_nomenclature.garnet_api_auth_audience,
                JWT_TENANT: props.tenant,
                JWT_TTL_SECONDS: token_ttl.toSeconds().toString()
            }
        }
    )
    generator.node.addDependency(generator_logs)
    props.signing_secret.grantRead(generator)
    token_secret.grantWrite(generator)

    const refresh_rule = new Rule(
        scope,
        "ApiTokenRefreshSchedule",
        {
            schedule: Schedule.rate(Duration.days(1))
        }
    )
    refresh_rule.addTarget(new LambdaFunction(generator, {
        deadLetterQueue: refresh_dlq,
        maxEventAge: Duration.hours(24),
        retryAttempts: 185
    }))

    const alarm = (
        id: string,
        name: string,
        description: string,
        metric: Metric
    ): void => {
        new Alarm(scope, id, {
            alarmName: garnet_resource_name(name),
            alarmDescription: description,
            metric,
            threshold: 0,
            comparisonOperator:
                ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: TreatMissingData.NOT_BREACHING
        })
    }
    alarm(
        "ApiTokenRefreshErrorAlarm",
        "api-token-refresh-errors",
        "The rotating bootstrap API credential failed to refresh",
        generator.metricErrors({
            period: Duration.minutes(5),
            statistic: "Sum"
        })
    )
    alarm(
        "ApiTokenRefreshDeliveryAlarm",
        "api-token-refresh-delivery",
        "EventBridge could not deliver a bootstrap token refresh",
        new Metric({
            namespace: "AWS/Events",
            metricName: "FailedInvocations",
            dimensionsMap: {
                RuleName: refresh_rule.ruleName
            },
            period: Duration.minutes(5),
            statistic: "Sum"
        })
    )
    alarm(
        "ApiTokenRefreshDeadLetterAlarm",
        "api-token-refresh-dead-letter",
        "A bootstrap token refresh requires operator recovery",
        refresh_dlq.metricApproximateNumberOfMessagesVisible({
            period: Duration.minutes(5),
            statistic: "Maximum"
        })
    )

    const provider_logs = new LogGroup(
        scope,
        "LambdaJwtAuthProviderLogs",
        {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY
        }
    )
    const provider = new Provider(scope, "LambdaAuthJwtProvider", {
        onEventHandler: generator,
        logGroup: provider_logs
    })
    provider.node.addDependency(provider_logs)

    new CustomResource(scope, "ApiJwtAuthResource", {
        serviceToken: provider.serviceToken,
        properties: {
            TokenSecretArn: token_secret.secretArn,
            Tenant: props.tenant,
            TokenSchemaVersion: "tenant-v2-expiring"
        }
    })

    return token_secret
}
