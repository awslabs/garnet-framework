import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { Rate } from 'k6/metrics';

const requests = new Counter('requests');
const successRate = new Rate('success_rate');

// Global tracking for RPS
let startTime = Date.now();
let reqCount = 0;

export const options = {
  scenarios: {
    high_load: {
      executor: 'constant-arrival-rate',
      rate: 100,         // Start with 100 RPS
      timeUnit: '1s',    
      duration: '1m',    // Run for 1 minute
      preAllocatedVUs: 100,
      maxVUs: 1000,
    },
  },
};

export default function () {
  reqCount++;
  const elapsed = (Date.now() - startTime) / 1000;
  
  const randomId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  const payload = {
    "id": `urn:ngsi-ld:Vehicle:${randomId}`,
    "type": "Vehicle",
    "speed": {
      "type": "Property",
      "value": Math.floor(Math.random() * 100)
    },
    "@context": ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
  };

  const res = http.post(
    `${__ENV.GARNET_ENDPOINT}/ngsi-ld/v1/entities/`, 
    JSON.stringify(payload), 
    {
      headers: { 'Content-Type': 'application/ld+json' },
    }
  );

  // Track request
  requests.add(1);
  successRate.add(res.status === 201);

  // Log RPS every second
  if (elapsed >= 1) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      requests_per_second: reqCount / elapsed,
      total_requests: requests.value,
      success_rate: successRate.value,
      last_response_status: res.status,
      last_response_time: res.timings.duration
    }));
    
    // Reset counters
    startTime = Date.now();
    reqCount = 0;
  }

  check(res, {
    'status is 201': (r) => r.status === 201,
  });
}
