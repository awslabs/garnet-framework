const iot_region = process.env.AWSIOTREGION
const { IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane")
const iotdata = new IoTDataPlaneClient({region: iot_region})

const { recursive_concise} = require('/opt/nodejs/utils.js')

const process_record = async (msg) => {
    const payload = JSON.parse(msg.body)

    // Validate payload structure. A malformed notification will never succeed,
    // so it is logged and dropped rather than retried forever.
    if (!payload.subscriptionId) {
        console.error('Missing subscriptionId in payload:', JSON.stringify(payload))
        return { dropped: true }
    }

    if (!payload.data || !Array.isArray(payload.data)) {
        console.error('Missing or invalid data array in payload:', JSON.stringify(payload))
        return { dropped: true }
    }

    // GET THE SUBSCRIPTION NAME FROM SUBSCRIPTION ID
    const subName = payload.subscriptionId.split(':').slice(-1)[0]

    // Transform payload data
    payload.data.forEach(entity => {
        for (let [key, value] of Object.entries(entity)) {
            if(!['type', 'id', '@context'].includes(key)) {
                if( typeof value == 'object' && !Array.isArray(value)){
                    recursive_concise(key, value)
                } else {
                    entity[key] = {
                        value: value
                    }
                }
            }
        }
    })

    // Publish to IoT MQTT topic
    const topic = `garnet/subscriptions/${subName}`

    await iotdata.send(
        new PublishCommand({
            topic: topic,
            payload: JSON.stringify(payload)
        })
    )

    return { dropped: false }
}

exports.handler = async (event) => {
    console.log('Processing SQS records:', event.Records.length)

    // Notifications are independent, so publish them concurrently rather than
    // waiting for each MQTT round trip in turn.
    const results = await Promise.allSettled(event.Records.map(process_record))

    // Anything that threw was a transient failure (throttling, IoT unavailable).
    // Report it so SQS redelivers just that message instead of the whole batch.
    const batchItemFailures = []
    results.forEach((result, i) => {
        if (result.status == 'rejected') {
            console.error('Error processing message:', event.Records[i].messageId, result.reason)
            batchItemFailures.push({ itemIdentifier: event.Records[i].messageId })
        }
    })

    return { batchItemFailures }
}
