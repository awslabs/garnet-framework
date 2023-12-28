const iot_region = process.env.AWSIOTREGION 
const shadow_prefix = process.env.SHADOW_PREFIX

const { IoTDataPlaneClient, UpdateThingShadowCommand } = require("@aws-sdk/client-iot-data-plane")
const { IoTClient, CreateThingCommand, CreateThingGroupCommand, AddThingToThingGroupCommand } = require("@aws-sdk/client-iot")
const iot = new IoTClient({region: iot_region})
const iotdata = new IoTDataPlaneClient({region: iot_region})

const {get_type, log_error, concise} = require('/opt/nodejs/utils.js') 

exports.handler = async (event) => {

    try{

        try { JSON.parse(event.body) } catch(e){throw new Error('Invalid body property. The body must be a JSON object. Check the Content-Type in your header')}

        const body = JSON.parse(event.body)
        let payload = body
        let groups = body.thingGroups?.value
        if (groups) {
            if(!Array.isArray(groups)) {
                throw new Error('Invalid value for thingGroups. The value must be an array')
            }
    
            if(groups.length > 10){
                throw new Error('A thing can be added to a maximum of 10 thing groups')
            }
        }

        if(!payload.id || !payload.type) {
            throw new Error('id and type are required')
        }



        if(!payload.id.startsWith('urn:ngsi-ld:Thing:')){
            throw new Error('Invalid id. The id must start with urn:ngsi-ld:Thing: following with thingName')
        }

        let tp = get_type(payload)

        if(tp != 'Thing'){
            throw new Error('Invalid type. The value of type must be Thing')
        }

        // Get the thingName from the id
        const thingName = `${payload.id.split(':').slice(-1)}`

        if(!thingName){
            throw new Error('Invalid thingName')
        }
 
        // Create the thing
        const thing_in_registry = await iot.send(
            new CreateThingCommand({ thingName: thingName })
        )

        // if a group is specified
        if(groups && groups.length > 0){
            for await (let group of groups){
                const thing_group = await iot.send(
                    new CreateThingGroupCommand({thingGroupName: group})
                )
                const thing_in_group = await iot.send(
                    new AddThingToThingGroupCommand({thingName: thingName, thingGroupName: group})
                )
            }
        }

        console.log(thing_in_registry)


        payload = concise(payload)

        if (payload['@context']) {
            console.log(`Removed the context:`)
            console.log(payload['@context'])
            delete payload['@context']
        }

        const shadow_payload = {
            state: {
                reported: payload
            }
        }
        let updateThingShadow = await iotdata.send(
            new UpdateThingShadowCommand({payload: JSON.stringify(shadow_payload ), thingName: thingName, shadowName: `${shadow_prefix}-${tp}`})
        )

        let msg = `${thingName} successfully registered`
        if (groups) {
            msg = `${msg} and added to ${JSON.stringify(groups)}`
        }

        const response = {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({message: msg}),
        }
        return response
            
    } catch(e){
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
