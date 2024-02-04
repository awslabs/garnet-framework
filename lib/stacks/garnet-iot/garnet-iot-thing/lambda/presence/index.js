const iot_region = process.env.AWSIOTREGION 
const shadow_prefix = process.env.SHADOW_PREFIX

const {IoTDataPlaneClient, UpdateThingShadowCommand} = require('@aws-sdk/client-iot-data-plane')
const iotdata = new IoTDataPlaneClient({region: iot_region})
const {log_error} = require('/opt/nodejs/utils.js') 
exports.handler = async (event, context) => {
    try {
    
        for await (let msg of event.Records){
            let presence = JSON.parse(msg.body)
            const {clientId, timestamp, eventType, clientInitiatedDisconnect, sessionIdentifier, principalIdentifier, disconnectReason, ipAddress, versionNumber } = presence
            let payload = {
                connectivityStatus: {
                    value: eventType.toUpperCase(),
                    sessionIdentifier, 
                    principalIdentifier,
                    versionNumber, 
                    observedAt: (new Date(timestamp)).toISOString(),
                }
            }

            if(ipAddress) { 
                payload.connectivityStatus.ipAddress = ipAddress 
            } else {
                payload.connectivityStatus.ipAddress = null
            } 

            if(disconnectReason) { 
                payload.connectivityStatus.disconnectReason = disconnectReason 
            } else {
                payload.connectivityStatus.disconnectReason = null 
            }

            console.log({clientInitiatedDisconnect})

            if(clientInitiatedDisconnect !== undefined) {
                payload.connectivityStatus.clientInitiatedDisconnect = `${clientInitiatedDisconnect}`
            } else {
                payload.connectivityStatus.clientInitiatedDisconnect = null
            }

            try {
                let shadow_type = 'Thing'
                const shadow_payload = {
                    state: {
                        reported: payload
                    }
                }
                
                let updateThingShadow = await iotdata.send(
                    new UpdateThingShadowCommand({
                        payload: JSON.stringify(shadow_payload), 
                        thingName: clientId, 
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