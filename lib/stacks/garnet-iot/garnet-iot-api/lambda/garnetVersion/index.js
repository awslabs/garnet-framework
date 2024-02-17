const axios = require('axios')
const CONTEXT_BROKER = process.env.CONTEXT_BROKER
const GARNET_VERSION = process.env.GARNET_VERSION
const GARNET_PRIVATE_ENDPOINT = process.env.GARNET_PRIVATE_ENDPOINT
const GARNET_IOT_SQS_URL = process.env.GARNET_IOT_SQS_URL
const GARNET_IOT_SQS_ARN = process.env.GARNET_IOT_SQS_ARN
const DNS_CONTEXT_BROKER = process.env.DNS_CONTEXT_BROKER
const GARNET_ARCHITECTURE = process.env.GARNET_ARCHITECTURE
const GARNET_CONTAINERS = JSON.parse(process.env.GARNET_CONTAINERS)

exports.handler = async (event) => {
    try {

        const {headers : {Host}} = event

        let path = `q/info`
          
        let allTasks = GARNET_CONTAINERS.map(async (c) => {

        let url = `http://${DNS_CONTEXT_BROKER}/${path}`

        try {
          let { data } = await axios.get(url, { headers: { container: c}});
            console.log({data})
            return { [c]: { data } };
        } catch (e) {
            console.log(e)
        }
        })

        const responsesArray = await Promise.all(allTasks);
        const responses = responsesArray.length > 0 ? Object.fromEntries(
        responsesArray.map((x) => [Object.keys(x)[0], Object.values(x)[0]])
        ) : null 
            
                
        let result = {
          garnet_version: GARNET_VERSION,
          garnet_architecture: GARNET_ARCHITECTURE,
          context_broker: CONTEXT_BROKER,
          garnet_private_endpoint: GARNET_PRIVATE_ENDPOINT,
          garnet_iot_sqs_url: GARNET_IOT_SQS_URL,
          garnet_iot_sqs_arn: GARNET_IOT_SQS_ARN,
          context_broker_info: responses
        }    

        const response = {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(result),
        }
      

        return response

        
    } catch (e) {
        const response = {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({message: e.message}),
        }
        console.log(e)
        return response
    }

}