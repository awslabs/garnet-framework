import { CfnOutput, Names, Token } from "aws-cdk-lib"
import { Instance, InstanceClass, InstanceType, SecurityGroup, SubnetType, InstanceSize, Vpc } from "aws-cdk-lib/aws-ec2"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { Credentials, DatabaseCluster, DatabaseClusterEngine, DatabaseInstance, DatabaseInstanceEngine, ParameterGroup, PostgresEngineVersion, ServerlessCluster, StorageType } from "aws-cdk-lib/aws-rds"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"

import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"

export interface GarnetScorpioDatabaseProps {
    vpc: Vpc
    secret_arn: string
}

export class GarnetScorpioDatabase extends Construct{

    public readonly database_endpoint: string
    public readonly database_port: string
    public readonly sg_database: SecurityGroup

    constructor(scope: Construct, id: string, props: GarnetScorpioDatabaseProps) {
        super(scope, id)

        // Check props
        if (!props.vpc){
            throw new Error('The property vpc is required to create an instance of ScorpioDatabase Construct')
        }
        if (!props.secret_arn){
            throw new Error('The property secret_arn is required to create an instance of ScorpioDatabase Construct')
        }
        
        const secret = Secret.fromSecretCompleteArn(this, 'Secret', props.secret_arn)
        const sg_database = new SecurityGroup(this, 'SecurityGroupDatabase', {
            vpc: props.vpc,
            securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-database-sg-${Names.uniqueId(this).slice(-4).toLowerCase()}`
        })
        this.sg_database = sg_database

        // RDS Instance
        const database = new DatabaseInstance(this, 'DatabaseInstance', {
            credentials: Credentials.fromSecret(secret),
            engine: DatabaseInstanceEngine.postgres({version: PostgresEngineVersion.VER_14_4}),
            multiAz: true, 
            cloudwatchLogsRetention: RetentionDays.THREE_MONTHS, 
            instanceType: Parameters.garnet_scorpio.rds_instance_type,
            storageType: Parameters.garnet_scorpio.rds_storage_type,
            vpc: props.vpc, 
            securityGroups: [sg_database],
            databaseName: Parameters.garnet_scorpio.dbname,
            vpcSubnets:{
                subnetType: SubnetType.PRIVATE_ISOLATED
            }
        })

        this.database_endpoint = database.dbInstanceEndpointAddress
        this.database_port = `${Token.asString(database.dbInstanceEndpointPort)}`

        new CfnOutput(this, 'database_endpoint', {
            value: database.dbInstanceEndpointAddress
        })
        new CfnOutput(this, 'database_port', {
            value: `${Token.asString(database.dbInstanceEndpointPort)}`
        })
       


    }
}