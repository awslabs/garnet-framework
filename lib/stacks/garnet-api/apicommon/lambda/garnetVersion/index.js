const axios = require('axios')
const CONTEXT_BROKER = process.env.CONTEXT_BROKER
const GARNET_VERSION = process.env.GARNET_VERSION
const DNS_CONTEXT_BROKER = process.env.DNS_CONTEXT_BROKER
const GARNET_ARCHITECTURE = process.env.GARNET_ARCHITECTURE

exports.handler = async () => {
    try {
        let context_broker_info
        try {
          const response = await axios.get(
            `http://${DNS_CONTEXT_BROKER}/health`,
            { timeout: 5000 }
          )
          context_broker_info = {
            status: response.status,
            healthy: response.status === 200
          }
        } catch (e) {
          console.log(e)
          context_broker_info = {
            healthy: false,
            error: 'Garnet Broker health check failed'
          }
        }
                
        let result = {
          garnet_version: GARNET_VERSION,
          garnet_architecture: GARNET_ARCHITECTURE,
          context_broker: CONTEXT_BROKER,
          context_broker_info
        }    

        const response = {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(result),
        }
      

        return response

        
    } catch (e) {
        const response = {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({message: e.message}),
        }
        console.log(e)
        return response
    }

}
