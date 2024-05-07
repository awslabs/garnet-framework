import { SIZING } from "./constants"

// GARNET PARAMETERS
export const Parameters = {
    /**
     * See regions in which you can deploy Garnet: 
     * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability
    */
    aws_region: "eu-west-1",  

    /**
     * The description above is for reference only. You can fine tune your deployment in the file sizing.ts. 
     * Small is suitable for developing and testing the capabilities of the framework (< 1000 events per minute). 
     * Medium and above deployments are using the distributed architecture (8 microservices) and increasing the capacity of the database, the number of containers, their CPU and memory. 
    */
    sizing: SIZING.Medium,

    // SMART DATA MODEL
    smart_data_model_url : 'https://raw.githubusercontent.com/awslabs/garnet-framework/main/context.jsonld', 
}