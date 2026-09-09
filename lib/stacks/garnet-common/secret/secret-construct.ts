import { NestedStack, NestedStackProps } from "aws-cdk-lib"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_nomenclature } from "../../../../constants"


export interface GarnetSecretProps {
}

export class GarnetSecret extends Construct {
    public readonly secret_api_jwt : Secret

    constructor(scope: Construct, id: string, props: GarnetSecretProps) {
        super(scope, id)
    
        this.secret_api_jwt = new Secret(this, 'SecretApiJwt', {
            secretName: garnet_nomenclature.garnet_api_jwt_secret,
            generateSecretString: {
                excludePunctuation: true,
                excludeCharacters: "/¥'%:;{}",
                includeSpace: false,
              }
        })
    
    }

}
