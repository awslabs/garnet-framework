const iot_region = process.env.AWSIOTREGION 
const { IoTDataPlaneClient, PublishCommand } = require("@aws-sdk/client-iot-data-plane")
const iotdata = new IoTDataPlaneClient({region: iot_region})

const { recursive_concise} = require('/opt/nodejs/utils.js') 

exports.handler = async (event) => {
    console.log('Processing SQS records:', event.Records.length);
    
    try {
        for (const msg of event.Records) {
            try {
                console.log('Processing message:', msg.messageId);
                
                const payload = JSON.parse(msg.body)
                
                // Validate payload structure
                if (!payload.subscriptionId) {
                    console.error('Missing subscriptionId in payload:', JSON.stringify(payload));
                    continue;
                }
                
                if (!payload.data || !Array.isArray(payload.data)) {
                    console.error('Missing or invalid data array in payload:', JSON.stringify(payload));
                    continue;
                }
    
                // GET THE SUBSCRIPTION NAME FROM SUBSCRIPTION ID (fix: get actual last element)
                const subName = payload.subscriptionId.split(':').slice(-1)[0]
                console.log('Subscription name:', subName);
    
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
                const topic = `garnet/subscriptions/${subName}`;
                console.log('Publishing to topic:', topic);
                
                const publish = await iotdata.send(
                    new PublishCommand({
                        topic: topic,
                        payload: JSON.stringify(payload)
                    })
                )
                
                console.log('Successfully published message to topic:', topic);
                
            } catch (e) {
                console.error('Error processing message:', msg.messageId, e);
                // Continue processing other messages even if one fails
            }
        }

    } catch (e) {
        console.error('Error processing SQS event:', e);
        throw e; // Re-throw to mark the Lambda as failed
    }
}
