import { createHash } from "node:crypto"

type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue }

const canonical_value = (value: unknown): JsonValue => {
    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
    ) {
        return value
    }
    if (Array.isArray(value)) {
        return value.map(canonical_value)
    }
    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, canonical_value(child)])
        )
    }
    throw new Error("Authorization configuration must be JSON-compatible")
}

export const canonical_json = (value: unknown): string =>
    JSON.stringify(canonical_value(value))

export interface AuthorizationConfiguration {
    environment: Readonly<Record<string, string>>
    digest: string
}

export interface AuthorizationConfigurationProps {
    policies: unknown[]
    bindings: unknown[]
    canonical_bindings: unknown[]
    identity: unknown
}

export const authorization_configuration = (
    props: AuthorizationConfigurationProps
): AuthorizationConfiguration => {
    const policies = canonical_json(props.policies)
    const bindings = canonical_json(props.bindings)
    const digest = createHash("sha256")
        .update(canonical_json({
            version: 1,
            authMode: "oidc+sigv4",
            authorizationMode: "policy",
            policies: props.policies,
            bindings: props.canonical_bindings,
            identity: props.identity
        }))
        .digest("hex")

    return {
        environment: Object.freeze({
            AUTH_MODE: "oidc+sigv4",
            AUTHORIZATION_MODE: "policy",
            AUTHORIZATION_POLICIES: policies,
            AUTHORIZATION_BINDINGS: bindings,
            AUTHORIZATION_CONFIGURATION_DIGEST: `sha256:${digest}`
        }),
        digest: `sha256:${digest}`
    }
}
