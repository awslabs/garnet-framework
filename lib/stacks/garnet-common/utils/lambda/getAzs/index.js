const {
    EC2Client,
    DescribeAvailabilityZonesCommand
} = require("@aws-sdk/client-ec2")
const ec2 = new EC2Client({apiVersion: '2016-11-15'})
const compatible_azs = JSON.parse(process.env.COMPATIBLE_AZS)

exports.handler = async (event) => {
    console.log(event)
    let request_type = event['RequestType'].toLowerCase()
    if (request_type=='create' || request_type == 'update') {


        const {AvailabilityZones} = await ec2.send(
            new DescribeAvailabilityZonesCommand({})
        )

        const final_azs = AvailabilityZones
            .filter((az) => compatible_azs.includes(az.ZoneId))
            .map((az) => az.ZoneName)
        if (final_azs.length < 2) {
            throw new Error(
                "Garnet requires two supported availability zones"
            )
        }
        console.log({final_azs})
        
        return {
            Data: {
                az1: final_azs[0],
                az2: final_azs[final_azs.length - 1]
            }
        }
    }
}
