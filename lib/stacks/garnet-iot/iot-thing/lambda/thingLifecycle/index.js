const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const AWSIOTTHINGTYPE = process.env.AWSIOTTHINGTYPE 
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js')

const headers = {
    'Content-Type': 'application/json'
}

exports.handler = async (event, context) => {
    try {
     
        
        // Extract group information from the event
        const {operation, thingName, timestamp, thingId, versionNumber,attributes, eventId } = event

        if(['CREATED', 'UPDATED'].includes(operation)){
            let thing = {
                id: `urn:ngsi-ld:${AWSIOTTHINGTYPE}:${thingName}`,
                type: `${AWSIOTTHINGTYPE}`, 
                thingName: {
                    value: thingName
                }, 
                thingId: {
                    value: thingId
                }, 
                versionNumber: {
                    value: versionNumber
                },
                eventType: {
                    type: "Property", 
                    value: operation, 
                    eventId: eventId, 
                    observedAt: (new Date(timestamp)).toISOString()
                }
            }

            if (attributes && typeof attributes === 'object') {
                Object.keys(attributes).forEach(key => {
                  if (attributes[key] !== undefined && attributes[key] !== null) {
                    thing[key] = {
                      type: 'Property',
                      value: attributes[key]
                    }
                  }
                })
            }

            try {
                
            let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update `, [thing], {headers: headers}) 
            console.log(res)

            } catch(e){
                console.log(e)
            }


        }

        if(['DELETED'].includes(operation)){
            let {data: res} = await axios.delete(`${dns_broker}/entities/urn:ngsi-ld:${AWSIOTTHINGTYPE}:${thing}`) 
            console.log(res)
        }
    

    } catch (e) {
        log_error(event, context, e.message, e)
    }
}
