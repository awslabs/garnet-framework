exports.handler = async (event, context) => {
    let output = []

    event.records.forEach(record => {
        try {
            let payload = JSON.parse(Buffer.from(record.data, 'base64').toString('utf8'))
            if(!payload.type) {
                console.log(`Type must be present - Record ${record.recordId} dropped`)
                console.log(record)
                output.push({
                    recordId: record.recordId,
                    result: 'Dropped',
                    data: record.data
                })

            } else {
                output.push({
                    recordId: record.recordId, 
                    result: 'Ok', 
                    data: Buffer.from(JSON.stringify(transform(payload)), 'utf-8').toString('base64'),
                    metadata: {"partitionKeys": {"type": get_type(payload)}}
                })
            }
        } catch (e) {
            console.log(e)
            output.push({
                recordId: record.recordId,
                result: 'Dropped',
                data: record.data
            })
        }  
    })

    return { records: output }
}


const get_type = (payload) => {
    if(Array.isArray(payload.type)) {
        let tp = `${payload?.id.split('urn:ngsi-ld:').slice(-1)}`
        tp = `${tp.split(':').slice(0,1)}`
        if(!payload.type.includes(tp)){
            tp = payload.type[0]
        }
        return tp
    }
    return payload.type
}

const recursive_concise = (key, value) => {

    if( typeof value == 'object' && !Array.isArray(value)){
        if(['Property', 'Relationship', 'GeoProperty'].includes(value["type"])) {
            delete value["type"] 
        }
        for (let [skey, svalue] of Object.entries(value)){
                    recursive_concise(skey,svalue)
        }
    }
}
const transform = (payload) => {
    if(!payload?.type) return payload

    if(payload.type.includes('#')){
        payload.type = `${payload.type.split('#').slice(-1)}`
    }
    if(payload.type.includes('/')){
        payload.type = `${payload.type.split('/').slice(-1)}`
    }

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
    return payload
}



