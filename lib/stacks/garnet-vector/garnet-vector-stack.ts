import { NestedStack, NestedStackProps, Stack } from "aws-cdk-lib"

export interface GarnetVectorStackProps extends NestedStackProps {
}

export class GarnetVectorStack extends NestedStack {

  constructor(scope: Stack, id: string, props: GarnetVectorStackProps) {
    super(scope, id, props)
  }
}