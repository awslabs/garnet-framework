import {
    ManagedPolicy,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"
import {
    garnet_sigv4_server_id,
    garnet_sts_endpoint
} from "../../../../constants"

export const create_broker_workload_role = (
    scope: Construct,
    id: string,
    role_name: string
): Role => new Role(scope, id, {
    roleName: role_name,
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole"
        ),
        ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaVPCAccessExecutionRole"
        )
    ]
})

export const broker_workload_environment = (
    tenant: string
): Record<string, string> => ({
    GARNET_SIGV4_SERVER_ID: garnet_sigv4_server_id,
    GARNET_STS_ENDPOINT: garnet_sts_endpoint,
    GARNET_TENANT: tenant
})
