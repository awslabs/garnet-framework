# Durable write scaling deployment findings — 2026-09-26

## Scope

This Framework continuation deploys the Broker candidate documented in
`DURABLE-WRITE-SCALING-DESIGN-FINDINGS-2026-09-26.md` in the Garnet Broker
repository. It does not change ingestion connectors or third-party payload
handling.

## Decisions

### FWD-D001 — Keep the write candidate API-task-local and opt-in

Only `/garnet-broker` API containers receive the Entity mutation batch
settings. Migration, federation, matcher, delivery, scheduler, reconciler,
snapshot, and lake tasks retain their existing database and execution paths.

### FWD-D002 — Match worker count to process-local writer connections

Each API task has eight writer connections and runs two Broker processes.
Each process therefore receives four writer connections and four set-based
mutation workers. The construct rejects a worker count above the process-local
pool.

### FWD-D003 — Match full batch concurrency to HTTP admission

Each API task admits 512 active requests, split into 256 per Broker process.
Four workers times 64 requests equals that process-local admission ceiling.
The construct rejects settings whose full worker batches exceed the available
process-local active-request budget.

### FWD-D004 — Bound queueing and expose only aggregate diagnostics

The process-local queue is capped at 1,024 entries. Canary diagnostics emit
only aggregate batch sizes, execution durations, queue depth, active-key
counts, and transaction counts. They never log Tenant names, Entity ids,
payloads, credentials, or per-request outcomes.

### FWD-D005 — Preserve the deployment progression

The image remains digest-pinned and blue/green guarded. Run 3,000/s first,
then 5,000/s, 7,000/s, and 10,000/s only after the prior exact reconciliation,
error, health, and latency gate passes.

### FWD-D006 — Validate the exact synthesized task contract before deployment

The Framework candidate passed TypeScript typecheck, lint, and 28 focused
runtime and stack tests. The synthesized API container assertion requires all
five batching environment values, while the construct rejects settings that
exceed the Broker's code bounds or the task's process-local database and HTTP
budgets. No non-API service receives the batching settings.

## Findings

### FWD-F001 — The first canary image is source-bound and scan-clean

Broker commit `a5913d92cdc8d71ac5b31a01809dcef25c50e28d` produced the
Linux ARM64 OCI manifest
`sha256:c2fe412193a3dcfb812d7aae8c8e7d54e9bc8434097d6b67ab3fd1f6743d3341`.
It was pushed under immutable tag
`qual-v72-a5913d92cdc8-20260926t084209z`. The ECR basic scan completed
with zero findings. Build metadata records the exact Git revision and pinned
Bun and distroless parent digests.

### FWD-F002 — The live change set is limited to the Broker release

The 2026-09-26 live CDK diff changes only the Garnet Broker nested stack and
the root image output. Every Broker role advances to the same immutable image,
the migration custom resource receives the new release id, and only the API
task definition receives the five Entity mutation batching variables. Lake,
common, ingestion, API-front-door, and operations nested stacks have no
differences.

### FWD-D007 — Apply temporary write-side qualification capacity only

For the comparative mutation matrix, temporarily set API capacity to 40 tasks,
the on-demand Graviton group to 32 fixed hosts, and Aurora to fixed 256 ACU.
Retain one reader because the profile and its exact reconciliation use the
writer exclusively. After the progression, restore the Framework-owned
2–64 API target, six-host warm reserve, and 2–128 ACU range.

This choice was superseded by FWD-D010: the required post-run HTTP count and
mutation-state verification uses the eventual-reader endpoint.

### FWD-D008 — Restart Aurora members sequentially after the ACU raise

The 2–128 to 256–256 ACU change leaves capacity-derived database parameters
pending restart. With no load admitted, restart the reader first and writer
second, waiting for each to return `available`; require both parameter groups
to be `in-sync` and the API service to recover 40/40 before qualification.

### FWD-D009 — Retry the failed baseline barrier with more start lead

`V72BATCH3K1` failed closed before warmup because 50,000-Entity fixture
seeding completed after the harness's fixed baseline-ready deadline of
`LOAD_START_AT - 120 seconds`. No measured traffic or baseline-state object
exists, so it is not a Broker performance result. Retry the identical workload
as `V72BATCH3K2` with ten minutes of task-launch lead; do not weaken the
barrier, fixture, reconciliation, latency, durability, authorization, or
zero-error controls.

