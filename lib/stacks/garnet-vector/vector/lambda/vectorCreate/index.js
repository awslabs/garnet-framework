const { S3VectorsClient, CreateVectorBucketCommand, GetVectorBucketCommand} = require("@aws-sdk/client-s3")
const s3Vector = new S3VectorsClient()
const VECTOR_BUCKET_NAME = process.env.VECTOR_BUCKET_NAME

const checkVectorBucketExists = async (vectorBucketName) => {
    try {
        await s3Vector.send(new GetVectorBucketCommand({ vectorBucketName: vectorBucketName }));
        console.log(`Vector Bucket ${vectorBucketName} already exists`)
        return true
    } catch (error) {
        console.log(error)
        if (error.$metadata && error.$metadata.httpStatusCode === 404) {
            console.log(`Bucket ${bucketName} does not exist`);
            return false;
        }

        // throw error;
    }
}

const createVectorBucketIfNotExists = async (vectorBucketName) => {
    const exists = await checkVectorBucketExists(vectorBucketName)
    if (!exists) {
        try {
            console.log(`Creating vectorbucket ${vectorBucketName}`);
            await s3.send(new CreateVectorBucketCommand({ vectorBucketName: vectorBucketName }));
            console.log(`Successfully created vector bucket ${vectorBucketName}`);
        } catch (error) {
            if (!error.name.includes('ConflictException')) {
                throw error;
            }
            console.log(`Bucket ${vectorBucketName} already exists (caught in create)`);
        }
    }
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    const requestType = event['RequestType'].toLowerCase();

    if (requestType === 'create' || requestType === 'update') {
        try {
            // Create vector bucket if it doesn't exist
            await createVectorBucketIfNotExists(VECTOR_BUCKET_NAME);

            return {
                Data: {
                    vector_bucket_name: VECTOR_BUCKET_NAME
                }
            }
        } catch (error) {
            console.error('Error in handler:', error);
            throw error;
        }
    } else if (requestType === 'delete') {
        // Don't delete the vector, just return success
        return {
            Data: {
                vector_bucket_name: VECTOR_BUCKET_NAME
            }
        };
    }
}


