"use strict"

const { Buffer } = require("node:buffer")
const { URL } = require("node:url")
const { Sha256 } = require("@aws-crypto/sha256-js")
const {
  defaultProvider
} = require("@aws-sdk/credential-provider-node")
const { HttpRequest } = require("@smithy/protocol-http")
const { SignatureV4 } = require("@smithy/signature-v4")

const SERVER_ID_HEADER = "x-garnet-server-id"
const PROOF_TTL_SECONDS = 60

const required = (env, name) => {
  const value = (env[name] || "").trim()
  if (value === "") throw new Error(`${name} is required`)
  return value
}

const presigned_url = (request) => {
  const port = request.port === undefined ? "" : `:${request.port}`
  const url = new URL(
    `${request.protocol}//${request.hostname}${port}${request.path}`
  )
  for (const [name, raw] of Object.entries(request.query || {})) {
    if (raw === undefined || raw === null) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      url.searchParams.append(name, value ?? "")
    }
  }
  return url.href
}

const create_broker_authorization = (
  env = process.env,
  dependencies = {}
) => {
  const region = required(env, "AWS_REGION")
  const server_id = required(env, "GARNET_SIGV4_SERVER_ID")
  const endpoint = new URL(required(env, "GARNET_STS_ENDPOINT"))
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error("GARNET_STS_ENDPOINT must be an exact HTTPS origin")
  }
  const signer = dependencies.signer || new SignatureV4({
    applyChecksum: false,
    credentials:
      dependencies.credentials || defaultProvider(),
    region,
    service: "sts",
    sha256: Sha256
  })
  const now = dependencies.now || Date.now
  let cached
  let in_flight

  return async () => {
    if (cached !== undefined && cached.refresh_at > now()) {
      return cached.value
    }
    if (in_flight !== undefined) return in_flight
    const pending = signer.presign(new HttpRequest({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      ...(endpoint.port === ""
        ? {}
        : { port: Number(endpoint.port) }),
      method: "GET",
      path: "/",
      headers: {
        host: endpoint.host,
        [SERVER_ID_HEADER]: server_id
      },
      query: {
        Action: "GetCallerIdentity",
        Version: "2011-06-15"
      }
    }), {
      expiresIn: PROOF_TTL_SECONDS,
      unhoistableHeaders: new Set([SERVER_ID_HEADER])
    }).then((signed) => {
      const proof = Buffer.from(
        presigned_url(signed)
      ).toString("base64url")
      const value = `SigV4-STS ${proof}`
      cached = {
        value,
        refresh_at: now() + PROOF_TTL_SECONDS * 800
      }
      return value
    })
    in_flight = pending
    try {
      return await pending
    } finally {
      if (in_flight === pending) in_flight = undefined
    }
  }
}

const create_broker_headers = (
  env = process.env,
  dependencies = {}
) => {
  const configured_tenant = required(env, "GARNET_TENANT")
  if (/[\0\r\n]/.test(configured_tenant)) {
    throw new Error("GARNET_TENANT must be a safe header value")
  }
  const authorization =
    dependencies.authorization ||
    create_broker_authorization(env, dependencies)

  return async ({
    content_type,
    tenant = configured_tenant
  } = {}) => {
    if (tenant !== configured_tenant) {
      throw new Error(
        `workload is not bound to tenant ${JSON.stringify(tenant)}`
      )
    }
    return {
      Authorization: await authorization(),
      ...(content_type === undefined
        ? {}
        : { "Content-Type": content_type }),
      ...(tenant === "default"
        ? {}
        : { "NGSILD-Tenant": tenant })
    }
  }
}

module.exports = {
  create_broker_authorization,
  create_broker_headers
}
