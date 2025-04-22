const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const axios = require('axios')
const {get_type, log_error, normalize} = require('/opt/nodejs/utils.js') 

exports.handler = async (event, context) => {

    try {

        let entities_with_context = []
        let entities_without_context = []

        for await (let msg of event.Records){
            let payload = JSON.parse(msg.body)
            if(!payload.id || !payload.type){
                throw new Error('Invalid entity: id or type is missing')
            }
            payload = normalize(payload)

            if(payload["@context"]){
                entities_with_context = entities_with_context.concat(payload)
            } else {
                entities_without_context = entities_without_context.concat(payload)
            }
            
        }

        try {
            if(entities_with_context.length > 0){
                const headers= {
                    'Content-Type': 'application/ld+json'
                }
                let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update`, entities_with_context, {headers: headers}) 
                console.log("with context")
                console.log(res)
            } 
        } catch (e) {
            log_error(event,context, e.message, e)  
        }

        try {

            if(entities_without_context.length > 0){
                const headers= {
                    'Content-Type': 'application/json'
                }
                let {data: res} = await axios.post(`${dns_broker}/entityOperations/upsert?options=update`, entities_without_context, {headers: headers}) 
                console.log("without context")
                console.log(res)
            }
            
        } catch (e) {
            log_error(event,context, e.message, e)  
        }
    } catch (e) {
        log_error(event,context, e.message, e)
    }
}


