const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const URL_SMART_DATA_MODEL = process.env.URL_SMART_DATA_MODEL
const AWSIOTTHINGTYPE = process.env.AWSIOTTHINGTYPE
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js')


const headers = {
    'Content-Type': 'application/json',
    'Link': `<${URL_SMART_DATA_MODEL}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
}

exports.handler = async (event, context) => {
    try {
    
        for await (let msg of event.Records){
            let presence = JSON.parse(msg.body)
            const {clientId, timestamp, eventType, clientInitiatedDisconnect, sessionIdentifier, principalIdentifier, disconnectReason, ipAddress, versionNumber } = presence
            if (clientId.startsWith('iotconsole')) return 
            let payload = {
                connectivityStatus: {
                    value:  {
                        status: eventType.toUpperCase(),
                    },
                    sessionIdentifier, 
                    principalIdentifier,
                    versionNumber, 
                    observedAt: (new Date(timestamp)).toISOString(),
                }
            }

            if(ipAddress) { 
                payload.connectivityStatus.ipAddress = ipAddress 
            }

            if(disconnectReason) { 
                payload.connectivityStatus.disconnectReason = disconnectReason 
            } 

            console.log({clientInitiatedDisconnect})

            if(clientInitiatedDisconnect !== undefined) {
                payload.connectivityStatus.clientInitiatedDisconnect = `${clientInitiatedDisconnect}`
            }

            try {
                let entity = {
                    id: `urn:ngsi-ld:${AWSIOTTHINGTYPE}:${clientId}`,
                    type: [`${AWSIOTTHINGTYPE}`],
                    ...payload
                }

            entity = normalize(entity)

            try {
                
            // let {data: res} = await axios.post(`${dns_broker}/entities/${entity.id}/attrs`, entity, {headers: headers}) 
            let {data: res} = await axios.post(`${dns_broker}/entities/${entity.id}/attrs`, entity, {headers: headers}) 
            console.log(res)
            } catch(e){
                console.log(e)
            } 
            
            } catch (e) {
                log_error(event,context, e.message, e)
            }

        }
        
    } catch (e) {
        log_error(event,context, e.message, e)      
    }
}