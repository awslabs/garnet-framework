# Change Log

All notable changes to the Garnet Framework will be documented in this file. 

## [1.4.5] - 2025-07-31

### Bug Fixes

- Fixed critical linked entity retrieval bug in Scorpio Broker [5.0.93](https://gallery.ecr.aws/garnet/) affecting `join=inline` with `joinLevel` parameters:
  - Resolved issue where linked entities returned empty arrays instead of embedded entities when using `options=simplified` or `options=concise`
  - Enhanced JSON-LD compaction process to preserve embedded entity data after processing
  - Fixed handling of all NGSI-LD attribute types in concise format conversion

- Resolved reactive streams initialization conflicts in subscription system:
  - Fixed `ReactiveStreamsNoActiveSubscriptionsException` during startup caused by mixed Camel and reactive messaging patterns
  - Refactored GarnetNotificationService to use pure reactive messaging with MutinyEmitter patterns
  - Updated SQS configuration with proper credentials and queue naming conventions

### Enhancements

- Enhanced subscription validation with comprehensive input safety:
  - Added type validation for malformed notification fields to prevent runtime crashes
  - Implemented proper error handling for ClassCastException and IndexOutOfBoundsException scenarios
  - Improved validation error messages for better debugging experience

- Optimized private notification batching configuration:
  - Reduced batch timeout to 1 second for improved responsiveness
  - Maintained cost efficiency through intelligent batching (10 messages or 1 second timeout)
  - Enhanced monitoring capabilities for batch processing metrics

### Documentation

- Updated comprehensive configuration documentation with copy-paste ready examples
- Added complete Garnet Framework topic configuration in proper JavaScript object format
- Included verification commands and testing procedures for both notification approaches
- Provided build commands for production and development deployment scenarios

## [1.4.4] - 2025-07-29

### Enhancements

- Updated Scorpio Broker to version [5.0.93](https://gallery.ecr.aws/garnet/) with comprehensive performance and functionality improvements:
  - Implemented native timestamp usage across all services for improved query performance
  - Optimized temporal query operations with enhanced database indexing for complex queries
  - Enhanced subscription management with type-based indexing and improved JSONB operations
  - Consolidated batch operations to reduce database round trips
  - Added intelligent subscription indexing and JSON-LD context caching optimizations
  - Improved linked entity optimization for better query performance on relationship-based filtering
  - Enhanced database indexing for NGSI-LD relationship traversal supporting both Relationship and ListRelationship types
  - Added comprehensive monitoring and analytics for relationship usage patterns
  - Implemented thread-safe subscription processing with race condition protections
  - Resolved Quarkus 3.24.5 upgrade compilation issues and memory allocation problems

### New Features

- **Garnet Private Endpoint System**: Replaced REST API Gateway with direct SQS integration for improved scalability:
  - **Simplified subscription setup**: Omit the notification attribute to automatically use Garnet private endpoints
  - **Scalable architecture**: Direct SQS batching with configurable batch sizes and timeout settings
  - **AWS IoT Core integration**: Consumption through MQTT in AWS IoT Core remains unchanged for existing workflows
  - **Lambda-compatible format**: Structured messages designed for serverless processing and MQTT topic distribution
  - **Cost optimization**: Direct SQS approach reduces infrastructure overhead compared to API Gateway routing
  - **Reliability improvements**: Built-in message durability, retry mechanisms, and dead letter queue support

### Technical Implementation

- Enhanced subscription service with type-based entity filtering for improved performance
- Implemented thread-safe concurrent collections to eliminate race conditions in subscription processing
- Added distributed cache synchronization using PostgreSQL NOTIFY/LISTEN for multi-instance deployments
- Profile-based service activation ensures Garnet private endpoints are only active in SQS configurations
- Automatic SQS queue creation leverages existing Apache Camel infrastructure
- Built-in statistics and monitoring for queue performance and batch processing metrics

### Upgrade Notes

- Existing subscriptions with webhook endpoints continue to work unchanged
- New subscriptions without notification attributes automatically use the Garnet private endpoint system
- SQS profile deployments benefit from enhanced scalability and reduced latency
- MQTT consumption patterns in AWS IoT Core remain compatible with existing implementations


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
- Multi-typing support. See [Multi-Typing](https://garnet-framework.dev/docs/how/context-broker#multi-typing) section for information.
- Connectivity status of Things connected using AWS IoT Core. See [Connectivity Status](https://garnet-framework.dev/docs/how/garnet-iot#connectivity-status) for more information. 
- Sync of AWS Iot Things Group Membership with Shadows and the Context Broker. See [Garnet Thing](https://garnet-framework.dev/docs/how/garnet-iot#a-garnet-thing) section for more information. 


### Changed

- Aurora Serverless v2 is now used for the PostgreSQL instead of Amazon RDS. 
- Renamed resources (logs, functions)
- Updated Scorpio Broker to version [4.1.14](https://gallery.ecr.aws/garnet/scorpio)



## [1.0.0] - 2023-11-02

Initial commit of the Garnet Framework.