### FWD-D010 — Recreate the prior six-reader verification topology

`V72BATCH3K2` accepted all 540,000 measured writes with zero HTTP errors and
31.232 ms maximum per-generator p99, then all three generators timed out at
the exact ten-second post-run verification deadline before publishing
final-ready markers. The verifier concurrently issues three exact count
queries and 1,500 mutation-state query batches through `READ_DBHOST`; that
endpoint had only one `READ_ONLY` target. Add five temporary serverless readers
using the prior two-AZ distribution, require all six proxy targets available,
then rerun 3,000/s. Do not relax verification or use the writer. Delete the
five temporary readers after qualification.

### FWD-D011 — Fix the exact-count plan instead of adding verification capacity

`V72BATCH3K3` repeated the complete 540,000-write, zero-error 3,000/s steady
phase with 33.792 ms or lower per-generator response p99. Six available
256-ACU readers did not complete the required post-run barrier: Performance
Insights showed one `type + count=true + limit=1` count CTE consuming the full
ten-second request deadline on one reader, while CloudWatch measured about
5,654 read IOPS there and little work on the other five.

Keep the cloud workload, ten-second request deadline, reader endpoint, exact
verification, and six-reader control unchanged. Deploy the Broker's narrowly
scoped pure one-type exact-count split over the existing single-type equality
and multi-type overlap indexes, then rerun the identical 3,000/s gate. Do not
add readers, grant unrelated S3 permissions, relax the verifier, or advance to
5,000/s until the final HTTP and PostgreSQL states reconcile.

### FWD-D012 — Keep the replacement digest a single ARM64 OCI manifest

The first Broker rebuild inherited a newer Buildx default and published an
attested OCI index. Do not deploy that digest. Remove its qualification tag
and attestation, republish the identical clean Broker revision with provenance
attestation disabled, retain the separate Buildx metadata file, and require
ECR to report the replacement as
`application/vnd.oci.image.manifest.v1+json`. This preserves the artifact
shape used by the current canary and keeps the query-plan change as the only
runtime variable.

### FWD-F003 — The corrected replacement image is source-bound and scan-clean

Broker commit `b40de29e1e0303da7a9c0ceb43808e8720367390` produced the
single Linux ARM64 OCI manifest
`sha256:f3a26990453705b916f7b151b6d3683203374f165e453af5f9dd580e3fbfa3ef`
under tag `qual-v73-b40de29e1e03-20260926t105556z`. ECR reports
`application/vnd.oci.image.manifest.v1+json`; the basic scan completed with
zero findings. Buildx metadata binds the exact Git revision and the same
pinned Bun and distroless parent digests as the current canary.

The accidental manifest-list tag was removed and its attestation manifest was
deleted. It was never referenced by Framework configuration or deployed.

### FWD-F004 — The replacement digest passes the Framework gate

The digest-pinned Framework candidate passed TypeScript typecheck, ESLint with
zero errors and nine pre-existing warnings, and 48 affected configuration,
runtime-profile, Broker, load, blue/green, lake, operations, transform, and
deployment-action tests across nine suites.

### FWD-F005 — The live diff is restricted to the Broker release

The exact Framework assembly changes only the Garnet Broker nested stack and
root image output. Every Broker task definition advances from the `c2fe412…`
manifest to `f3a269…`, the migration release id changes to the same digest,
and the load task's source-binding value follows it. Lake, common, ingestion,
API-front-door, and operations nested stacks have no differences.

### FWD-D013 — Treat the fixed-ACU utilization alarm as an explicit exception

The temporary 256/256-ACU qualification setting leaves
`garnet-framework-broker-aurora-acu-us-east-1` in `ALARM` because capacity is
fixed at the configured maximum. Do not describe the complete alarm set as
green and do not disable or mutate the alarm. Permit the image-only rollout
only while:

- both ECS rollback alarms are `OK`;
- the API service is 40/40 with one stable deployment;
- all 32 fixed hosts are in service;
- the writer and six readers are `available` and `in-sync`; and
- all six read-only RDS Proxy targets are `AVAILABLE`.

