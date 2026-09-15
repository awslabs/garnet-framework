## Garnet Framework 

#### [Version 1.6.0](./CHANGELOG.md#160---2026-03-18)

__Explore the [documentation website of Garnet Framework](https://garnet-framework.tech/docs) to get started.__ 

### Overview

The Garnet Framework is an open-source framework that enables you to build living digital twins and context-aware solutions through dynamic knowledge graphs leveraging open standards.

Garnet Framework provides real-time context management, temporal data capabilities, geospatial queries, subscription-based notifications, and automated data lake integration for comprehensive analytics and AI-powered decision-making.
By creating unified, continuously updating digital representations of your physical environments and processes, Garnet Framework delivers the contextual intelligence that powers smart decision-making across domains including Smart Cities, Energy, Manufacturing, Supply Chain, Agriculture, Buildings, and Transportation.

Garnet Framework is built on the [NGSI-LD](https://ngsi-ld.org/) open standard and leverages the open-source NGSI-LD Context Broker technology. 
It is designed to be easily deployable on the AWS infrastructure using the [AWS Cloud Development Kit](https://aws.amazon.com/cdk/) (CDK), allowing for streamlined deployment and management. 

Through its knowledge graph capabilities, Garnet transforms fragmented data into interconnected knowledge that evolves in near real-time with your operations—providing the essential context your applications and AI systems need.

This branch deploys Garnet Broker through the separate `GarnetFramework`
CloudFormation stack. It does not modify or reuse the maintenance stack's
database. The runtime is distributed and ARM64, supports rolling or API
blue/green deployment, and writes immutable broker events to a tenant/day
partitioned Iceberg lake. Queryable Temporal history is bounded in Aurora by
independent age and size ceilings rather than growing indefinitely.

## Getting Started 

Explore the [documentation website of Garnet Framework](https://garnet-framework.tech/docs) to get started. 

## Deploying

See [DEPLOYMENT.md](DEPLOYMENT.md) for the build and release process: the CI/CD pipeline, environment setup, deployment strategies (rolling and blue/green), rollback procedures and a cost breakdown.

Quick reference for local work:

```bash
npm install          # root + Lambda layer dependencies
npm run lint         # what CI gates on
npm run typecheck
npm test
npm run synth        # cdk synth, no AWS credentials required
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
