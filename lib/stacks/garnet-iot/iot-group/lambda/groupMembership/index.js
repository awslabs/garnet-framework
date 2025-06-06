const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const AWSIOTTHINGTYPE = process.env.AWSIOTTHINGTYPE
const AWSIOTTHINGGROUPTYPE = process.env.AWSIOTTHINGGROUPTYPE
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js') 

const { IoTClient, ListThingGroupsForThingCommand } = require("@aws-sdk/client-iot")
const iot = new IoTClient({})
const headers = {
    'Content-Type': 'application/json'
}

exports.handler = async (event, context) => {
    try {
        console.log(JSON.stringify(event))
        let {thingName} = event 
        let tgs = []
        let token = null

        while (token !== undefined) {

        let {thingGroups, nextToken} = await iot.send(
            new ListThingGroupsForThingCommand({
                thingName,
                nextToken: token
            })
        )
        tgs = tgs.concat(thingGroups)
        token = nextToken

        }

        let payload = {}

        if(tgs.length > 0){
          payload.thingGroups = { 
            object: tgs.map(tg => `urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${tg.groupName}`),
            objectType: AWSIOTTHINGGROUPTYPE
        }
        } else {
            payload.thingGroups = 'urn:ngsi-ld:null' 

        }

        try {

            let entity = {
                id: `urn:ngsi-ld:${AWSIOTTHINGTYPE}:${thingName}`,
                type: [`${AWSIOTTHINGTYPE}`],
                ...payload
            }
            entity = normalize(entity)
            try {
                
            let {data: res} = await axios.post(`${dns_broker}/entities/${entity.id}/attrs`, entity, {headers: headers}) 

            console.log(res)
            } catch(e){
                console.log(e)
            }

        
        } catch (e) {
            log_error(event,context, e.message, e)
        }
 
    } catch (e) {
        log_error(event,context, e.message, e)      
    }
}