import { Aws, CfnOutput, CustomResource, Duration, Names, Token } from "aws-cdk-lib"
import { Instance, InstanceClass, InstanceType, SecurityGroup, SubnetType, InstanceSize, Vpc, Port } from "aws-cdk-lib/aws-ec2"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { AuroraPostgresEngineVersion, CaCertificate, ClusterInstance, Credentials, DBClusterStorageType, DatabaseCluster, DatabaseClusterEngine, DatabaseInstance, DatabaseInstanceEngine, DatabaseProxy, ParameterGroup, PostgresEngineVersion, ProxyTarget, StorageType } from "aws-cdk-lib/aws-rds"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"

import { Construct } from "constructs"
import { Parameters } from "../../../../parameters"
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"

export interface GarnetScorpioDatabaseProps {
    vpc: Vpc
    secret_arn: string
    rds_parameter_group_name: string
}

export class GarnetScorpioDatabase extends Construct{

    public readonly database_endpoint: string
    public readonly database_port: string
    public readonly sg_proxy: SecurityGroup

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
            securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-database-sg`
        })


        // RDS Parameter Group 

        const rds_pm_group = ParameterGroup.fromParameterGroupName(this, 'RdsPmGroup', props.rds_parameter_group_name)

        // RDS Instance
        // const database = new DatabaseInstance(this, 'DatabaseInstance', {
        //     credentials: Credentials.fromSecret(secret),
        //     engine: DatabaseInstanceEngine.postgres({version: PostgresEngineVersion.VER_16_1}),
        //     parameterGroup: rds_pm_group,
        //     multiAz: true, 
        //     caCertificate: CaCertificate.RDS_CA_RDS4096_G1,
        //     cloudwatchLogsRetention: RetentionDays.THREE_MONTHS, 
        //     instanceType: Parameters.garnet_scorpio.rds_instance_type,
        //     storageType: Parameters.garnet_scorpio.rds_storage_type,
        //     vpc: props.vpc, 
        //     securityGroups: [sg_database],
        //     databaseName: Parameters.garnet_scorpio.dbname,
        //     vpcSubnets:{
        //         subnetType: SubnetType.PRIVATE_ISOLATED
        //     }
        // })



        //Serverless Cluster
        const cluster = new DatabaseCluster(this, 'DatabaseAurora', {
            engine: DatabaseClusterEngine.auroraPostgres({
                version: AuroraPostgresEngineVersion.VER_15_4
            }),
            clusterIdentifier: `garnet-serverless-aurora-cluster`, 
            credentials: Credentials.fromSecret(secret), 
            vpc: props.vpc, 
            securityGroups: [sg_database],
            defaultDatabaseName: Parameters.garnet_scorpio.dbname,
            vpcSubnets:{
                subnetType: SubnetType.PRIVATE_ISOLATED
            },
            writer: ClusterInstance.serverlessV2('writer'), 
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 20,
            storageType: DBClusterStorageType.AURORA_IOPT1

        })




        // ROLE FOR PROXY
        const role_proxy = new Role(this, 'RoleRdsProxy', {
            roleName: `garnet-rds-proxy-role-${Aws.REGION}`,
            assumedBy: new ServicePrincipal("rds.amazonaws.com")
        })
        secret.grantRead(role_proxy)

        // SECURITY GROUP FOR PROXY 
        const sg_proxy = new SecurityGroup(this, 'SecurityGroupProxyDatabase', {
            vpc: props.vpc,
            securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-rds-proxy-sg`,
            allowAllOutbound: true
        })

        sg_database.addIngressRule(sg_proxy, Port.tcp(5432))
        this.sg_proxy = sg_proxy
        // Proxy
        // const rds_proxy = new DatabaseProxy(this, 'RdsProxy', {
        //     dbProxyName: `garnet-proxy-rds`,
        //     proxyTarget: ProxyTarget.fromInstance(database),
        //     secrets: [secret],
        //     vpc: props.vpc, 
        //     idleClientTimeout: Duration.minutes(5), 
        //     requireTLS: false,
        //     role: role_proxy,
        //     securityGroups: [sg_proxy]
        // })
        const rds_proxy = new DatabaseProxy(this, 'RdsProxy', {
            dbProxyName: `garnet-proxy-rds`,
            proxyTarget: ProxyTarget.fromCluster(cluster),
            secrets: [secret],
            vpc: props.vpc, 
            idleClientTimeout: Duration.minutes(5), 
            requireTLS: false,
            role: role_proxy,
            securityGroups: [sg_proxy]
        })

        this.database_endpoint = rds_proxy.endpoint
       // this.database_port = `${Token.asString(database.dbInstanceEndpointPort)}`
        this.database_port = `${Token.asString(cluster.clusterEndpoint.port)}`

        new CfnOutput(this, 'database_proxy_endpoint', {
           value: this.database_endpoint
    
        })
        new CfnOutput(this, 'database_port', {
            //value: `${Token.asString(database.dbInstanceEndpointPort)}`
            value: this.database_port
        })
       


    }
}