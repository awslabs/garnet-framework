# Deploying Garnet Framework

This branch deploys Garnet Broker only. It is a separate architecture from the
maintenance stack:

- CloudFormation stack: `GarnetFramework`
- physical resource prefix: `garnet-framework`
- database: a new Aurora PostgreSQL cluster named
  `garnet-framework-broker-aurora`
- no in-place migration from the maintenance/Scorpio schema

The maintenance stack and this stack may coexist in one account and region.
`test/resource-name-isolation.test.ts` synthesizes the complete stack and
rejects reuse of known maintenance physical names. AWS IoT event configuration
is account-wide shared state rather than a named resource; both stacks enable
the same event classes. This stack uses a stable custom-resource identity and
does not disable the shared setting on deletion. Future changes to those event
classes must be coordinated across both stacks.

## Prerequisites

- Node.js 24
- npm
- AWS CDK bootstrap in the target account and region
- a digest-pinned Linux ARM64 or multi-architecture Garnet Broker image
- AWS credentials only for `diff` and deployment

Install and verify:

```bash
npm ci --ignore-scripts
npm ci --prefix lib/layers/nodejs
npm run lint
npm run typecheck
npm test -- --runInBand
```

## Configuration

CI and CD use `.github/scripts/configure-garnet.js`. The deployment inputs are:

| Variable | Required | Meaning |
| --- | --- | --- |
| `GARNET_BROKER_IMAGE` | yes | Digest-pinned broker image |
| `GARNET_LOAD_IMAGE` | no | Digest-pinned AWS load-runner image |
| `GARNET_REGION` | yes in CI/CD | Target region |
| `GARNET_DEPLOYMENT_STRATEGY` | no | `rolling` or `bluegreen`; default `rolling` |
| `GARNET_BROKER_PUBLIC_ORIGIN` | distributed callbacks | Exact public HTTP(S) origin |
| `GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS` | no | Exact comma-separated callback origins |
| `GARNET_CONTEXT_ALLOW_HOSTS` | no | Exact comma-separated JSON-LD hosts |
| `GARNET_EVENTUAL_ENTITY_READS` | no | Route eligible reads to the Aurora reader |
| `GARNET_BOOTSTRAP_TENANT` | no | Tenant bound to the bootstrap credential; default `default` |
| `GARNET_NAT_GATEWAY_COUNT` | no | `2` for production; `1` accepts an egress AZ dependency |
| `GARNET_DATABASE_DELETION_PROTECTION` | no | Default `true`; set `false` only for disposable environments |
| `GARNET_DATABASE_BACKUP_RETENTION_DAYS` | no | `1` to `35`; default `35` |

The script validates images, origins, hosts, booleans and strategy before
rewriting `configuration.ts`.

## Synthesis and deployment

```bash
node .github/scripts/configure-garnet.js
npx cdk synth --quiet
npx cdk diff
npx cdk deploy \
  --require-approval never \
  --outputs-file cdk-outputs.json \
  --progress events
node .github/scripts/smoke-test.js
```

CI synthesizes both rolling and blue/green profiles. CD assumes a short-lived
OIDC role and deploys the stack through CloudFormation.

## Deployment strategies

### Rolling

Every API-independent worker uses ECS rolling deployment with a circuit breaker
and automatic rollback. The API uses the same strategy when
`GARNET_DEPLOYMENT_STRATEGY=rolling`.

### Blue/green

Blue/green applies only to the externally routed API service. Workers continue
rolling because they do not have a traffic listener and running two independent
consumers during a bake would not isolate side effects.

The API blue/green path has:

1. separate production and test target groups;
2. an internal test listener;
3. a private ARM64 lifecycle Lambda at
   `POST_TEST_TRAFFIC_SHIFT`;
4. validation of `/health` and
   `/ngsi-ld/v1/entities?limit=1&local=true`;
5. deployment rollback alarms for unhealthy targets and target 5xx rate across
   both target groups;
