export interface GarnetServiceCapacity {
    cpu: number
    memory_mib: number
    min_tasks: number
    max_tasks: number
    database_pool: number
    reader_database_pool?: number
}

export const GARNET_API_REQUESTS_PER_TARGET_MINUTE = 15_000

export const GARNET_SERVICE_CAPACITY = {
    api: {
        cpu: 2048,
        memory_mib: 4096,
        min_tasks: 2,
        max_tasks: 64,
        database_pool: 16,
        reader_database_pool: 8
    },
    federation: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 2,
        max_tasks: 8,
        database_pool: 4
    },
    relay: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 4
    },
    matcher: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 16,
        database_pool: 8
    },
    sink: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 4
    },
    delivery: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 32,
        database_pool: 8
    },
    scheduler: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 4
    },
    reconciler: {
        cpu: 512,
        memory_mib: 1024,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 4
    },
    snapshot: {
        cpu: 1024,
        memory_mib: 2048,
        min_tasks: 1,
        max_tasks: 8,
        database_pool: 8
    }
} as const satisfies Record<string, GarnetServiceCapacity>
