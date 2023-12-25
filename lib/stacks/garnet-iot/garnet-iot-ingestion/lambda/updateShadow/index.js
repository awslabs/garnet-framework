const iot_region = process.env.AWSIOTREGION 
const shadow_prefix = process.env.SHADOW_PREFIX
const url_broker = process.env.URL_CONTEXT_BROKER

const {IoTDataPlaneClient, UpdateThingShadowCommand} = require('@aws-sdk/client-iot-data-plane')
const iotdata = new IoTDataPlaneClient({region: iot_region})

const {get_type, log_error, recursive_concise} = require('/opt/nodejs/utils.js') 

exports.handler = async (event, context) => {
    try {
    
        for await (let msg of event.Records){
            let payload = JSON.parse(msg.body)

            if(!payload.id || !payload.type){
                throw new Error('Invalid entity - id or type is missing')
            }

            let shadow_type = get_type(payload)

            if (payload['@context']) {
                console.log(`Removed the context:`)
                console.log(payload['@context'])
                delete payload['@context']
            }
            const thingName = `${payload.id.split(':').slice(-1)}`

            for (let [key, value] of Object.entries(payload)) {
                if(!["type", "id", "@context"].includes(key)) {
            
                    if( typeof value == "object" && !Array.isArray(value)){
                    recursive_concise(key, value)
                    } else {
                        payload[key] = {
                            "value": value
                        }
                    }
                    
                
                } 
            }
            
            try {
                const shadow_payload = {
                    state: {
                        reported: payload
                    }
                }
                
                let updateThingShadow = await iotdata.send(
                    new UpdateThingShadowCommand({
                        payload: JSON.stringify(shadow_payload), 
                        thingName: thingName, 
                        shadowName: `${shadow_prefix}-${shadow_type}`
                    })
                )
            
            } catch (e) {
                log_error(event,context, e.message, e)
            }

        }
        
    } catch (e) {
        log_error(event,context, e.message, e)      
    }
}



