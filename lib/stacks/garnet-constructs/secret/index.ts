import { NestedStack, NestedStackProps } from "aws-cdk-lib"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"
import { Construct } from "constructs"
import { garnet_broker } from "../../../../constants"


export interface GarnetSecretProps {
}

export class GarnetSecret extends Construct {
    public readonly secret: Secret

    constructor(scope: Construct, id: string, props: GarnetSecretProps) {
        super(scope, id)
    
        this.secret = new Secret(this, 'Secret', {
            secretName:`garnet/secret/${garnet_broker.toLowerCase()}`,
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
    
    }

}