Restore the committed 2–128-ACU range after qualification and require the
utilization alarm to return to its ordinary evaluated state.

### FWD-F006 — The replacement image passes the complete 3,000/s staged gate

On 2026-09-26, `V73BATCH3K1` passed the unchanged internal
`mutation-matrix-v1` progression gate:

| Measure | Result |
|---|---:|
| Offered / completed mutations | 540,000 / 540,000 |
| Successful mutations per second | 3,000 |
| HTTP failures / generator rejections | 0 / 0 |
| Maximum endpoint p99 | 27.648 ms |
| Maximum endpoint p99.9 | 278.528 ms |
| Exact database version delta | 540,000 |
| Exact HTTP count | 50,000 on each generator |
| API mutation-state verification | valid on all three generators |

All three generator tasks and the aggregate task exited zero. The API
remained 40/40 with 40 healthy targets and zero failed deployment tasks; all
seven Aurora members remained available and in-sync. The immutable aggregate
binds Broker commit `b40de29e1e0303da7a9c0ceb43808e8720367390` and image
`sha256:f3a26990453705b916f7b151b6d3683203374f165e453af5f9dd580e3fbfa3ef`.

This 180-second internal-ALB trial is a staged operational gate, not the
one-hour external qualification. Its report correctly records
`validQualification: false`. Evidence is retained under
`/private/tmp/garnet-durable-write-cloud-20260926/V73BATCH3K1-s3`.

### FWD-D014 — Advance to 5,000/s with rate as the only changed control

Keep API at 40 tasks, the Graviton group at 32 hosts, Aurora at fixed 256 ACU,
the six-reader proxy topology, Broker image and batching settings, fixture,
warmup and duration, exact reconciliation, and all latency/error budgets
unchanged. Increase only the offered rate from 3,000 to 5,000 mutations/s and
the generator count from three to five.

Do not tune the batching window, API task concentration, database capacity,
timeouts, or verifier unless the retained 5,000/s evidence identifies a
specific limiting mechanism.

### FWD-F007 — The 5,000/s write phase is lossless but final proof is incomplete

`V73BATCH5K1` completed all 900,000 offered steady mutations at exactly
5,000/s with zero HTTP failures and zero generator rejections. The maximum
per-generator endpoint p99 was 143.360 ms, below the 500 ms budget, while the
API stayed 40/40 with 40 healthy targets and all Aurora members remained
available and in-sync.

The run failed closed after measurement. Three generators timed out their
exact Entity count at the shared ten-second request deadline; the other two
published `final-ready` markers and then timed out waiting for the owner
database snapshot. The aggregate correctly rejected reports without
reconciliation. Performance Insights shows the replacement split-count SQL
on the readers and low reader load; the writer remained dominated by
`IO:XactSync`.

This is retained measured write evidence, not a passed 5,000/s gate. Evidence
is under
`/private/tmp/garnet-durable-write-cloud-20260926/V73BATCH5K1-s3` and
`/private/tmp/garnet-durable-write-cloud-20260926/V73BATCH5K1-pi`.

### FWD-D015 — Deploy a proof-only HTTP deadline in the load runner

Pass through `LOAD_RECONCILIATION_REQUEST_TIMEOUT_MS` to the load task and
record it in immutable generator and aggregate metadata. Keep
`LOAD_REQUEST_TIMEOUT_MS=10000` for fixture checks, warmup, and measured
traffic; set only the post-run proof request deadline to 60,000 ms.

The retry keeps the Broker image, batching settings, API and host counts,
Aurora and reader topology, workload, fixture, rate, warmup, duration,
latency budgets, exact PostgreSQL reconciliation, event drain, and zero-error
policy unchanged.

Do not add `s3:ListBucket`: that denied action appears only in the barrier's
last-error diagnostic after peers fail to publish their final markers. Object
reads and writes already use least-privilege exact-key permissions and worked
for baseline plus successful peer markers.

### FWD-F008 — The launcher contract passes with the new allowlisted setting

Framework typecheck passed, and all 11 focused load-launcher tests passed.
The generated ECS overrides preserve
`LOAD_RECONCILIATION_REQUEST_TIMEOUT_MS=60000` independently from
`LOAD_REQUEST_TIMEOUT_MS`; unlisted environment values remain excluded.

