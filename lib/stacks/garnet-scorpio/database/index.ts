import { Aws, CfnOutput, Duration, Names, Token } from "aws-cdk-lib"
import { SecurityGroup, SubnetType, Vpc, Port } from "aws-cdk-lib/aws-ec2"
import { AuroraPostgresEngineVersion, CaCertificate, ClusterInstance, Credentials, DatabaseCluster, DatabaseClusterEngine, DatabaseProxy, ParameterGroup, ProxyTarget } from "aws-cdk-lib/aws-rds"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"

import { Construct } from "constructs"
import { deployment_params } from "../../../../sizing"
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { garnet_broker, garnet_constant, garnet_nomenclature } from "../../../../constants"

export interface GarnetScorpioDatabaseProps {
    vpc: Vpc
    secret_arn: string
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
            securityGroupName: garnet_nomenclature.garnet_broker_sg_database
        })

        const engine = DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_16_6 })

        // Parameter Group

        const parameterGroup = new ParameterGroup(this, 'ParameterGroup', { engine })

        // Aurora Cluster
        const cluster = new DatabaseCluster(this, 'DatabaseAurora', {
            engine,
            parameterGroup,
            clusterIdentifier: garnet_nomenclature.garnet_db_cluster_id, 
            credentials: Credentials.fromSecret(secret), 
            vpc: props.vpc, 
            securityGroups: [sg_database],
            defaultDatabaseName: garnet_constant.dbname,
            vpcSubnets:{
                subnetType: SubnetType.PRIVATE_ISOLATED
            },
            writer: ClusterInstance.serverlessV2('writer', {
                caCertificate: CaCertificate.RDS_CA_RSA4096_G1
            }), 
            readers: [ClusterInstance.serverlessV2('reader', {
                scaleWithWriter: true,
                caCertificate: CaCertificate.RDS_CA_RSA4096_G1
            })], 
            serverlessV2MinCapacity: deployment_params.aurora_min_capacity!,
            serverlessV2MaxCapacity: deployment_params.aurora_max_capacity!,
            storageType: deployment_params.aurora_storage_type!
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
            securityGroupName: garnet_nomenclature.garnet_broker_sg_rds,
            allowAllOutbound: true
        })

        sg_database.addIngressRule(sg_proxy, Port.tcp(5432))
        this.sg_proxy = sg_proxy

        // RDS Proxy
        const rds_proxy = new DatabaseProxy(this, 'RdsProxy', {
            dbProxyName: garnet_nomenclature.garnet_proxy_rds,
            proxyTarget: ProxyTarget.fromCluster(cluster),
            secrets: [secret],
            vpc: props.vpc, 
            idleClientTimeout: Duration.minutes(5), 
            requireTLS: false,
            role: role_proxy,
            securityGroups: [sg_proxy]
        })

        this.database_endpoint = rds_proxy.endpoint
        this.database_port = `${Token.asString(cluster.clusterEndpoint.port)}`

        new CfnOutput(this, 'database_proxy_endpoint', {
           value: this.database_endpoint
    
        })
        new CfnOutput(this, 'database_port', {
            value: this.database_port
        })
       


    }
}