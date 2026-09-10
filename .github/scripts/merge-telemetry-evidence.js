#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  merge_telemetry_artifacts
} = require('./telemetry-evidence.js')

const main = () => {
  const [output, ...inputs] = process.argv.slice(2)
  if (output === undefined || inputs.length === 0) {
    throw new Error(
      'usage: node merge-telemetry-evidence.js <output.json> <run.json>...'
    )
  }
  const artifacts = inputs.map(input =>
    JSON.parse(fs.readFileSync(input, 'utf8'))
  )
  const merged = merge_telemetry_artifacts(artifacts)
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`, {
    mode: 0o600
  })
  console.log(`merged telemetry evidence written to ${output}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`Telemetry merge failed: ${error.message}`)
    process.exit(1)
  }
}

module.exports = { main }