### FWD-F009 — The proof-aware load image is source-bound and scan-clean

Broker candidate commit `a84d7159971d6a4029bcfe88393232829b55078d`
produced Linux ARM64 load-runner manifest
`sha256:7857636585703b9630d9a84ddf6eec68fe4d5cc97d20dc2ff902247a388133bd`
under tag `qual-v74-a84d7159971d-20260926t122314z`.

ECR and Buildx both report one
`application/vnd.oci.image.manifest.v1+json` for `linux/arm64`; provenance is
retained in the local Buildx metadata file rather than an attestation
manifest. The ECR basic scan completed with zero findings. Framework pins the
load runner by digest; the Broker service image remains unchanged for the
5,000/s proof-deadline retry.

### FWD-F010 — The load-only deployment candidate passes the complete gate

The digest update and launcher allowlist passed:

- TypeScript typecheck;
- ESLint with zero errors and the same nine pre-existing warnings; and
- all 134 tests across all 28 Framework suites in 125.857 seconds.

No test was skipped or converted to a warning.

### FWD-F011 — The proof-aware retry reaches the server statement boundary

The load-only Framework deployment completed in 67.23 seconds and registered
generator revision 41 plus aggregate revision 14 on the exact
`sha256:785763…` image. The Broker service revision, image, desired count,
target group, host group, Aurora capacity, reader topology, and alarms were
unchanged.

`V74BATCH5K2` again completed 900,000/900,000 writes at 5,000/s with zero
request failures or generator rejections and 204.800 ms maximum
per-generator endpoint p99. Four generators published final-ready markers.
One exact count returned HTTP 500, with the Broker log proving PostgreSQL
cancelled that statement at its unchanged ten-second limit. The other exact
counts completed around 2.14 seconds.

The aggregate correctly failed because generator 1 had no reconciliation.
Retained evidence is under
`/private/tmp/garnet-durable-write-cloud-20260926/V74BATCH5K2-s3`.

### FWD-D016 — Deploy bounded transient retries, not broader limits

Keep `LOAD_RECONCILIATION_REQUEST_TIMEOUT_MS=60000` as the total proof
deadline, but cap each exact-count attempt at the unchanged ten-second
request/server limit. Retry only transport failures, HTTP 429, and HTTP 5xx.
Retain attempt count and elapsed proof time in generator and aggregate
artifacts.

Do not alter the Broker task, PostgreSQL statement timeout, API/host/Aurora
capacity, reader count, workload, measured request timeout, latency budgets,
or least-privilege S3 policy.

### FWD-F012 — The bounded-retry runner is source-bound and scan-clean

Broker candidate `67df98b176f9434cc9ede8f7c83e6bb31cbf999c` passed
39 focused load-contract tests, 148 assertions, and repository typecheck
before image publication.

The first publication used BuildKit attestations and therefore produced an OCI
index containing one ARM64 image plus an unknown-platform attestation
manifest. It is retained as rejected build evidence and is not referenced by
Framework.

The deployable replacement disabled attestations and produced one
`application/vnd.oci.image.manifest.v1+json` for `linux/arm64`:

`539762775523.dkr.ecr.us-east-1.amazonaws.com/garnet-load@sha256:f752855e7a86939daab84198ae01c80e62976fdf176228b821f82dc1dd56b7ce`

ECR basic scanning completed successfully on 2026-09-26 with zero findings.
Framework pins that exact digest. The next deployment remains load-task-only;
the Broker runtime and all qualification capacity controls stay unchanged.
Framework typecheck and 39 focused configuration, load-launcher, and Broker
construct tests across three suites also passed before synthesis.

### FWD-F013 — Revision 42/15 closes the 5,000/s staged gate

The frozen Framework diff replaced only the generator and aggregate task
definitions. Deployment completed in 66.29 seconds and registered generator
revision 42 plus aggregate revision 15 on the exact `sha256:f752855e…` load
image. The Broker remained revision 41 on `sha256:f3a269…`.

`V75BATCH5K3` passed with 900,000/900,000 durable current-Entity mutations,
zero request failures, zero generator rejections, 364.544 ms aggregate
endpoint p99, exact 900,000 PostgreSQL version delta, and complete 50,000
Entity API state verification from every generator. All exact counts succeeded
on their first attempt in 1.667–2.124 seconds.

