const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const AWSIOTTHINGGROUPTYPE = process.env.AWSIOTTHINGGROUPTYPE 
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js')

const headers = {
    'Content-Type': 'application/json'
}

exports.handler = async (event, context) => {
    try {
     
        
        // Extract group information from the event
        const {operation, thingGroupName, timestamp, thingGroupId, versionNumber, parentGroupName, description, rootToParentThingGroups, attributes, eventId } = event

        if(['CREATED', 'UPDATED'].includes(operation)){
            let group = {
                id: `urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${thingGroupName}`,
                type: `${AWSIOTTHINGGROUPTYPE}`, 
                thingGroupName: {
                    value: thingGroupName
                }, 
                description: {
                    value: description
                },
                thingGroupId: {
                    value: thingGroupId
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

            if(parentGroupName){
                group.inParentGroup = {
                    object: `urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${parentGroupName}`,
                    objectType: `${AWSIOTTHINGGROUPTYPE}`
                }
            }

            if(rootToParentThingGroups && rootToParentThingGroups.length > 0 ){
                group.inGroupHierarchy = { 
                    objectList: rootToParentThingGroups.map(tg => `urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${tg.groupArn.split('/').pop()}`),
                    objectType: AWSIOTTHINGGROUPTYPE
                }
            }

            if (attributes && typeof attributes === 'object') {
                Object.keys(attributes).forEach(key => {
                  if (attributes[key] !== undefined && attributes[key] !== null) {
                    group[key] = {
                      type: 'Property',
                      value: attributes[key]
                    }
                  }
                })
            }

            try {
                
            let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update `, [group], {headers: headers}) 
            console.log(res)

            } catch(e){
                console.log(e)
            }


        }

        if(['DELETED'].includes(operation)){
            let {data: res} = await axios.delete(`${dns_broker}/entities/urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${thingGroupName}`) 
            console.log(res)
        }
    

    } catch (e) {
        log_error(event, context, e.message, e)
    }
}
