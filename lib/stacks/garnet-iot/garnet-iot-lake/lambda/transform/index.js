exports.handler = async (event, context) => {

    const output = event.records.map((record) => ({
        /* This transformation is the "identity" transformation, the data is left intact */
        recordId: record.recordId,
        result: 'Ok',
        data: Buffer.from(JSON.parse(Buffer.from(record.data, 'base64').toString('utf8')).data.map(v => JSON.stringify(transform(v))).join(''), 'utf-8').toString('base64'),
    }))
    console.log(`Processing completed.  Successful records ${output.length}.`)
    return { records: output }
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
    if(!payload?.type) return 
    if(payload?.type?.includes('#')){
        payload.type = `${payload.id.split('#').slice(-1)}`
    }
    if(payload?.type?.includes('/')){
        payload.type = `${payload.id.split('/').slice(-1)}`
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