import { Aws, CfnOutput, Duration, Names, Token } from "aws-cdk-lib"
import { SecurityGroup, SubnetType, Vpc, Port } from "aws-cdk-lib/aws-ec2"
import { AuroraPostgresEngineVersion, CaCertificate, CfnDBProxyEndpoint, ClusterInstance, Credentials, DatabaseCluster, DatabaseClusterEngine, DatabaseProxy, ParameterGroup, ProxyTarget } from "aws-cdk-lib/aws-rds"
import { Secret } from "aws-cdk-lib/aws-secretsmanager"

import { Construct } from "constructs"
import { deployment_params } from "../../../../architecture"
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam"
import { garnet_broker, garnet_constant, garnet_nomenclature } from "../../../../constants"
import { Alarm } from "aws-cdk-lib/aws-cloudwatch"

export interface GarnetScorpioDatabaseProps {
    vpc: Vpc
    secret_arn: string
}

export class GarnetScorpioDatabase extends Construct{

    public readonly database_endpoint: string
    // public readonly database_reader_endpoint: string
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

        const parameterGroup = new ParameterGroup(this, 'ParameterGroup', { 
            engine,
            // parameters: {
            //     'shared_buffers': '4GB',
            //     'max_connections': '10000',
            //     'effective_cache_size': '12GB',
            //     'maintenance_work_mem': '1GB',
            //     'checkpoint_completion_target': '0.9',
            //     'wal_buffers': '16MB',
            //     'default_statistics_target': '100',
            //     'random_page_cost': '1.1',
            //     'effective_io_concurrency': '200',
            //     'work_mem': '64MB',
            //     'min_wal_size': '1GB',
            //     'max_wal_size': '4GB',
            //     'idle_in_transaction_session_timeout': '7200000', // 2 hours
            //     'statement_timeout': '7200000', // 2 hours
            // }
        
        
        })

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
            maxConnectionsPercent: 100,
            debugLogging: true,
            vpc: props.vpc, 
            idleClientTimeout: Duration.minutes(5), 
            requireTLS: false,
            role: role_proxy,
            securityGroups: [sg_proxy]
        })

        // // RDS Read OnlyProxy
        // const readOnlyEndpoint = new CfnDBProxyEndpoint(this, 'RdsProxyReadOnlyEndpoint', {
        //     dbProxyEndpointName: `${garnet_nomenclature.garnet_proxy_rds}-readonly`,
        //     dbProxyName: rds_proxy.dbProxyName,
        //     targetRole: 'READ_ONLY',
        //     vpcSubnetIds: props.vpc.privateSubnets.map(subnet => subnet.subnetId),
        //     vpcSecurityGroupIds: [sg_proxy.securityGroupId]
        // })


        // Add CloudWatch alarms for key metrics
        new Alarm(this, 'DatabaseConnectionsAlarm', {
            metric: cluster.metricDatabaseConnections(),
            threshold: 900,  // 90% of max connections
            evaluationPeriods: 3,
            datapointsToAlarm: 2
        })

        this.database_endpoint = rds_proxy.endpoint
        // this.database_reader_endpoint = readOnlyEndpoint.attrEndpoint
        this.database_port = `${Token.asString(cluster.clusterEndpoint.port)}`

        new CfnOutput(this, 'database_proxy_endpoint', {
           value: this.database_endpoint
    
        })
        new CfnOutput(this, 'database_port', {
            value: this.database_port
        })
       


    }
}