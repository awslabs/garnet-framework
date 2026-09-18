# Change Log

All notable changes to the Garnet Framework will be documented in this file. 

## [2.0.0-rc.1] - 2026-09-18

### Architecture

- Replaced the Scorpio deployment with a Garnet Broker-only distributed runtime
  under the separate `GarnetFramework` stack and `garnet-framework` resource
  namespace.
- Split the broker into independently scalable API, federation, direct
  PostgreSQL matcher, lake sink, notification and maintenance roles on Linux
  ARM64.
- Added a tenant-partitioned Apache Iceberg event lake fed from the broker's
  durable PostgreSQL event log.

### Deployment safety

- Made native ECS blue/green the API default, with private pre-production
  validation, CloudWatch rollback alarms and a configurable bake window.
- Kept background consumers on rolling deployments with circuit breakers to
  avoid concurrently processing side effects from two revisions.
- Added digest-pinned images, explicit schema compatibility gates, one verified
  CDK assembly per deployment and post-deploy smoke tests.

### Scale and resilience

- Added Aurora PostgreSQL 18.4 Serverless v2 with a 2-ACU production floor,
  optional reader failover, standard-storage defaults, deletion protection,
  35-day backups and saturation alarms.
- Replaced Fargate with ECS capacity providers backed by ARM64 EC2. Deployment
  selects the newest available Graviton generation, keeps the service floor on
  On-Demand instances and uses Spot only for interruption-safe worker overflow.
- Added least-privilege pulls for digest-pinned private ECR broker images.
- Enabled dual-limit Temporal retention by default: daily maintenance keeps at
  most one queryable year or 500 GiB in Aurora and truncates complete daily or
  legacy monthly partitions.
- Added independent task autoscaling, AWS load qualification, retained evidence,
  failover exercises and Iceberg compaction monitoring.
- Bound qualification evidence to the deployed database topology, with separate
  writer and reader load, connection and replica-lag series.

## [1.6.0] - 2026-03-18

### Bug Fixes

