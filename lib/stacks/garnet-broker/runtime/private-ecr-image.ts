import { Arn } from "aws-cdk-lib"
import { ContainerImage } from "aws-cdk-lib/aws-ecs"
import { Repository } from "aws-cdk-lib/aws-ecr"
import { Construct } from "constructs"

export const private_ecr_image = (
    scope: Construct,
    id: string,
    reference: string
): ContainerImage | undefined => {
    const match = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.(?:amazonaws\.com(?:\.cn)?)\/([^@]+)@sha256:([0-9a-f]{64})$/
        .exec(reference)
    if (match === null) return undefined

    const [, account, region, repository_name, digest] = match
    const partition = region!.startsWith("cn-")
        ? "aws-cn"
        : region!.startsWith("us-gov-")
            ? "aws-us-gov"
            : region!.startsWith("us-iso-")
                ? "aws-iso"
                : region!.startsWith("us-isob-")
                    ? "aws-iso-b"
                    : "aws"
    const repository = Repository.fromRepositoryAttributes(
        scope,
        id,
        {
            repositoryName: repository_name!,
            repositoryArn: Arn.format({
                partition,
                service: "ecr",
                region,
                account,
                resource: "repository",
                resourceName: repository_name
            })
        }
    )
    return ContainerImage.fromEcrRepository(
        repository,
        `sha256:${digest}`
    )
}
