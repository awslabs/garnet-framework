const {get_type, log_error, recursive_concise, transform} = require('/opt/nodejs/utils.js') 


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

