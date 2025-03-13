const { S3Client, HeadBucketCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client()
const BUCKET_NAME = process.env.BUCKET_NAME
const BUCKET_ATHENA_NAME = process.env.BUCKET_ATHENA_NAME

const checkBucketExists = async (bucketName) => {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: bucketName }))
        return true
    } catch (error) {
        if (error.$metadata && error.$metadata.httpStatusCode === 404) {
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
        const mainBucketExists = await checkBucketExists(BUCKET_NAME)
        const athenaBucketExists = await checkBucketExists(BUCKET_ATHENA_NAME)
        return { 
            IsComplete: mainBucketExists && athenaBucketExists 
        }
    } catch (error) {
        console.error('Error in isComplete handler:', error);
        throw error
    }
};