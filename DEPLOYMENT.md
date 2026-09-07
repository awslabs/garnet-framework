# Deploying Garnet

How Garnet is built, tested, deployed and rolled back.

- [Pipeline](#pipeline)
- [Environments](#environments)
- [Deployment strategies](#deployment-strategies)
- [The database constraint](#the-database-constraint)
- [Rollback](#rollback)
- [AWS scale diagnostics](#aws-scale-diagnostics)
- [Cost](#cost)
- [Local development](#local-development)
- [Setting up the pipeline](#setting-up-the-pipeline)
- [Known limitations](#known-limitations)

## Pipeline

Two workflows, both defined in [.github/workflows/](.github/workflows/) so the build changes in the same pull request as the code it builds.

**CI** ([ci.yml](.github/workflows/ci.yml)) runs on every pull request and on pushes to `main` and `dev`. Each stage gates the next, cheapest first:

| Stage | What it does | Fails the build on |
| --- | --- | --- |
| Lint | `eslint` over CDK TypeScript and Lambda JavaScript | Undefined variables, unreachable code |
| Typecheck | `tsc --noEmit` | Any type error |
| Unit tests | `jest`, no network or AWS calls | A failing assertion |
| Security scan | `npm audit` on deployed dependencies, `gitleaks` on the diff | A vulnerable production dependency or a committed secret |
| Synth | `cdk synth` for Scorpio concentrated/distributed and Garnet distributed | A supported deployment profile that will not synthesize |

The security stage distinguishes dependencies that reach production (the root tree with `--omit=dev`, plus the Lambda layer that ships inside the deployment package) from dev-only tooling. A `jest` advisory does not gate a deploy; it is reported and left non-blocking. An `axios` advisory does gate it.

Synth runs the two Scorpio architectures and the complete distributed Garnet profile, including its immutable broker and load images. The synthesized cloud assembly is uploaded as an artifact, so CD deploys the exact templates that passed rather than re-synthesizing and possibly resolving a different dependency.

**CD** ([cd.yml](.github/workflows/cd.yml)) is continuous *delivery*. A merge to `main` deploys to `dev` automatically. `stage` and `prod` each wait on a GitHub Environment approval, because the broker is stateful and there is one Aurora cluster per environment — a bad release is not free to undo. Use the `workflow_dispatch` trigger to deploy a single environment without walking the whole ladder.

Authentication is OIDC role assumption via `aws-actions/configure-aws-credentials`. Credentials are minted per run and expire with it; there are no long-lived access keys in the repository or in GitHub secrets. See [Setting up the pipeline](#setting-up-the-pipeline).

After every deploy, [smoke-test.js](.github/scripts/smoke-test.js) calls the deployed API. This matters because a green `cdk deploy` only means CloudFormation converged — it does not mean the broker answers NGSI-LD requests. The smoke test retrieves its client Authorization header from the `GarnetApiTokenSecretArn` Secrets Manager output, then performs an authenticated NGSI-LD create, local read, Attribute update, verified reread, delete and confirmed 404 through API Gateway → VPC link → ALB → broker → Aurora. The credential itself never enters CloudFormation outputs or deployment artifacts. The test also requires the authorizer to return 401 or 403 for a forged token and cleans up after partial failures.

## Environments

Each environment is a separate AWS account (or at minimum a separate region), holding one `Garnet` stack. Environment-specific settings live in GitHub Environment variables rather than in the repository:

| Variable | Example | Notes |
| --- | --- | --- |
| `AWS_REGION` | `eu-west-1` | Must be a region Garnet supports (see `azlist` in [constants.ts](constants.ts)) |
| `GARNET_ARCHITECTURE` | `concentrated` | Must match the architecture already deployed in that account |
| `GARNET_DEPLOYMENT_STRATEGY` | `rolling` | `rolling` or `bluegreen` |
| `GARNET_BROKER_ENGINE` | `garnet` | Garnet requires the distributed rolling profile |
| `GARNET_BROKER_IMAGE` | `…@sha256:…` | Immutable ARM64/multi-architecture broker image |
| `GARNET_LOAD_IMAGE` | `…@sha256:…` | Optional image built from `test/load/Dockerfile` |
| `GARNET_BROKER_PUBLIC_ORIGIN` | `https://broker.example` | Stable public origin for EntityMaps and distributed Subscription callbacks |
| `GARNET_NOTIFICATION_DELIVERY_ALLOW_ORIGINS` | `https://hooks.example` | Comma-separated exact callback origins; empty keeps HTTP delivery deny-all |
| `GARNET_CONTEXT_ALLOW_HOSTS` | `uri.etsi.org,contexts.example:8443` | Comma-separated exact remote JSON-LD hosts; empty keeps remote loading deny-all |
| `GARNET_EVENTUAL_ENTITY_READS` | `false` | Opts eligible reads into Aurora replica lag when explicitly set to `true` |
| `AWS_DEPLOY_ROLE_ARN` (secret) | `arn:aws:iam::…:role/garnet-deploy` | Role assumed via OIDC |

Garnet is configured by editing [configuration.ts](configuration.ts), not by environment variables, so the pipeline rewrites that file before synth using [apply-configuration.js](.github/scripts/apply-configuration.js). That script refuses an unknown value or an unsupported combination rather than silently deploying the default — a wrong architecture would replace the load balancer.

> **Changing `GARNET_ARCHITECTURE` on an existing environment is not a routine deploy.** It replaces the load balancer and the broker's internal DNS name. Treat it as a migration.

## Deployment strategies

Set per environment with `GARNET_DEPLOYMENT_STRATEGY`, or locally in [configuration.ts](configuration.ts).

### Rolling (default)

ECS replaces tasks in place. Every broker service has a **deployment circuit breaker** with rollback enabled, so a release whose tasks cannot start is detected and reverted automatically instead of retrying until it times out.

Works with both architectures. This is the only safe choice for a release carrying a database migration — see below.

### Blue/green (opt-in, concentrated only)

Native ECS blue/green — no CodeDeploy. On deploy:

1. ECS starts a second ("green") task set alongside the running ("blue") one.
2. Green registers in its own target group, reachable on the **internal test listener** (`deployment_test_listener_port`, default `8080`). Production traffic is still entirely on blue.
3. When green is healthy, ECS shifts the production listener rule to it.
4. Blue is retained for `deployment_bake_time_minutes` (default 10). During the bake, rolling back is a listener swap rather than a redeploy.

```
                    ┌─────────► blue  target group ──► current task set
ALB :80   (prod rule)┤
                    └ (after shift) green target group ──► new task set

ALB :8080 (test rule) ─────────► green target group   ← validate before any shift
```

The test listener is internal to the VPC. To exercise it from CI you need a runner inside the VPC (self-hosted, or a CodeBuild project in the private subnets); otherwise validate it manually from a bastion or via Session Manager before approving the next environment.

**Blue/green is rejected for the distributed architecture.** Each of the 8 services there registers in two or three target groups (its own routes plus the shared `/q/*` diagnostics route), and ECS shifts only the target group carrying the alternate-target configuration. The rest would keep pointing at the retired task set, so during a bake `/q/*` would report a different version than the one serving traffic. CDK synthesizes that without complaint, so the construct throws instead. Use rolling; the circuit breaker still gives you automatic rollback.

## The database constraint

**Read this before enabling blue/green.**

Blue and green task sets share **one Aurora cluster**. The broker tier is stateless, but it is not self-contained.

The all-in-one and at-context-server containers run Flyway at startup (`QUARKUS_FLYWAY_MIGRATE_AT_START: "true"`). If a Scorpio release carries a schema migration, green migrates the shared schema — and blue, your rollback target, is now running against a schema it was not built for. **The rollback is no longer safe, which defeats the purpose of blue/green.**

Consequences:

- For a Scorpio image bump that includes a migration, use **rolling** and accept a short window where both schema versions are in play, or take a maintenance window.
- Blue/green is appropriate for changes that do not touch the schema: Lambda code, IAM, dashboards, autoscaling and sizing, API configuration.
- Both task sets also consume the **same** `garnet-scorpiobroker-*` SQS queues. During a bake both pull notifications and temporal writes. That is tolerable because the upserts are idempotent, but it means green is not fully isolated: a bad green build can affect shared state before any HTTP traffic shifts to it. The test listener validates green's API, not its queue side effects.

Aurora itself is not blue/green. CDK has no managed RDS Blue/Green Deployments support, so an engine version change is applied in place with a brief failover, independent of the ECS strategy.

## Rollback

| Situation | What happens / what to do |
| --- | --- |
| Tasks fail to start | Circuit breaker rolls the service back automatically |
| Regression found during the bake (blue/green) | Roll back the ECS deployment; traffic returns to the retained blue task set |
| Regression found after the bake expired | Re-deploy the previous commit. `main` is the source of truth, so revert the merge and let CD run |
| Bad Lambda or infrastructure change | Revert the commit; CloudFormation restores the previous state |
| Schema migration already applied | Not automatically recoverable. Restore from the Aurora snapshot or apply a compensating migration |

Keeping `main` deployable is what makes the third row work. If a commit breaks CI, push the fix immediately or revert to unblock everyone else.

## AWS scale diagnostics

When `GARNET_LOAD_IMAGE` is set to an immutable digest, a Garnet deployment includes two
on-demand ARM64 task definitions and a private versioned S3 report bucket:

- a 4-vCPU / 8-GiB generator task;
- a 1-vCPU / 2-GiB aggregate task.

They are not ECS services and cost nothing while idle. Database username and password are injected
from the Aurora Secrets Manager secret. Aurora requires TLS, and reports are encrypted at rest,
blocked from public access, retained when the stack is removed, and written below
`garnet-load/<run-id>/`.

After deploying with `--outputs-file cdk-outputs.json`, run a short multi-generator diagnostic:

```bash
LOAD_RUN_ID=AwsSmoke1 \
LOAD_GENERATOR_COUNT=4 \
LOAD_RATE=5000 \
LOAD_DURATION_SECONDS=300 \
LOAD_WARMUP_SECONDS=30 \
LOAD_FIXTURE_ENTITIES=50000 \
LOAD_START_DELAY_SECONDS=900 \
GARNET_COMMIT="$(git rev-parse HEAD)" \
npm run load:aws
```

The launcher starts one ECS task per generator index, gives all tasks the same future schedule,
waits for runs longer than the AWS CLI's built-in waiter supports, and then starts the aggregate
task even if a generator failed. Its final line is the exact S3 URI of the aggregate report.

Without `LOAD_QUALIFICATION=1`, the AWS plane targets the broker's internal ALB and records
`LOAD_ENVIRONMENT=aws-ecs-internal`. It measures the real Fargate → ALB → broker → Aurora and
event-worker path while keeping API Gateway outside a short scaling diagnostic.

For production qualification, set `LOAD_QUALIFICATION=1`. The launcher then targets the deployed
`GarnetEndpoint` and records `LOAD_ENVIRONMENT=aws-ecs`, so API Gateway, its Lambda authorizer, the
VPC link and the internal ALB are all measured. The generator task receives `LOAD_HEADERS_JSON`
from the named API-client Secrets Manager secret; neither the launcher, RunTask overrides, reports
nor CloudFormation outputs contain the credential:

```bash
LOAD_RUN_ID=AwsQualification1 \
LOAD_QUALIFICATION=1 \
LOAD_GENERATOR_COUNT=4 \
LOAD_RATE=5000 \
LOAD_DURATION_SECONDS=3600 \
LOAD_WARMUP_SECONDS=60 \
LOAD_FIXTURE_ENTITIES=50000 \
LOAD_START_DELAY_SECONDS=900 \
LOAD_EXTERNAL_TELEMETRY_ID=cloudwatch-run-id \
LOAD_SYSTEM_COST_PER_HOUR=12.50 \
LOAD_MAX_READ_P99_MS=100 \
LOAD_MAX_WRITE_P99_MS=150 \
LOAD_MAX_QUEUE_P99_MS=10 \
GARNET_COMMIT="$(git rev-parse HEAD)" \
npm run load:aws
```

Replace the example cost and latency budgets with the approved values for the deployment.

Useful controls are the same as the broker's Bun load runner, including `LOAD_PROFILE`,
`LOAD_WORKLOAD`, latency budgets, `LOAD_MAX_IN_FLIGHT`, and `LOAD_DATABASE_EVENT_DRAIN`. Every run
should use a new `LOAD_RUN_ID`; the deterministic S3 object set makes a missing generator report
an aggregate failure instead of silently reducing the measured load.

## Cost

Steady-state Fargate cost, us-east-1 on-demand ($0.04048 per vCPU-hour, $0.004445 per GB-hour), at the defaults in [architecture.ts](architecture.ts):

| Configuration | Tasks | Fargate compute |
| --- | --- | --- |
| Concentrated (1 vCPU / 4 GB, min 2 tasks) | 2 | ~$85/month |
| Distributed (8 services × min 2 tasks) | 16 | ~$680/month |

Plus, in both cases: ALB ~$16/month base plus LCUs, Aurora Serverless v2 from the configured minimum ACU, NAT gateway, VPC endpoints, and CloudWatch.

Blue/green runs a second task set, but **only for the bake window**, not continuously:

| Bake | Deploys/month | Extra cost (concentrated) |
| --- | --- | --- |
| 10 min | 4 | ~$0.08 (+0.1%) |
| 10 min | 20 | ~$0.39 (+0.5%) |
| 30 min | 20 | ~$1.17 (+1.4%) |

The compute cost of blue/green is therefore negligible. Two second-order effects matter more: double the task count means double the broker connection pools against Aurora for the bake duration, which can push ACU usage up; and the extra target group and listener add LCU capacity units. Neither changes the order of magnitude.

## Local development

```bash
npm install                # installs root + Lambda layer dependencies
npm run lint               # what CI gates on
npm run typecheck
npm test
npm run synth              # cdk synth, no AWS credentials needed
npm run audit:deploy       # advisories in code that reaches production
```

`npm run synth` needs no credentials, which makes it the fastest way to check an infrastructure change. Deploying does: `npx cdk deploy` with credentials for the target account.

## Setting up the pipeline

One-time, per AWS account:

1. **Create the OIDC provider** for `token.actions.githubusercontent.com` in the account (once per account).
2. **Create the deploy role** with a trust policy restricted to this repository, and ideally to the specific environment. Restrict the `sub` claim — a wildcard would let any branch in any repository assume it:
   ```
   "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:environment:prod"
   ```
3. **Grant the role permissions.** CDK deploys via CloudFormation; the simplest correct setup is to let it assume the CDK bootstrap roles rather than granting broad permissions directly. The post-deploy smoke test runs under the deploy role itself, so also grant it `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<region>:<account>:secret:garnet/secret/api-client-*`.
4. **Bootstrap CDK** in the account and region: `npx cdk bootstrap aws://<account>/<region>`.
5. **Create the GitHub Environments** (`dev`, `stage`, `prod`), add the variables from [Environments](#environments), and add required reviewers to `stage` and `prod`. The approval gate is configured on the Environment, not in the workflow.
6. **Protect `main`**: require the `CI` status check. It aggregates every CI job, so branch protection does not need updating when a job is added.

## Verification status

Blue/green and the circuit breaker were verified against a live deployment (concentrated architecture, `us-east-1`, Scorpio 6.0.10), not only through synthesis.

**Blue/green traffic shift.** On a deployment that changes the task definition, ECS starts a second task set and the ALB rules move in two distinct steps:

1. The **test listener rule flips first** — `:8080` points at the new task set while `:80` still serves 100% from the old one. This is the window in which a release can be validated before it takes production traffic.
2. Once the new set is healthy, the **production rule shifts** to it.

Observed on the production listener rule as weighted forward actions, sampled every 25s through a deployment:

```
:80 [blue=0 green=100]   :8080 [blue=0   green=100]   deploy=IN_PROGRESS
:80 [blue=0 green=100]   :8080 [blue=100 green=0]     deploy=IN_PROGRESS   <- test listener flipped
:80 [blue=100 green=0]   :8080 [blue=100 green=0]     deploy=IN_PROGRESS   <- production shifted
```

**Bake window.** During the bake the service ran **4 tasks for a desired count of 2** — both revisions alive at once, with two active deployments — then returned to 2 when the bake expired, ~10 minutes after the shift, matching `deployment_bake_time_minutes`. This is the behaviour the cost table above prices.

**Zero downtime.** 20 consecutive authenticated API requests spanning the shift all returned 200, and an entity written before the deployment was still readable afterwards.

**Circuit breaker.** A deployment pointed at a nonexistent image tag (`CannotPullContainerError`) was rolled back automatically: `ROLLBACK_IN_PROGRESS` ~11 minutes after the deployment started, then `ROLLBACK_SUCCESSFUL`, restoring the previous task definition revision. CloudFormation followed with `UPDATE_ROLLBACK_COMPLETE`. **Production served HTTP 200 at every poll throughout** — the failing task set never received traffic.

**End-to-end ingestion.** An entity sent to the ingestion queue was upserted through Lambda → broker → Aurora and read back through the API with its properties correctly normalized.

One reporting quirk worth knowing: `describe-services` and `describe-service-deployments` return **no** `strategy` or `bakeTimeInMinutes` field for a blue/green service, even though CloudFormation submitted `Strategy: BLUE_GREEN` and the behaviour above is unambiguously blue/green. Do not use those fields to confirm the strategy is active — check for the weighted forward action on the production listener rule, or for both revisions running during a deployment.

## Known limitations

Verified constraints, not speculation:

- **Blue/green is concentrated-only.** Explained above; enforced with a clear error.
- **Blue/green is unsafe for schema-changing releases.** Shared Aurora cluster.
- **Switching strategy changes resource topology.** The rolling path uses `ApplicationLoadBalancedFargateService`; blue/green builds the ALB explicitly, because that pattern does not accept a deployment strategy and attaches its target group as the listener default action rather than as a rule. Flipping the strategy on an existing stack replaces the load balancer, so the broker gets a new internal DNS name. Plan it like an architecture change, not a config tweak.
- **The blue/green test listener is not reachable from GitHub-hosted runners.** It is internal to the VPC by design, so the pipeline cannot exercise it without a runner inside the VPC.
- **Whether Scorpio tolerates two versions against one schema concurrently is an upstream property**, not something this framework controls. That assumption underpins the whole broker-tier design. The verification above used one Scorpio version on both task sets, so it does not test two Scorpio versions running concurrently.
- **A first deployment takes about 45 minutes**, dominated by Aurora, the RDS proxy target group, and the NAT gateway. Subsequent broker-only deployments take roughly 15-20 minutes including the bake.
- **`cdk destroy` does not remove everything.** The Aurora cluster has `DeletionPolicy: Snapshot`, so a final snapshot is retained and continues to bill; the data lake and Athena buckets are created by a custom resource that deliberately does not delete them. After tearing down a test environment, check for leftover snapshots (`aws rds describe-db-cluster-snapshots --snapshot-type manual`) and `garnet-datalake-*` buckets.
