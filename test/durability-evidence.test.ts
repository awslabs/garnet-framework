const {
  build_durability_artifact,
  mutation_digest,
  parse_cloudtrail_event,
  writer_identifier
} = require("../.github/scripts/durability-evidence.js")

export {}

const PLAN = {
  evidence_id: "release-failover",
  durability_profile: "multi-az-synchronous",
  aws_region: "eu-west-3",
  aws_account: "111111111111",
  image: `public.ecr.aws/garnet/broker@sha256:${"a".repeat(64)}`,
  database_cluster: "garnet-broker-aurora"
}

const cluster = (writer: string, status = "available") => ({
  DBClusterIdentifier: PLAN.database_cluster,
  Status: status,
  DBClusterMembers: [{
    DBInstanceIdentifier: writer,
    IsClusterWriter: true
  }, {
    DBInstanceIdentifier:
      writer === "garnet-a" ? "garnet-b" : "garnet-a",
    IsClusterWriter: false
  }]
})

const cloudtrail_event = {
  EventId: "event-123",
  CloudTrailEvent: JSON.stringify({
    eventTime: "2026-09-10T05:05:00Z",
    eventName: "FailoverDBCluster",
    awsRegion: PLAN.aws_region,
    recipientAccountId: PLAN.aws_account,
    requestParameters: {
      dBClusterIdentifier: PLAN.database_cluster
    }
  })
}

describe("AWS durability evidence", () => {
  it("uses the broker's canonical mutation digest", () => {
    expect(mutation_digest([
      {
        mutationId: "mutation-before",
        entityId: "urn:ngsi-ld:Evidence:before",
        expectedValue: "before-value"
      },
      {
        mutationId: "mutation-after",
        entityId: "urn:ngsi-ld:Evidence:after",
        expectedValue: "after-value"
      }
    ])).toBe(
      "2bb70c2b6876eff505a4b4e11f6a8ce5" +
      "29dc5d3e5e2640e64f226cefa16415a3"
    )
  })

  it("builds schema-2 proof from RDS, CloudTrail, and API reconciliation", () => {
    const mutations = [{
      mutationId: "mutation-before",
      entityId: "urn:ngsi-ld:Evidence:before",
      expectedValue: "before-value",
      observedValue: "before-value",
      attemptCount: 1,
      acknowledgedAt: "2026-09-10T05:04:30Z",
      verifiedAt: "2026-09-10T05:07:00Z"
    }, {
      mutationId: "mutation-after",
      entityId: "urn:ngsi-ld:Evidence:after",
      expectedValue: "after-value",
      observedValue: "after-value",
      attemptCount: 2,
      acknowledgedAt: "2026-09-10T05:06:30Z",
      verifiedAt: "2026-09-10T05:07:30Z"
    }]
    const attempts = [{
      attemptId: "attempt-before",
      mutationId: "mutation-before",
      startedAt: "2026-09-10T05:04:29Z",
      completedAt: "2026-09-10T05:04:30Z",
      outcome: "acknowledged",
      status: 204
    }, {
      attemptId: "attempt-during",
      mutationId: "mutation-after",
      startedAt: "2026-09-10T05:05:20Z",
      completedAt: "2026-09-10T05:05:30Z",
      outcome: "ambiguous"
    }, {
      attemptId: "attempt-after",
      mutationId: "mutation-after",
      startedAt: "2026-09-10T05:06:29Z",
      completedAt: "2026-09-10T05:06:30Z",
      outcome: "acknowledged",
      status: 204
    }]

    const artifact = build_durability_artifact({
      plan: PLAN,
      started_at: "2026-09-10T05:00:00Z",
      failure_injected_at: "2026-09-10T05:05:00Z",
      recovered_at: "2026-09-10T05:06:30Z",
      completed_at: "2026-09-10T05:10:00Z",
      collected_at: "2026-09-10T05:11:00Z",
      caller_identity: { Account: PLAN.aws_account },
      cloudtrail_event,
      fault_response: { DBCluster: cluster("garnet-a", "failing-over") },
      before_cluster: cluster("garnet-a"),
      requested_cluster: cluster("garnet-a", "failing-over"),
      after_cluster: cluster("garnet-b"),
      before_observed_at: "2026-09-10T05:04:55Z",
      fault_observed_at: "2026-09-10T05:05:05Z",
      after_observed_at: "2026-09-10T05:07:35Z",
      mutations,
      attempts
    })

    expect(artifact).toMatchObject({
      schemaVersion: 2,
      evidenceId: "release-failover",
      recovered: true,
      dataLoss: false,
      collection: {
        accountId: PLAN.aws_account,
        fault: {
          operation: "FailoverDBCluster",
          executionId: "event-123",
          target: PLAN.database_cluster
        },
        mutations,
        attempts
      }
    })
    expect(artifact.collection.observations.map(
      (observation: any) => observation.phase
    )).toEqual([
      "before-fault",
      "fault-requested",
      "after-recovery"
    ])
    expect(writer_identifier(cluster("garnet-b"))).toBe("garnet-b")
  })

  it("rejects evidence from another account or cluster", () => {
    expect(() => parse_cloudtrail_event({
      ...cloudtrail_event,
      CloudTrailEvent: JSON.stringify({
        eventName: "FailoverDBCluster",
        awsRegion: PLAN.aws_region,
        recipientAccountId: PLAN.aws_account,
        requestParameters: { dBClusterIdentifier: "another-cluster" }
      })
    }, PLAN)).toThrow(
      "CloudTrail event does not match this Aurora failover"
    )

    expect(() => build_durability_artifact({
      plan: PLAN,
      caller_identity: { Account: "222222222222" }
    })).toThrow(
      "AWS caller account does not match the deployed Garnet account"
    )
  })
})
