const reserved_attributes = [
    "type", 
    "id", 
    "@context", 
    "scope", 
    "observedAt", 
    "createdAt",
    "modifiedAt",
    "deletedAt"
]

const reserved_types = ['Property', 'Relationship', 'GeoProperty', 'DateTime']


exports.get_type = (payload) => {

    if(Array.isArray(payload.type)) {
        let tp = `${payload?.id.split('urn:ngsi-ld:').slice(-1)}`
        tp = `${tp.split(':').slice(0,1)}`
        if(!payload.type.includes(tp)){
            console.log(`${payload.type[0]} - ${tp}`)
            tp = payload.type[0]
        }
        return tp
    }
    if(payload.type.includes('#')){
        payload.type = `${payload.type.split('#').slice(-1)}`
    }
    if(payload.type.includes('/')){
        payload.type = `${payload.type.split('/').slice(-1)}`
    }
    return payload.type
}

exports.log_error = (event, context, message, error) => {
    console.error(JSON.stringify({
        message: message,
        event: event,
        error: error, 
        context: context
    }))
}

exports.recursive_concise = (key, value) => {

    if( typeof value == 'object' && !Array.isArray(value)){
        if(reserved_types.includes(value["type"])) {
            delete value["type"] 
        }
        for (let [skey, svalue] of Object.entries(value)){
                    this.recursive_concise(skey,svalue)
        }
    }
}

exports.transform = (payload) => {
  
    payload.type = this.get_type(payload)

    for (let [key, value] of Object.entries(payload)) {
        if(!reserved_attributes.includes(key)) {
            if( typeof value == "object" && !Array.isArray(value)){
                this.recursive_concise(key, value)
            } else {
                payload[key] = {
                    "value": value
                }
            }
        } 
    }
  
    return payload
}

exports.concise = (payload) => {
    for (let [key, value] of Object.entries(payload)) {
        if(!reserved_attributes.includes(key)) {
    
            if( typeof value == "object" && !Array.isArray(value)){
            this.recursive_concise(key, value)
            } else {
                payload[key] = {
                    "value": value
                }
            }
            
        
        } 
    }

    return payload
}


exports.normalize = (entity) => {
    const excludedKeys = ['@context', 'id', 'type']
    Object.entries(entity).map(([key, value]) => {
        if (!excludedKeys.includes(key) && 
            entity[key].value && !entity[key].type) {
            entity[key].type = "Property"
        }
    })

    return entity
}

exports.compactKeys = (input) => {
    try {
        if (input === null || typeof input !== 'object') return input;
        
        if (Array.isArray(input)) {
            // Here we use compactKeys again for each array element
            return input.map((item) => this.compactKeys(item));
        }
        
        return Object.fromEntries(
            Object.entries(input).map(([key, value]) => [
                key === 'id' || key === 'type' ? key : key.split(/[/#:]/).pop(),
                this.compactKeys(value)
            ])
        );
    } catch (error) {
        console.error('Error while compacting keys:', error);
        return input;
    }
}