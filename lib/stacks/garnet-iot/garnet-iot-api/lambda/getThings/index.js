const iot_region = process.env.AWSIOTREGION 
const shadow_prefix = process.env.SHADOW_PREFIX

const { IoTClient, ListThingsCommand} = require("@aws-sdk/client-iot")
const iot = new IoTClient({region: iot_region})

exports.handler = async (event) => {

    try { 
        let { headers} = event

        // lower case headers
        headers = Object.keys(headers).reduce( (acc, key) => {
            acc[key.toLowerCase()] = headers[key]
            return acc
        }, {})
      
        let nToken = headers?.['nexttoken'] ? headers['nexttoken'] : null

        let {things, nextToken} = await iot.send(
            new ListThingsCommand({
                    nextToken: nToken
            })
        )

        let tgs = things.reduce((prev, curr) => { 
            return [ ...prev, 
                    { 
                        thingName: curr.thingName, 
                    }
            ]
        }, [])

    
        const response = {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nextToken, 
                things: tgs
            }),
        }


        return response

    }  catch(e){

        let statusCode = e.statusCode ? e.statusCode : 500
        const response = {
            statusCode,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({message: e.message}),
        }
        console.log(e)
        return response
    }
}