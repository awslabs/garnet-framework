const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const s3 = new S3Client()
BUCKET_NAME = process.env.BUCKET_NAME

exports.handler = async (event) => {
    console.log(event)
    let request_type = event['RequestType']
    if (request_type=='Create' || request_type == 'Update') {

        try {
            await s3.send(
                new CreateBucketCommand({
                    Bucket: BUCKET_NAME
                })
            )
        } catch (e) {
            console.log(e.message)
        }
        return true
    }
}