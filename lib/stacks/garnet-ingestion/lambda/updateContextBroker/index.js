const dns_broker = `http://${process.env.DNS_CONTEXT_BROKER}/ngsi-ld/v1`
const axios = require('axios')
const {log_error, normalize} = require('/opt/nodejs/utils.js')

const client = axios.create({
    timeout: 20000,
    // Keep sockets warm across invocations instead of a new TCP handshake per upsert
    httpAgent: new (require('http').Agent)({ keepAlive: true, maxSockets: 50 })
})

exports.handler = async (event, context) => {

    // Messages whose entity the broker refused. Reported back to SQS so they are
    // retried or dead-lettered instead of being silently dropped.
    const failures = []

    const with_context = []
    const without_context = []

    for (const msg of event.Records){
        try {
            let payload = JSON.parse(msg.body)
            if(!payload.id || !payload.type){
                throw new Error('Invalid entity: id or type is missing')
            }
            payload = normalize(payload)

            if(payload["@context"]){
                with_context.push({ id: msg.messageId, payload })
            } else {
                without_context.push({ id: msg.messageId, payload })
            }
        } catch (e) {
            // Malformed entity: it will never succeed, so send it straight to the DLQ
            log_error(msg, context, e.message, e)
            failures.push({ itemIdentifier: msg.messageId })
        }
    }

    const upsert = async (batch, contentType) => {
        if(batch.length == 0) return
        try {
            let {data: res} = await client.post(
                `${dns_broker}/entityOperations/upsert?options=update`,
                batch.map(b => b.payload),
                {headers: {'Content-Type': contentType}}
            )
            console.log(res)
        } catch (e) {
            log_error(event, context, e.message, e)
            // The broker was unreachable or errored: retry the whole sub-batch
            batch.forEach(b => failures.push({ itemIdentifier: b.id }))
        }
    }

    await Promise.all([
        upsert(with_context, 'application/ld+json'),
        upsert(without_context, 'application/json')
    ])

    return { batchItemFailures: failures }
}
