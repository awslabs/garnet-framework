const axios = require('axios')
const CONTEXT_BROKER = process.env.CONTEXT_BROKER
const GARNET_VERSION = process.env.GARNET_VERSION
const GARNET_PRIVATE_ENDPOINT = process.env.GARNET_PRIVATE_ENDPOINT
const GARNET_IOT_SQS_URL = process.env.GARNET_IOT_SQS_URL
const GARNET_IOT_SQS_ARN = process.env.GARNET_IOT_SQS_ARN


exports.handler = async (event) => {

    try {

        const {headers : {Host}} = event
        let path
        if(CONTEXT_BROKER == "Orion"){
            path = `ngsi-ld/ex/v1/version`
        } else if (CONTEXT_BROKER == "Scorpio") {
            path = `q/info`
        } else {
            
            return {
                statusCode: 400,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: {
                        title: `Bad Request`,
                        details: `${CONTEXT_BROKER} is an invalid value for Context Broker`
                    }
                })
            }

        }
        let url = `https://${Host}/${path}`
        console.log(url)
        let dt =null
        try {
            let {data} = await axios.get(url)
            dt= data 
        } catch (e) {
            console.log(e)
        }


        let result = {
            "garnet_version": GARNET_VERSION, 
            "context_broker": CONTEXT_BROKER, 
            "garnet_private_endpoint": GARNET_PRIVATE_ENDPOINT, 
            "garnet_iot_sqs_url": GARNET_IOT_SQS_URL, 
            "garnet_iot_sqs_arn": GARNET_IOT_SQS_ARN,  
            "context_broker_info": dt
        }

        const response = {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(result),
        }
        console.log(response)

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