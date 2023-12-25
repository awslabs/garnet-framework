const { RDSClient, CreateDBParameterGroupCommand, ModifyDBParameterGroupCommand, DeleteDBParameterGroupCommand } = require("@aws-sdk/client-rds")
const rds = new RDSClient({})
let DBParameterGroupName = process.env.DBParameterGroupName
let DBParameterGroupFamily = process.env.DBParameterGroupFamily
let Description = `${DBParameterGroupName} - ${DBParameterGroupFamily}`

exports.handler = async (event) => {
    console.log(event)
    let request_type = event['RequestType'].toLowerCase()
    if (request_type=='create' || request_type == 'update') {

        try {
         console.log(`Create Parameter group ${DBParameterGroupName}`) 
         let cmd =  await rds.send(
            new CreateDBParameterGroupCommand({
                DBParameterGroupName, 
                DBParameterGroupFamily,
                Description
            })
           )
        console.log(cmd)
        } catch (e) {
            console.log(e)
        }

        try {
            console.log(`Update ${DBParameterGroupName} to update rds.force_ssl to 0`)
           let cmd = await rds.send(
            new ModifyDBParameterGroupCommand({
                DBParameterGroupName, 
                Parameters: [ 
                    { // Parameter
                        ParameterName: "rds.force_ssl",
                        ParameterValue: "0",
                        ApplyMethod: "immediate"
                    }
                ]
            })
           ) 
           console.log(cmd)
        } catch (e) {
            console.log(e)
        }
    
        return {
            Data: {
                name: DBParameterGroupName
            }
        }
    }  else   if (request_type=='delete') {

        try {
            console.log(`Delete ${DBParameterGroupName}`)
         let cmd =   await rds.send(
            new DeleteDBParameterGroupCommand({
                DBParameterGroupName   
            })
           )
           console.log(cmd) 
        } catch (e) {
            console.log(e)
        }
    
        return {
            Data: {
                name: DBParameterGroupName
            }
        }
    }

}