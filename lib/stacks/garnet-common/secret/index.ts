import { NestedStack, NestedStackProps } from "aws-cdk-lib"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_broker, garnet_nomenclature } from "../../../../constants"


export interface GarnetSecretProps {
}

export class GarnetSecret extends Construct {
    public readonly secret: Secret
    public readonly secret_api_jwt : Secret

    constructor(scope: Construct, id: string, props: GarnetSecretProps) {
        super(scope, id)
    
        this.secret = new Secret(this, 'Secret', {
            secretName: garnet_nomenclature.garnet_secret,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                  username: 'garnetadmin',
                }),
                excludePunctuation: true,
                excludeCharacters: "/¥'%:;{}",
                includeSpace: false,
                generateStringKey: 'password'
              }
        })
        
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