# Release qualification deployment findings — 2026-09-26

## Scope

This ledger records Framework decisions and live evidence for the authenticated
public-ingress 10,000 current-Entity mutation qualification, restoration soak,
controlled landing, and the later 12,500–20,000 mutation-per-second
exploration.

## Findings and decisions

### RFQ-F001 — The deployed Framework tree needs a one-commit release candidate

The tested Framework tree was 18 commits ahead of current `github/main`.
Current `github/main` is already an ancestor. A fresh isolated worktree now
reproduces the complete tested tree exactly on that protected parent so the
eventual pull request can contain one ordinary candidate commit.

### RFQ-D001 — Rebind artifacts before the formal hour

The formal report must bind to a Broker image built from the new one-commit
Broker candidate and to a Framework assembly built from the new one-commit
Framework candidate. Reusing byte-identical executable layers is acceptable
only after image metadata, ECR manifest, task definitions, and the retained
report all point to the new candidate provenance.

### RFQ-F002 — The formal runner and public authorizer disagree

The load task uses renewable `SigV4-STS` credentials for the internal Broker.
The formal plan selects the public API endpoint without changing that auth
mode. The deployed API has one JWT authorizer on `ANY /{proxy+}`, so the formal
task cannot pass API Gateway authentication.

### RFQ-D002 — Preserve JWT and keep credentials out of overrides

Do not add an unauthenticated or SigV4-only public route, and do not pass a
Bearer credential through ECS task overrides. Add a renewable OIDC client path
only if its secret can be delivered through Secrets Manager, its token can be
refreshed for the complete hour, and its subject can be granted the exact
default-tenant mutation policy without broadening ordinary callers.

### RFQ-F003 — The existing public client can refresh a one-hour ID token

The deployed Cognito app client is public, supports
`ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`, and issues 60-minute
ID tokens for the audience already enforced by API Gateway and Broker.

### RFQ-D003 — Use one temporary least-privilege qualification user

Create a dedicated Cognito user and a generated Secrets Manager secret outside
the candidate source. Configure the load task by secret ARN, inject username
and password as ECS secrets, and configure the load harness for renewable
`cognito-oidc` authentication.

Bind the temporary OIDC subject only to `TenantEntityEditor` and
`TenantReadOnly` for the default tenant. Do not grant administrator,
subscription, federation, or notification permissions. After qualification
and exploration, redeploy without the optional subject and secret, verify the
original authorization digest is restored, then delete the temporary user and
secret.

### RFQ-D004 — Make authenticated load an explicit deployment triple

The Framework accepts the qualification secret ARN, exact OIDC subject, and
client ID only as an all-or-none optional triple. The deploy composite action
and every CD environment pass the same three optional variables. Omitting all
three preserves the existing task-role SigV4 path. Supplying the triple changes
the load task to Cognito OIDC, injects only the secret JSON keys through ECS,
adds the temporary tenant grant, and therefore changes the canonical
authorization digest.

### RFQ-E001 — Candidate validation is green

On 2026-09-26, `npm run lint` completed with zero errors and nine existing
non-blocking warnings, `npm run typecheck` passed, and
`npm test -- --ci --runInBand` passed all 137 tests in 28 suites. Focused
synthesis verifies the OIDC mode, exact endpoint and client, absence of the
SigV4 generator settings, Secrets Manager username/password references, and
only `TenantReadOnly` plus `TenantEntityEditor` attachments for the temporary
subject. It also verifies that the stopped cutover assembly affects exactly
five services, leaves federation, lake sink, and snapshot running, and gives
exactly five scalable targets a zero minimum.

### RFQ-F004 — One pre-deployment image was rejected by provenance review

The first locally published Broker manifest had the required single-platform
ARM64 OCI shape, but its OCI revision label did not equal the candidate commit.
It was never configured or deployed. Its ECR tag was deleted immediately.
The corrected publish derives the full revision directly from
`git rev-parse HEAD`; both corrected Broker and load manifests have complete
zero-finding ECR scans and exact revision labels.

### RFQ-D005 — Use a fully stopped authorization cutover

The environment-specific cutover will suspend Application Auto Scaling for the
API, matcher, notification scheduler, delivery worker, and Subscription
reconciler. API desired count goes to zero first, which drains both public and
internal ALB admission. The periodic scheduler and Subscription reconciler
then stop gracefully so they cannot create new work. Matcher must report zero
pending partitions, zero oldest-pending age, matched claimed/completed totals,
and no error increments before it stops. Delivery must report zero active work,
matched claimed/completed totals, and no error increments before it stops.

The candidate assembly is deployed only while all five services have zero
running and pending tasks. If the synthesized services declare a nonzero
desired count, the cutover will use a reviewed zero-desired assembly for the
replacement and a second reviewed assembly to restart workers before API.
After restart, require allowed and denied OIDC Entity operations, worker
health, the exact new authorization digest, and healthy private API targets
before public admission is considered reopened.

### RFQ-D006 — Add a runbook-only stopped assembly control

The candidate now accepts
`GARNET_AUTHORIZATION_CUTOVER_STOPPED=true`. It changes desired count and
Application Auto Scaling minimum to zero for exactly the API, matcher,
notification scheduler, delivery worker, and Subscription reconciler. It does
not alter authorization contents, bypass the deployment guard, stop the
federation, lake-sink, or snapshot services, or remain enabled in the committed
normal profile.

This closes the ordering gap in RFQ-D005: the changed task definitions can be
deployed while every authorization executor is guaranteed stopped. Operators
then start workers and API in order under suspended scaling, validate the new
generation, and deploy the identical normal assembly with the control disabled
to restore declared minima.

### RFQ-F005 — Blue/green lifecycle validation cannot run at zero API tasks

The first stopped-assembly deployment kept every authorization executor at
zero and replaced the worker task definitions, but ECS invoked the API
`POST_TEST_TRAFFIC_SHIFT` hook even though the stopped assembly intentionally
had no API target. The hook could not validate a target and ECS rolled the
deployment back. No candidate API task served traffic, and the runbook
continues to enforce zero desired count through rollback.

### RFQ-D007 — Keep stopped API deployment hook-free

The stopped assembly omits the alternate target and lifecycle hook and
explicitly disables deployment alarms on the zero-count API service. It uses
an ordinary zero-count rolling service only for the stopped assembly. Restoring
`GARNET_AUTHORIZATION_CUTOVER_STOPPED=false` restores the reviewed blue/green
target, hook, alarms, and bake controls before public admission is reopened.