### FWD-D017 — Remove observed idle lead, not evidence

Use a six-minute future whole-minute start for the next staged runs. Preserve
the 50,000-Entity fixture, causal baseline markers, one-minute warmup,
three-minute steady window, exact HTTP/API/PostgreSQL reconciliation, fixed
capacity, and all latency/error budgets. This removes four minutes of observed
idle wait without weakening a gate.

### FWD-F014 — Fixed capacity clears the exact 7,000/s staged gate

`V75BATCH7K1` used seven revision-42 generators and revision-15 aggregate
runner on the exact `sha256:f752855e…` image. All 1,260,000 mutations
succeeded with zero request failure or rejection, 237.568 ms aggregate
endpoint p99, exact 1,260,000 PostgreSQL version delta, and complete API state
verification from all generators.

All exact counts succeeded on their first attempt in 2.071–2.369 seconds. The
API service remained 40/40 healthy on revision 41 and all 40 target-group
members remained healthy after the run.

### FWD-F015 — Fixed capacity clears the exact 10,000/s staged target

`V75BATCH10K1` used ten revision-42 generators and revision-15 aggregate
runner without changing the Broker or fixed control. All 1,800,000 mutations
succeeded with zero request failure or rejection. Aggregate endpoint p99 was
331.776 ms and p99.9 was 495.616 ms.

All ten exact counts returned 50,000 on their first attempt, all API state
partitions verified, and PostgreSQL produced the exact
1,800,000/1,800,000 aggregate-version delta. API remained 40/40 with 40
healthy targets; Aurora remained available at 256 ACU with all seven members
in sync.

### FWD-D018 — Repeat the target on the unchanged deployment

Run one more 10,000/s staged interval before any image or capacity change.
This supplies the required comparative sample and prevents a favorable single
interval from becoming the capacity claim.

### FWD-F016 — The unchanged 10,000/s target repeats

`V75BATCH10K2` repeated the first target sample without an image, capacity,
workload, deadline, or budget change. All 1,800,000 durable mutations again
succeeded with zero request failure and zero generator rejection. Aggregate
endpoint p99 was 397.312 ms, p99.9 was 622.592 ms, and maximum observed
response time was 901.612 ms.

All ten exact counts returned 50,000 on their first attempt in
1.684–2.338 seconds. API state verification and the exact PostgreSQL
1,800,000/1,800,000 version delta passed. Across the two unchanged target
samples, 3,600,000/3,600,000 mutations succeeded and endpoint p99 ranged from
331.776 to 397.312 ms, below the 500 ms budget.

### FWD-F017 — Final Broker and load artifacts bind to one frozen source

Broker candidate `ef7bdf94aaf474f5ca28f41c45d2e4246c8f3ca7` passed
all 2,537 Broker unit tests across 315 files with 11,485 assertions, repository
typecheck, and the unchanged load architecture limits.

Both final images were rebuilt from that exact commit as single
`application/vnd.oci.image.manifest.v1+json` ARM64 artifacts and passed ECR
basic scanning with zero findings:

- Broker:
  `539762775523.dkr.ecr.us-east-1.amazonaws.com/garnet-broker@sha256:f3a26990453705b916f7b151b6d3683203374f165e453af5f9dd580e3fbfa3ef`
- Load:
  `539762775523.dkr.ecr.us-east-1.amazonaws.com/garnet-load@sha256:50bdf0ca189a8d09fa735b7f88391992f8163e3f2f1275236671c3dec1359047`

The Broker executable is byte-identical to the already deployed digest, so
the Broker task definition does not need a synthetic replacement. Build
metadata now binds those bytes to the frozen final commit. Framework pins the
new load digest containing the focused proof modules.

### FWD-D019 — Deploy final provenance without changing the control

Deploy only the final load task definitions, keep the Broker digest and fixed
qualification capacity unchanged, and rerun the exact 10,000/s staged gate
with `GARNET_COMMIT=ef7bdf94aaf474f5ca28f41c45d2e4246c8f3ca7`.

