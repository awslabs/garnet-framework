const { SQSClient, GetQueueUrlCommand } = require("@aws-sdk/client-sqs");
const sqs = new SQSClient()
const QUEUE_NAME = process.env.QUEUE_NAME


const checkQueueExists = async (queueName) => {
    try {
        await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }))
        return true
    } catch (error) {
        if (error.name === 'QueueDoesNotExist') {
            return false
        }
        throw error
    }
};

exports.handler = async (event) => {
    console.log('IsComplete Check Event:', JSON.stringify(event, null, 2))
    
    const requestType = event.RequestType.toLowerCase()
    
    if (requestType === 'delete') {
        return { IsComplete: true }
    }

    try {
        const queueExists = await checkQueueExists(QUEUE_NAME)
        return { 
            IsComplete: queueExists 
        }
    } catch (error) {
        console.error('Error in isComplete handler:', error);
        throw error
    }
};
