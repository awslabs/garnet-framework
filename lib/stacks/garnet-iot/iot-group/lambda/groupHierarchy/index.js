const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const AWSIOTTHINGGROUPTYPE = process.env.AWSIOTTHINGGROUPTYPE
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js') 

const { IoTClient, DescribeThingGroupCommand } = require("@aws-sdk/client-iot")
const iot = new IoTClient({})
const headers = {
    'Content-Type': 'application/json'
}

exports.handler = async (event, context) => {
    try {

        console.log(JSON.stringify(event))
        let {childGroupName} = event 
        let {thingGroupMetadata: {rootToParentThingGroups, parentGroupName} } = await iot.send(
            new DescribeThingGroupCommand({
                thingGroupName: childGroupName
            })
        )
        
        let group = {
                id: `urn:ngsi-ld:${AWSIOTTHINGGROUPTYPE}:${childGroupName}`,
                type: `${AWSIOTTHINGGROUPTYPE}`
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

            try {
                
            let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update `, [group], {headers: headers}) 
            console.log(res)

            } catch(e){
                console.log(e)
            }    

    } catch (e) {
        log_error(event,context, e.message, e)      
    }
}