6. a configurable bake window retaining the previous revision.

The blue/green API deliberately does not configure the rolling-only ECS circuit
breaker.

Blue/green reduces API release risk; it does not make an incompatible database
migration reversible. `/garnet-migrate` runs before services start. Every schema
change used with blue/green must remain backward compatible with the previous
API revision through the complete bake window. Destructive migrations require a
separate expand/migrate/contract release sequence.

The blue/green topology and rollback controls are synthesis- and unit-tested.
They are not called production-qualified until a real AWS deployment has
demonstrated validation failure, alarm rollback, traffic shift, bake retention
and zero-downtime rollback.

## Multi-tenancy

Garnet Broker owns NGSI-LD tenant semantics. Framework ingress preserves them:

- the public API authorizer requires a tenant claim and API Gateway overwrites
  `NGSILD-Tenant` from that verified claim, so a client cannot select another
  tenant by spoofing the request header;
- the bootstrap credential is tenant-scoped to
  `Parameters.garnet_bootstrap_tenant` (`default` initially); production
  onboarding should issue distinct tenant-scoped credentials;
- a bare SQS entity targets the default tenant;
- `{ "tenant": "factory-a", "entity": { ... } }` forwards
  `NGSILD-Tenant: factory-a`;
- records are batched only with the same tenant and content type;
- private notification IoT topics hash the full tenant and full Subscription
  identifier, preventing cross-tenant topic collisions.

The event lake is one Iceberg v2 table, `garnet_framework.entity_events`,
partitioned by tenant identity and committed day. This avoids one Glue table per
tenant while retaining partition pruning and tenant-local file groups.
Partitioned object-store paths are enabled explicitly, so Iceberg groups data
files by tenant/day beneath the table location.

Iceberg partition layout is not an authorization boundary and physical S3 paths
are not a stable customer API. Do not grant tenant users direct access to the
shared bucket. Tenant-facing query roles must be granted through Lake Formation
data-cell filters on `tenant`; platform operators may query the complete table.

Firehose uses append-only Iceberg delivery because Entity events are immutable
and append-only mode can scale automatically. `event_id` is retained as the
stable deduplication key for downstream consumers. The broker packs at most 500
logical events into one physical Firehose record, matching Firehose
deaggregation limits.

## Scale model

The production network spans two Availability Zones with one NAT gateway per
zone. `Parameters.nat_gateway_count = 1` is available only as a lower-cost test
profile and deliberately gives up zone-independent internet egress. S3 traffic
from private application subnets uses a gateway endpoint rather than NAT.

The API profile uses 2 vCPU / 4 GiB ARM64 tasks, starts at two tasks and may
scale to 64. Request target tracking is configured at 15,000 requests per
running task per minute (250 requests/s), not 15,000 requests/s. Rolling
deployments use native `ALBRequestCountPerTarget`. Because AWS does not support
that predefined metric with ECS blue/green, blue/green uses metric math across
both target groups divided by `RunningTaskCount`; this remains valid when ECS
swaps the active target group. At that target the configuration has a
steady-state planning ceiling of 16,000 requests/s, but this is only an
autoscaling shape. Actual endpoint capacity depends on query mix, payload size,
Aurora latency, connection pressure and downstream work.

A public 10,000 requests/s test also reaches the default API Gateway
account/Region throttle, which is shared by all APIs. Request quota headroom
before qualification instead of treating the default ceiling as available
capacity. Sustained 10,000 requests/s is 25.92 billion requests in a 30-day
month, so API Gateway request charges must be compared with a trusted
VPC-to-ALB path; the latter bypasses public tenant authentication and is only
appropriate for platform-controlled callers.

A 10,000 requests/s claim requires an AWS qualification run covering:

