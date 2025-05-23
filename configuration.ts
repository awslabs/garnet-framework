import { ARCHITECTURE } from "./architecture"

// GARNET PARAMETERS
export const Parameters = {
    /**
     * See regions in which you can deploy Garnet: 
     * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html#http-api-vpc-link-availability
    */
    aws_region: "us-east-1",  

    /**
     * Choose between Concentrated (single container) or Distributed (microservices) architecture.
     * You can fine-tune the deployment parameters in architecture.ts
     * - Concentrated: All services in one container, suitable for development and testing
     * - Distributed: 8 specialized microservices, recommended for production deployments
    */
    architecture: ARCHITECTURE.Distributed,


    // API Authorization
    authorization: true 
}