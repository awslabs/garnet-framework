const { SQSClient, CreateQueueCommand, GetQueueUrlCommand } = require("@aws-sdk/client-sqs");
const sqs = new SQSClient();
const QUEUE_NAME = process.env.QUEUE_NAME;

const checkQueueExists = async (queueName) => {
    try {
        await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
        console.log(`Queue ${queueName} already exists`)
        return true
    } catch (error) {
        console.log(error)
        if (error.name === 'QueueDoesNotExist') {
            console.log(`Queue ${queueName} does not exist`);
            return false;
        }

        // For other errors, we might want to throw them
        // throw error;
    }
};

const createQueueIfNotExists = async (queueName) => {
    const exists = await checkQueueExists(queueName)
    if (!exists) {
        try {
            console.log(`Creating queue ${queueName}`);
            const response = await sqs.send(new CreateQueueCommand({ 
                QueueName: queueName
            }))
            console.log(`Successfully created queue ${queueName} with URL: ${response.QueueUrl}`);
            return response.QueueUrl;
        } catch (error) {
            // QueueAlreadyExists - if queue was created between our check and create
            if (error.name === 'QueueAlreadyExists') {
                console.log(`Queue ${queueName} already exists (caught in create)`);
                // Get the queue URL
                const response = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
                return response.QueueUrl;
            }
            throw error;
        }
    } else {
        // Queue exists, get its URL
        const response = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
        return response.QueueUrl;
    }
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    const requestType = event['RequestType'].toLowerCase();

    if (requestType === 'create' || requestType === 'update') {
        try {
            // Create main queue if it doesn't exist
            const queueUrl = await createQueueIfNotExists(QUEUE_NAME);
            console.log(queueUrl)
            return {
                Data: {
                    queue_name: QUEUE_NAME,
                    queue_url: queueUrl
                }
            };
        } catch (error) {
            console.error('Error in handler:', error);
            throw error;
        }
    } else if (requestType === 'delete') {
        // Don't delete the queue, just return success
        return {
            Data: {
                queue_name: QUEUE_NAME
            }
        };
    }
}
