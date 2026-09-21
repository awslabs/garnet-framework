export interface GarnetServiceCapacity {
    cpu: number
    memory_mib: number
    min_tasks: number
    max_tasks: number
    database_pool: number
    reader_database_pool?: number
}

export const GARNET_API_REQUESTS_PER_TARGET_MINUTE = 60_000

interface GarnetServiceProfile extends GarnetServiceCapacity {
    writer_connection_share: number
}

const GARNET_SERVICE_PROFILE = {
    api: {
        cpu: 2048,
        memory_mib: 4096,
        min_tasks: 2,
        max_tasks: 64,
        database_pool: 4,
        reader_database_pool: 2,
        writer_connection_share: 0.47
    },
    federation: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 2,
        max_tasks: 8,
        database_pool: 2,
        writer_connection_share: 0.05
    },
    matcher: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 16,
        database_pool: 4,
        writer_connection_share: 0.10
    },
    sink: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 2,
        writer_connection_share: 0.05
    },
    delivery: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 32,
        database_pool: 4,
        writer_connection_share: 0.15
    },
    scheduler: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 2,
        writer_connection_share: 0.03
    },
    reconciler: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 2,
        writer_connection_share: 0.05
    },
    snapshot: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 4,
        writer_connection_share: 0.10
    }
} as const satisfies Record<string, GarnetServiceProfile>

export type GarnetServiceName = keyof typeof GARNET_SERVICE_PROFILE

const WRITER_CONNECTIONS_PER_ACU = 40
const WRITER_CONNECTION_RESERVE = 0.20
const MINIMUM_WRITER_CONNECTION_BUDGET = 80

export const garnet_writer_connection_budget = (
    aurora_max_capacity: number
): number => {
    if (
        !Number.isFinite(aurora_max_capacity) ||
        aurora_max_capacity <= 0
    ) {
        throw new Error("Aurora max capacity must be positive")
    }
    return Math.max(
        MINIMUM_WRITER_CONNECTION_BUDGET,
        Math.floor(
            aurora_max_capacity *
            WRITER_CONNECTIONS_PER_ACU *
            (1 - WRITER_CONNECTION_RESERVE)
        )
    )
}

export const garnet_service_capacity = (
    aurora_max_capacity: number
): Record<GarnetServiceName, GarnetServiceCapacity> => {
    const writer_budget =
        garnet_writer_connection_budget(aurora_max_capacity)
    return Object.fromEntries(
        Object.entries(GARNET_SERVICE_PROFILE).map(([name, profile]) => {
            const allocated_connections = Math.floor(
                writer_budget * profile.writer_connection_share
            )
            const max_tasks = Math.min(
                profile.max_tasks,
                Math.max(
                    profile.min_tasks,
                    Math.floor(
                        allocated_connections / profile.database_pool
                    )
                )
            )
            const {
                writer_connection_share: _writer_connection_share,
                ...capacity
            } = profile
            return [name, { ...capacity, max_tasks }]
        })
    ) as Record<GarnetServiceName, GarnetServiceCapacity>
}

export const GARNET_SERVICE_CAPACITY =
    garnet_service_capacity(128)