After the final gate, restore Framework-managed ECS, host, and Aurora scaling,
delete the five temporary Aurora readers, and verify ordinary alarm and health
states. Record those post-build findings only in this root deployment ledger
so the Broker image/source binding remains immutable.

### FWD-F018 — The final Framework deployment candidate passes

Before synthesis, the final digest update passed:

- repository typecheck;
- all 134 tests across all 28 suites in 98.169 seconds; and
- lint with zero errors and the same nine pre-existing warnings.

No test, warning policy, or deployment assertion was weakened.

### FWD-F019 — The final source-bound 10,000/s gate passes

The exact final assembly changed only the load generator and aggregate task
definitions. Deployment completed in 66.42 seconds and registered generator
revision 43 plus aggregate revision 16 on
`sha256:50bdf0ca189a8d09fa735b7f88391992f8163e3f2f1275236671c3dec1359047`.

`V76FINAL10K1` bound the retained report to Broker commit
`ef7bdf94aaf474f5ca28f41c45d2e4246c8f3ca7` and the final Broker digest.
All 1,800,000 durable current-Entity mutations succeeded with zero request
failure and zero generator rejection. Aggregate endpoint p99 was 376.832 ms,
p99.9 was 540.672 ms, and maximum observed response time was 882.641 ms.

All ten exact counts returned 50,000 on their first attempt in
1.957–2.624 seconds. Every API state partition verified and PostgreSQL
produced the exact 1,800,000/1,800,000 aggregate-version delta. All eleven load
tasks exited zero on the final digest. API remained 40/40 with 40 healthy
targets, and Aurora remained available with all seven members in sync.

This is final staged internal-ALB capacity evidence. It is not mislabeled as
the one-hour public-ingress qualification.

### FWD-F020 — Managed host restoration waits on matcher scale-in

API restoration succeeded first: desired/running count is 2/2, its scalable
target is restored to 2–64, and all dynamic and scheduled scaling suspension
flags are false. Aurora accepted its normal 2–128 ACU range, and the five
temporary readers entered deletion.

A direct host-group return to desired six briefly drained instances, but the
ECS capacity provider expanded back to 32 because all current instances were
protected by running tasks and matcher remained at its autoscaling maximum of
16. Disabling managed scaling or termination protection would bypass the
production controller and is rejected.

CloudWatch then proved the Entity-event work was complete: pending partitions
and oldest pending age were zero for eight consecutive minute samples,
claimed and completed totals matched, and retry, claim-error, and
completion-error metrics were zero.

### FWD-D020 — Return the drained matcher directly to its configured minimum

Set `garnet-matcher` desired count to its existing scalable-target minimum of
one only after the zero-backlog and zero-error evidence above. Leave its 1–16
target, scale policies, and suspension flags unchanged. Then request the
original host-group desired count of six again and let managed draining and
termination protection perform the contraction.

This removes roughly an hour of conservative target-tracking scale-in delay
(15 low datapoints plus 180-second decrements) without dropping queued work or
bypassing the capacity provider.

### FWD-D021 — Apply restored Aurora capacity-derived parameters sequentially

After the five temporary readers were deleted, the normal writer and retained
reader were both available on the restored 2–128 ACU range, but each reported
`DBClusterParameterGroupStatus=pending-reboot`. The earlier fixed 256-ACU
qualification had intentionally rebooted every member to apply the
capacity-derived static parameters; leaving the two production members pending
would therefore make the restored topology operationally incomplete.

Reboot the retained reader first and wait for it to become available. Then
reboot the writer and wait for it to become available. This keeps one
up-to-date member available during each bounded operation, applies the normal
parameter state without a failover or replacement, and preserves the
Framework-managed two-member topology.

### FWD-F021 — Six hosts was an observed baseline, not a fixed contract

With matcher restored to one task, the first managed contraction removed all
idle hosts from 32 down to nine active task-bearing hosts. A direct request for
desired six then produced one transient capacity-provider reservation sample
of 113.333%, above the configured 85% target. The unchanged managed-scaling
policy responded by returning desired capacity to 12.

The Framework declaration fixes the on-demand group at minimum two, maximum
32, managed scaling enabled, managed draining enabled, managed termination
protection enabled, and target capacity 85%. It does not declare desired six.
The retained six-host snapshot was therefore a point-in-time baseline rather
than a configuration invariant.