- **Temporal Query Window Truncation**: Updated Scorpio Broker to fix an issue where temporal queries with `timerel=between` returned only data from the last day of the requested window. The root cause was a default `lastN=50` silently applied when no limit was specified, restricting results to the 50 most recent instances regardless of the time window. See [#11](https://github.com/awslabs/garnet-framework/issues/11).

### Enhancements

- Updated Scorpio Broker to version [6.0.10](https://gallery.ecr.aws/garnet/) based on upstream ScorpioBroker 6.0.1
- Upgraded Quarkus framework to version 3.32.3

### New Features

- **Extended Temporal Query Parameters** *(Scorpio Broker)*: New query parameters available on temporal endpoints:
  - `firstN=N` — returns the N oldest instances (ascending time order), useful for chronological time-series charts
  - `n=N&nOrder=ASC|DESC` — generic N with explicit direction
  - `offsetN=K` — skip K instances within the N window for pagination

## [1.5.2] - 2025-09-26

### Enhancements

- **Dynamic Date Partitioning for Data Lake**: Data lake partitions now use `observedAt` timestamps from NGSI-LD entities instead of ingestion time, enabling ingestion of historical data into the correct hourly partition folders based on actual observation time

## [1.5.1] - 2025-09-17

### Bug Fixes

- Fixed subscription notification duplication issue introduced by the new SQS-based Garnet Private Notification Endpoint feature in version 1.5.0
- Updated Scorpio Broker to version [5.0.94](https://gallery.ecr.aws/garnet/) with subscription processing improvements

## [1.5.0] - 2025-08-18

This version fixes bugs, introduces new features with potential breaking changes, and improves performance. Users can raise issues in the GitHub issues section if any problems occur.

### Performance Optimizations

- Implemented IRI compaction caching to improve temporal query performance
- Enhanced subscription service with type-based entity filtering
 
### Enhancements

- Updated Scorpio Broker to version [5.0.93](https://gallery.ecr.aws/garnet/) with performance and functionality improvements
- Upgraded Quarkus framework to version 3.24.5 with improved stability and performance

### New Features

- **Garnet Private Notification Endpoint**: Added direct SQS integration alongside existing REST API Gateway for improved scalability:
  - Users can now configure `garnet:notification` endpoints for subscription notifications
  - Notifications are sent directly to a dedicated SQS queue using the same AWS IoT Core MQTT topics mechanism for consumption

### Deprecated

- **Smart Data Models Context**: The `context.jsonld` file is deprecated and should no longer be used as it can conflict with NGSI-LD core context.


### Upgrade Notes

- Existing subscriptions continue to work unchanged

## [1.4.3] - 2025-07-18

### Enhancements

- Added CORS preflight support for API Gateway with dedicated OPTIONS method handler

## [1.4.2] - 2025-05-28

### Bug Fixes

- Updated Scorpio Broker to version [5.0.92](https://gallery.ecr.aws/garnet/)
- Fixed context resolution issue affecting transitions between concentrated and distributed architectures
- Improved handling of external context URLs with robust fallback mechanism
- Enhanced error handling and logging for context resolution


## [1.4.1] - 2025-05-20 

This new version includes enhancements to key components, bug fixes, and new integration features.

### Enhancements

- Enhanced the datalake component to transmit normalized entity versions including system attributes, providing more comprehensive data for analysis
- Updated Scorpio Broker to version [5.0.91](https://gallery.ecr.aws/garnet/)
- Improved stability of the subscriptions component
- Added multi-architecture support for seamless transitions between concentrated and distributed deployments: 
    - Implemented intelligent context resolution with configurable fallback mechanism 
    - Ensured backward compatibility for existing subscriptions when changing architectures 
    - Added context caching for improved performance


### New Features

- Added synchronization from AWS IoT to the context broker:
    - The system now listens to AWS IoT Core event messages and automatically updates the context broker
    - Creation, deletion, or updates of AWS IoT Things now trigger corresponding entity changes in the context broker using the AwsIotThing type
    - Similar lifecycle management for AWS IoT Thing Groups creates or updates entities using the AwsIotThingGroup type

 

## [1.4.0] - 2025-02-19 

We've implemented significant architectural changes in this release to improve cost efficiency and scalability. 
The documentation has been updated to reflect these changes and provides detailed guidance on using the new architecture and features.

### Major Changes

- Redesigned Architecture and Stack
    - Complete architectural overhaul
    - New stack implementation
    
- Simplified Architecture Configuration
    - Replaced sizing options with direct choice between Concentrated and Distributed architectures
    - Moved detailed configuration parameters to architecture.ts for better clarity and control

- Context Broker Update
    - Upgraded Scorpio Broker to version ([5.0.90](https://gallery.ecr.aws/garnet/))

- Improved Ingestion Process
    - Eliminated AWS IoT Device Shadow dependency
    - Implemented direct ingestion via deployment-provided queue
    - Added automatic context broker updates using batch operation upsert
    - Delivered more cost-effective and scalable solution

- Database Engine Update
    - Aurora Serverless v2 upgraded to PostgreSQL v16.6

- Streamlined Data Lake Integration
    - Direct Kinesis Firehose integration for data lake delivery
    - Created more efficient data pipeline by removing IoT rule dependency

- API and Data Model Changes
    - Removing the Garnet JSON-LD context
    - Deprecation of IoT API
    - Authorization now enforced with a token (provided as output of CloudFormation stack)
    - JSON-LD context change: AWS IoT thing is now referenced as AwsIotThing


- NGSI-LD Type for Things changed. Now AWS IoT thing is AwsIotThing. 

### Required Actions

Users will need to:
-   Update their ingestion workflows to use the new queue for ingesting
-   Migrate any AWS IoT Device Shadow dependencies

## [1.3.0] - 2024-05-07 

This new version fixes a [bug](https://github.com/ScorpioBroker/ScorpioBroker/issues/556) we had due to the use of SQS in Scorpio Broker for fanning out messages. This led to missing messages in the datalake, the temporal storage and the subscriptions. 

### [1.3.0] - Added 

- SNS for fanning out messages to dedicated SQS queues per service.
- VPC endpoints for SNS and SQS 

### [1.3.0] - Changed 

- Updated Aurora serverless v2 engine version to Postgresql v15.5


## [1.2.0] - 2024-02-23 

This new version fixes some bugs, introduces new features and potential breaking changes. 

### [1.2.0] - Added 

- Distributed architecture. You can now deploy Garnet using the microservice version of Scorpio Broker. 
- T-shirt Sizing for deployment. You can now choose the size of the deployment between Small and Xlarge depending on your workload. 

### [1.2.0] - Changed

- Renames resources (logs, functions)

## [1.1.0] - 2024-02-06

This new version fixes some bugs, introduces new features and potential breaking changes. 

### Added 

- RDS Proxy for the database.  
- Multi-typing support. See [Multi-Typing](https://garnet-framework.tech/docs/how/context-broker#multi-typing) section for information.
- Connectivity status of Things connected using AWS IoT Core. See [Connectivity Status](https://garnet-framework.tech/docs/how/garnet-iot#connectivity-status) for more information. 
- Sync of AWS Iot Things Group Membership with Shadows and the Context Broker. See [Garnet Thing](https://garnet-framework.tech/docs/how/garnet-iot#a-garnet-thing) section for more information. 


### Changed

- Aurora Serverless v2 is now used for the PostgreSQL instead of Amazon RDS. 
- Renamed resources (logs, functions)
- Updated Scorpio Broker to version [4.1.14](https://gallery.ecr.aws/garnet/scorpio)



## [1.0.0] - 2023-11-02

Initial commit of the Garnet Framework.
