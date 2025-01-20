const iot_region = process.env.AWSIOTREGION 
const shadow_prefix = process.env.SHADOW_PREFIX
const AWSIOTTHINGTYPE = process.env.AWSIOTTHINGTYPE

const { IoTDataPlaneClient, UpdateThingShadowCommand } = require("@aws-sdk/client-iot-data-plane")
const { IoTClient, ListThingGroupsForThingCommand} = require("@aws-sdk/client-iot")
const iot = new IoTClient({region: iot_region})
const iotdata = new IoTDataPlaneClient({region: iot_region})

const {log_error} = require('/opt/nodejs/utils.js') 

exports.handler = async (event, context) => {
    try {
        console.log(JSON.stringify(event))
        let {thingName, thingGroup} = event 
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
          payload.thingGroups = { value: tgs.map(tg => tg.groupName)}
        } else {
            payload.thingGroups = null
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
                    thingName, 
                    shadowName: `${shadow_prefix}-${shadow_type}`
                })
            )
        
        } catch (e) {
            log_error(event,context, e.message, e)
        }
 
    } catch (e) {
        log_error(event,context, e.message, e)      
    }
}