- point reads, filtered reads, writes and mixed traffic separately;
- API Gateway and internal-ALB paths;
- p50/p95/p99 latency and error rate;
- Aurora ACU, connections, I/O and replica lag;
- matcher queue age/backlog;
- notification and lake worker saturation;
- Firehose throttling and Iceberg freshness;
- scale-out time from minimum and a pre-warmed task count.

When `GARNET_LOAD_IMAGE` is configured, the stack includes idle ARM64 generator
and aggregate task definitions. Run them with:

```bash
LOAD_RUN_ID=GarnetRelease20260910R10000T1 \
LOAD_QUALIFICATION=1 \
LOAD_GENERATOR_COUNT=4 \
LOAD_RATE=10000 \
LOAD_DURATION_SECONDS=3600 \
LOAD_WARMUP_SECONDS=60 \
LOAD_TELEMETRY_GROUP_ID=GarnetRelease20260910 \
LOAD_EXTERNAL_TELEMETRY_ID=GarnetRelease20260910-10000-1 \
GARNET_COMMIT="$(git rev-parse HEAD)" \
npm run load:aws
```

Set explicit latency, error and cost budgets before treating the run as a pass.
Every qualification now waits for the required CloudWatch datapoints and writes
one raw telemetry artifact locally under `results/aws-evidence/` and to the
Object-Locked load-report prefix. The artifact binds the exact aggregate S3
object version and ETag to the deployed image and Region, and retains the API
EMF metrics, ECS service CPU and memory, Aurora
capacity/connections/latency, and Entity-event SQS metrics returned by
`GetMetricData`.

Use one telemetry group for every rate/trial belonging to the same native
deployment, and a distinct external telemetry id for each run. After the
required independent trials complete, merge their retained local artifacts:

```bash
npm run evidence:merge -- \
  results/aws-evidence/garnet-release-telemetry.json \
  results/aws-evidence/GarnetRelease20260910R5000T1-telemetry-evidence.json \
  results/aws-evidence/GarnetRelease20260910R5000T2-telemetry-evidence.json \
  results/aws-evidence/GarnetRelease20260910R5000T3-telemetry-evidence.json
```

The merged file preserves every raw per-run collection and is the
`telemetryArtifact` supplied to the broker's best-native comparison manifest.
Aurora failure injection and API-visible zero-loss reconciliation remain a
separate, explicit durability run; load collection does not trigger a database
failover.

The AWS identity launching qualification needs the existing ECS task
permissions plus `cloudwatch:GetMetricData`, `rds:DescribeDBClusters`,
`sts:GetCallerIdentity`, and read/write access to the load-report prefix. The
collector rejects a caller account that differs from the deployed stack output.

## Data retention and destruction

- Aurora uses `RemovalPolicy.SNAPSHOT`.
- Aurora keeps 35 days of continuous backups and enables deletion protection
  by default. Set `Parameters.database_deletion_protection = false` only for a
  disposable environment before destroying it.
- Data-lake and Athena-result buckets use `RemovalPolicy.RETAIN`.
- Iceberg table metadata uses `RemovalPolicy.RETAIN`.
- load reports and qualification evidence use a retained, versioned private
  bucket with a 90-day S3 Object Lock compliance default. Protected object
  versions cannot be overwritten or deleted during that period.

`cdk destroy` therefore does not erase retained data. Inventory snapshots and
buckets explicitly after destroying a test environment. Enabling S3 Object
Lock is a one-way bucket setting; compliance retention cannot be shortened or
bypassed, including by the root user, until the protected version expires.

## Current verification

The repository gates:

- TypeScript with `tsc --noEmit`;
- ESLint;
- Jest unit and synthesis tests;
- rolling and blue/green synthesis;
- physical-name isolation from the maintenance stack;
- Iceberg tenant/day partitioning and Firehose schema;
- lifecycle hook, rollback alarms and test-listener security;
- tenant-aware ingestion and notification routing;
- post-deploy authenticated NGSI-LD smoke tests.

Live AWS deployment, rollback drills and 10k/s qualification remain required
before production sign-off.