### FWD-D022 — Restore the controller, not a stale dynamic count

Do not issue another direct desired-capacity change. Leave every managed
capacity-provider control enabled and require the high reservation alarm to
return to `OK`, all launch warmup activities to finish, every service to remain
stable, and the group to settle at the capacity selected by the 85% controller.

This avoids oscillating the group around a stale observation while preserving
the declared 2–32 operating envelope, availability-zone balancing, draining,
and termination protection.

### FWD-F022 — Aurora restoration is complete

The five temporary qualification readers were deleted. The retained reader was
rebooted and returned `available` before the writer was rebooted. Both normal
members are now `available`, both cluster parameter-group statuses are
`in-sync`, and the cluster is `available` on its committed 2–128 ACU range.

The RDS Proxy default and read-only endpoints are both `available`. Their
writer and retained-reader targets respectively report `READ_WRITE AVAILABLE`
and `READ_ONLY AVAILABLE`. Replica lag is `OK`. The ACU alarm returned from the
fixed-capacity qualification exception to `OK` at 2026-09-26 14:38:01 UTC
after three non-breaching five-minute datapoints; the latest evaluated
five-minute average was 14.214%.

### FWD-F023 — Managed runtime restoration is complete

The on-demand capacity provider converged at its own managed steady state:

- minimum 2, maximum 32, desired/running/healthy/protected 12/12/12/12;
- no active warmup or scaling activity;
- high and low reservation alarms `OK`;
- three consecutive reservation samples at 77.916%, inside the
  76.5–85% target band; and
- every ECS service at desired count with one completed deployment and zero
  pending or failed tasks.

API is restored to 2/2 with two healthy load-balancer targets and an enabled
2–64 scalable target. Matcher is restored to 1/1 with an enabled 1–16 scalable
target. Every autoscaling suspension flag is false. No load generator or
aggregate task remains running.

The public API returns the expected authentication-enforcing `401` to an
unauthenticated `/health` request; private API target health is therefore the
correct backend liveness proof. All active Framework stacks are
`UPDATE_COMPLETE`. A read-only change-set diff against the exact deployed
assembly reports zero differences across all seven active stacks.

## Measured staged performance

All rows below were produced on 2026-09-26 by the retained
`mutation-matrix-v1` internal-ALB workload with exact HTTP state and PostgreSQL
version-delta reconciliation. Latency is the aggregate target latency.

| Run | Offered rate | Duration | Succeeded / offered | Fail / reject | p99 | p99.9 | Exact DB delta | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `V73BATCH3K1` | 3,000/s | 180 s | 540,000 / 540,000 | 0 / 0 | 25.600 ms | 278.528 ms | 540,000 | passed |
| `V75BATCH5K3` | 5,000/s | 180 s | 900,000 / 900,000 | 0 / 0 | 364.544 ms | 606.208 ms | 900,000 | passed |
| `V75BATCH7K1` | 7,000/s | 180 s | 1,260,000 / 1,260,000 | 0 / 0 | 237.568 ms | 421.888 ms | 1,260,000 | passed |
| `V75BATCH10K1` | 10,000/s | 180 s | 1,800,000 / 1,800,000 | 0 / 0 | 331.776 ms | 495.616 ms | 1,800,000 | passed |
| `V75BATCH10K2` | 10,000/s | 180 s | 1,800,000 / 1,800,000 | 0 / 0 | 397.312 ms | 622.592 ms | 1,800,000 | passed |
| `V76FINAL10K1` | 10,000/s | 180 s | 1,800,000 / 1,800,000 | 0 / 0 | 376.832 ms | 540.672 ms | 1,800,000 | passed |

The final source-bound run used Broker commit
`ef7bdf94aaf474f5ca28f41c45d2e4246c8f3ca7`, Broker digest
`sha256:f3a26990453705b916f7b151b6d3683203374f165e453af5f9dd580e3fbfa3ef`,
and load digest
`sha256:50bdf0ca189a8d09fa735b7f88391992f8163e3f2f1275236671c3dec1359047`.

These are repeated staged capacity results, not a one-hour public-ingress
qualification. The retained reports correctly leave both formal qualification
flags false rather than weakening that claim boundary.
