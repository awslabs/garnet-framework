import { Names, RemovalPolicy, SecretValue } from "aws-cdk-lib";
import { ClusterParameterGroup, DatabaseCluster } from "aws-cdk-lib/aws-docdb";
import { InstanceType, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { Parameters } from "../../../../parameters";

export interface GarnetOrionDatabaseProps {
  secret_arn: string
  vpc: Vpc
}

export class GarnetOrionDatabase extends Construct {
  public readonly db_socket_address: string
  public readonly sg_database: SecurityGroup

  constructor(scope: Construct, id: string, props: GarnetOrionDatabaseProps) {
    super(scope, id)

    // Check props
    if (!props.vpc){
        throw new Error('The property vpc is required to create an instance of GarnetOrionDatabase Construct')
    }
    if (!props.secret_arn){
        throw new Error('The property secret_arn is required to create an instance of GarnetOrionDatabase Construct')
    }

    const secret = Secret.fromSecretCompleteArn(this, 'Secret', props.secret_arn)

    const sg_documentdb = new SecurityGroup(this, "SecurityGroupDocumentdb", {
      vpc: props.vpc,
      securityGroupName: `garnet-${Parameters.garnet_broker.toLowerCase()}-database-sg-${Names.uniqueId(this).slice(-4).toLowerCase()}`
    })
    this.sg_database = sg_documentdb
    const parameter_group = new ClusterParameterGroup(this, "parameterGroup", {
      parameters: {
        tls: "disabled",
      },
      family: "docdb4.0",
    })

    const ddb_cluster = new DatabaseCluster(this, "DocDb", {
      masterUser: {
        username: secret.secretValueFromJson('username').toString(),
        password: secret.secretValueFromJson('password')
      },
      instanceType: Parameters.garnet_orion.docdb_instance_type,
      vpc: props.vpc,
      instances: Parameters.garnet_orion.docdb_nb_instances,
      engineVersion: "4.0",
      parameterGroup: parameter_group,
      securityGroup: sg_documentdb,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.db_socket_address = ddb_cluster.clusterEndpoint.socketAddress
  }
}
