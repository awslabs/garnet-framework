import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { App } from "aws-cdk-lib"

const CONFIG_PATH = require.resolve("../configuration")

const templateFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return templateFiles(path)
    return entry.name.endsWith(".template.json") ? [path] : []
  })

const synth = (connector_enabled: boolean): string => {
  jest.resetModules()
  const actual = jest.requireActual<any>("../configuration")
  jest.doMock(CONFIG_PATH, () => ({
    Parameters: {
      ...actual.Parameters,
      garnet_broker_image:
        `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
      garnet_load_image: "",
      garnet_broker_public_origin: "https://broker.example",
      aws_iot_core_mqtt_connector_enabled: connector_enabled
    }
  }))
  const {
    GarnetFrameworkStack
  } = require("../lib/garnet-framework-stack")
  const app = new App()
  new GarnetFrameworkStack(app, "GarnetFramework", {
    env: {
      account: "111111111111",
      region: "us-east-1"
    }
  })
  const assembly = app.synth()
  return templateFiles(assembly.directory)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
}

describe("built-in connector boundary", () => {
  afterEach(() => {
    jest.dontMock(CONFIG_PATH)
    jest.resetModules()
  })

  it("keeps all AWS IoT behavior out of the default core stack", () => {
    const templates = synth(false)

    expect(templates).not.toContain("AWS::IoT::")
    expect(templates).not.toContain("iot:Publish")
    expect(templates).not.toContain("AwsIotCoreMqttConnector")
    expect(templates).not.toContain("AwsIotThing")
    expect(templates).not.toContain("iot-presence")
    expect(templates).not.toContain("iot-group")
  })

  it("adds only the one-way MQTT notification connector when enabled", () => {
    const templates = synth(true)

    expect(templates).toContain("AwsIotCoreMqttConnector")
    expect(templates).toContain("iot:Publish")
    expect(templates).toContain("AWS::ApiGateway::ApiKey")
    expect(templates).not.toContain("AWS::IoT::TopicRule")
    expect(templates).not.toContain("AwsIotThing")
    expect(templates).not.toContain("iot-presence")
    expect(templates).not.toContain("iot-group")
  })
})
