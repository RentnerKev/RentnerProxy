# Durable DDNS automation

B2-03 (#232) adds controller-owned persistence, scheduling and recovery around the
[record synchronizer](ddns-record-sync.md). One instance configuration selects up to
100 records across its shared Cloudflare connections, with a common interval and
IPv4/IPv6 settings. It is independent of Caddy and Proxy Hosts. No separate cron,
container, database schema or migration is needed. The [DDNS web page and migration
workflow](ddns-migration.md) provide individual record inputs, a shared management
table, automatic inspection on save and live status at `/ddns` (#233).

## Activation and private API

DDNS is disabled on a fresh installation. Saving a connection or selecting a zone
does not activate it. Configuration also defaults to `enabled: false` when omitted.
Saving the first active record list or enabling a paused configuration permits DNS
writes after automatic server-side inspection. Editing a paused list keeps it paused.
Manual updates require an enabled configuration; previews remain read-only while
disabled or paused after restore.

All routes require the configured controller bearer, even on loopback, and return
`Cache-Control: no-store`. They are server-to-server APIs. The web boundary derives
the actor from its authenticated session and enforces `ddns.view`/`ddns.manage`,
the shared same-origin/CSRF middleware and user rate limits before delegation. It
automatically inspects newly managed/reactivated records and proxy changes, resolves
creation/adoption on the server and verifies the candidate before an atomic save.
The browser cannot substitute approved provider record IDs. Disabling/removing
records or changing only the interval does not depend on provider availability.
Legacy preview/save/enable handlers retain their encrypted approval contract.
Never expose the controller token to a browser. There is no public DDNS update URL.

| Method and path                                 | Purpose                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| `GET /internal/v1/ddns/config`                  | Configuration, revision and bounded current state         |
| `PUT /internal/v1/ddns/config`                  | Replace configuration with optimistic concurrency         |
| `POST /internal/v1/ddns/enable`                 | Explicit activation, including acknowledgement of restore |
| `POST /internal/v1/ddns/disable`                | Stop admission of future batches                          |
| `POST /internal/v1/ddns/sync`                   | Manually execute eligible saved targets                   |
| `POST /internal/v1/ddns/preview`                | Compare an explicit candidate batch without writes        |
| `GET /internal/v1/ddns/status`                  | Current configuration, per-target status and last run     |
| `GET /internal/v1/ddns/events?after=0&limit=64` | Bounded event source for later notifications              |

Example draft configuration with synthetic identifiers:

```json
{
    "expectedRevision": 0,
    "actorUserId": "0198d98a-0000-7000-8000-000000000002",
    "configuration": {
        "enabled": false,
        "intervalSeconds": 300,
        "updateOnStart": true,
        "ipv4": true,
        "ipv6": false,
        "targets": [
            {
                "id": "0198d98a-0000-7000-8000-000000000010",
                "connectionId": "0198d98a-0000-7000-8000-000000000001",
                "zoneId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "name": "example.com",
                "recordType": "A",
                "proxied": true,
                "enabled": true,
                "selection": { "mode": "create" }
            }
        ]
    }
}
```

Intervals are integer seconds from 60 to 86,400; `300` selects five minutes. A saved
draft may have no targets. First web activation requires an enabled family with a selected
target and `create`/`adopt` ownership for every active target. The global enabled
setting may remain on while all individual targets are disabled. Each target's
`enabled` defaults to true for older documents; no migration is needed. Disabled
targets trigger neither discovery nor provider calls and keep their last-good state,
references and transient retry floor across toggles and restarts. Preview
candidate records first and adopt existing records by their exact IDs. Stable target
IDs preserve ownership across retries and restarts. Unlisted records remain untouched;
disabling IPv6 leaves AAAA records alone.

Read `configuration.revision` from the response. Activation, deactivation and manual
sync accept only the following action body, using the current revision:

```json
{
    "expectedRevision": 1,
    "actorUserId": "0198d98a-0000-7000-8000-000000000002"
}
```

The draft-only B2-02 `sync` body containing arbitrary targets is replaced by this
saved-configuration action. Preview retains the B2-02 candidate batch body. Stale
revisions return `409` / `conflict`; overlaps return `409` / `busy`. Disabled or
restore-paused sync returns `409`. A deferred retry returns `429` / `retry_deferred`,
with `retryAfterSeconds` and a `Retry-After` header. Callers reload status and wait;
they must not blindly retry failed mutation requests.

## Scheduling and recovery

The worker checks due timestamps every five seconds while idle. It skips missed ticks
instead of replaying catch-up runs. Scheduled runs, recovery runs and manual sync use
the same admission gate and synchronizer. Configuration replacement and activation
cannot race an active run; previews share admission too. Manual updates can run ahead
of the regular interval, but cannot bypass provider cooldowns or transient retry
deadlines. A five-second manual admission floor also survives restarts.

With `updateOnStart: true`, activation and normal controller restart make healthy
targets due immediately. With it off, activation waits one interval and restart
retains the persisted schedule. Neither option bypasses an existing failure backoff,
provider cooldown or interrupted-run recovery delay.

Transient network/discovery/provider failures retry after approximately 30 seconds,
then 60, 120, 240 and 480 seconds, capped at 15 minutes, with small bounded jitter.
Provider `Retry-After` values can extend that delay, up to one day. A rate limit, or
a provider-unavailable response carrying `Retry-After`, pauses remaining records and
further batches; its reason and deadline survive restarts. Other targets retain their
individual successes and schedules.

Permission errors, missing/replaced records, conflicts and invalid selections are
permanent target failures: automatic retries stop for those targets. Their status
includes the safe error code and `permanentFailure`. Saving corrected configuration
or an explicit manual attempt can retry them. A changed Cloudflare connection revision
also re-arms affected permanent failures, so token rotation recovers without a controller
restart. Temporary missing credentials/connections retry with backoff. A connection
cannot be deleted, or lose a selected zone, while saved DDNS targets reference it,
including while automation is disabled. Remove the targets first.

## State, interruption and restore

The controller is the single writer of `ddns-automation.json` in its existing proxy
state directory. Atomic replacement and fsync precede network mutations. The document
is limited to 1 MiB, 100 target states and 64 events; invalid/unreadable state fails
closed. DDNS document I/O runs on the blocking pool, with a gate retained by each
blocking operation even if its HTTP caller disconnects. Tokens remain solely in the
encrypted connection registry. Consumer additions are reserved before the configuration
commit, with obsolete references released afterwards; startup reconciles leftover DDNS
reservations against the authoritative configuration while preserving DNS-01 consumers.

Status retains `lastRun`, each target's last result, consecutive failures, last successful
address/proxy flag, success/attempt timestamps, next attempt and a separate retry floor
retained while disabled. Failures never replace
last-known-good values with an unconfirmed desired address. Timestamps are Unix seconds
and `null` means absent. Events contain only bounded codes, actor IDs, counts and times;
pagination returns `latestSequence`, `oldestSequence` and `truncated` for lost history.

An in-flight marker is persisted before a run. Cancellation or a crash leaves it for
recovery: the next admission records `run_interrupted`, waits backoff and re-reads
provider state. An ambiguous creation is recognized by its stable ownership marker;
there is no blind write replay or automatic adoption of a replacement record. A failed
state commit invalidates the cache and requires reloading authoritative state before
admitting more work.

Disable persists immediately and removes all future attempts. An already admitted
batch may finish its bounded work (network budget 25 seconds); its result is retained
without scheduling another batch. Shutdown stops new admission, drains the owned worker
for up to 30 seconds and leaves interrupted-run recovery information if forced to stop.

The existing backup includes DDNS state. **Production restore writes
`ddns-restore-paused` into the staged controller directory before starting it.** Startup
then persists disabled state while retaining configuration and last-known-good values.
Normal restarts keep this pause. Saving a disabled draft does not acknowledge it; only
explicit activation removes the marker and clears `restorePaused`. A manual state copy
must likewise place this marker in the target state directory before starting the
controller. Copying raw state is not automatically detectable as a restore.

Controlled local HTTP fixtures and injected admission times verify periodic/manual
runs, restart, backoff, rate limits, partial failures, credential changes, cancellation,
reference recovery, disabled IPv6, paused restore and worker shutdown. No real DNS writes
or endurance tests are required for this implementation step.
