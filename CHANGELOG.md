# Change Log


All notable changes to the Garnet Framework will be documented in this file. 

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



## [1.0.0] - 2023-05-02

Initial commit of the Garnet Framework. 