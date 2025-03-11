const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const URL_SMART_DATA_MODEL = process.env.URL_SMART_DATA_MODEL
const axios = require('axios')
const {get_type, log_error, normalize} = require('/opt/nodejs/utils.js') 




exports.handler = async (event, context) => {

    try {
        let entities = []

        for await (let msg of event.Records){
            let payload = JSON.parse(msg.body)
            if(!payload.id || !payload.type){
                throw new Error('Invalid entity: id or type is missing')
            }

            if (payload['@context']) {
                console.log(`Removed the context:`)
                console.log(payload['@context'])
                delete payload['@context']
            }
            payload = normalize(payload)
            entities = entities.concat(payload)
        }
        const headers = {
            'Content-Type': 'application/json',
            'Link': `<${URL_SMART_DATA_MODEL}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
            }
        try {
           let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update`, entities, {headers: headers}) 
            //let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert`, entities, {headers: headers}) 
            console.log(res)
        } catch (e) {
            log_error(event,context, e.message, e)  
        }
    } catch (e) {
        log_error(event,context, e.message, e)
    }
}


