import {
    CfnTaskDefinition,
    TaskDefinition
} from "aws-cdk-lib/aws-ecs"

export const pin_arm64_runtime = (
    task_definition: TaskDefinition
): void => {
    const resource =
        task_definition.node.defaultChild as CfnTaskDefinition
    resource.addPropertyOverride("RuntimePlatform", {
        CpuArchitecture: "ARM64",
        OperatingSystemFamily: "LINUX"
    })
}
