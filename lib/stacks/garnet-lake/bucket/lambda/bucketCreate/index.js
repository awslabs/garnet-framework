const { S3Client, CreateBucketCommand, PutBucketMetricsConfigurationCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client();
const BUCKET_NAME = process.env.BUCKET_NAME;
const BUCKET_ATHENA_NAME = process.env.BUCKET_ATHENA_NAME;

const checkBucketExists = async (bucketName) => {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
        console.log(`Bucket ${bucketName} already exists`)
        return true
    } catch (error) {
        console.log(error)
        if (error.$metadata && error.$metadata.httpStatusCode === 404) {
            console.log(`Bucket ${bucketName} does not exist`);
            return false;
        }

        // throw error;
    }
};

const createBucketIfNotExists = async (bucketName) => {
    const exists = await checkBucketExists(bucketName)
    if (!exists) {
        try {
            console.log(`Creating bucket ${bucketName}`);
            await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
            console.log(`Successfully created bucket ${bucketName}`);
        } catch (error) {
            // BucketAlreadyOwnedByYou
            // BucketAlreadyExists
            if (!error.name.includes('BucketAlready')) {
                throw error;
            }
            console.log(`Bucket ${bucketName} already exists (caught in create)`);
        }
    }
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    const requestType = event['RequestType'].toLowerCase();

    if (requestType === 'create' || requestType === 'update') {
        try {
            // Create main bucket if it doesn't exist
            await createBucketIfNotExists(BUCKET_NAME);

            // Create Athena bucket if it doesn't exist
            await createBucketIfNotExists(BUCKET_ATHENA_NAME);

            // Set up metrics configuration
            try {
                console.log("Setting up metrics configuration");
                await s3.send(
                    new PutBucketMetricsConfigurationCommand({
                        Bucket: BUCKET_NAME,
                        Id: "GarnetBucketMetric",
                        MetricsConfiguration: {
                            Id: "GarnetBucketConfigmMetric"
                        }
                    })
                );
                console.log("Successfully set up metrics configuration");
            } catch (error) {
                console.log("Error setting up metrics configuration:", error.message);
            }

            return {
                Data: {
                    bucket_name: BUCKET_NAME
                }
            };
        } catch (error) {
            console.error('Error in handler:', error);
            throw error;
        }
    } else if (requestType === 'delete') {
        // Don't delete the bucket, just return success
        return {
            Data: {
                bucket_name: BUCKET_NAME
            }
        };
    }
}


