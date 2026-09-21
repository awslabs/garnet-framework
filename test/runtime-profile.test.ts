import {
  garnet_service_capacity,
  garnet_writer_connection_budget
} from "../lib/stacks/garnet-broker/runtime/runtime-profile"

describe("Garnet runtime database capacity", () => {
  it("bounds worst-case writer pools for a 4 ACU Aurora cluster", () => {
    const capacity = garnet_service_capacity(4)
    const worst_case_connections = Object.values(capacity)
      .reduce(
        (total, service) =>
          total + service.max_tasks * service.database_pool,
        0
      )

    expect(worst_case_connections).toBeLessThanOrEqual(
      garnet_writer_connection_budget(4)
    )
    expect(worst_case_connections).toBe(120)
    expect(capacity.api).toMatchObject({
      min_tasks: 2,
      max_tasks: 15,
      database_pool: 4,
      reader_database_pool: 2
    })
  })

  it("keeps metric-scaled services scalable at the minimum budget", () => {
    const capacity = garnet_service_capacity(1)
    const worst_case_connections = Object.values(capacity)
      .reduce(
        (total, service) =>
          total + service.max_tasks * service.database_pool,
        0
      )

    expect(worst_case_connections).toBeLessThanOrEqual(
      garnet_writer_connection_budget(1)
    )
    for (const service of [
      capacity.api,
      capacity.matcher,
      capacity.delivery,
      capacity.reconciler,
      capacity.snapshot
    ]) {
      expect(service.max_tasks).toBeGreaterThan(service.min_tasks)
    }
  })

  it("retains the service scale ceilings for a large cluster", () => {
    const capacity = garnet_service_capacity(128)

    expect(capacity.api.max_tasks).toBe(64)
    expect(capacity.delivery.max_tasks).toBe(32)
    expect(capacity.matcher.max_tasks).toBe(16)
  })

  it("rejects non-positive Aurora capacity", () => {
    expect(() => garnet_service_capacity(0)).toThrow(
      "Aurora max capacity must be positive"
    )
  })
})
