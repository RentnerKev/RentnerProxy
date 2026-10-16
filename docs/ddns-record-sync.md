# Cloudflare DDNS record synchronization

B2-02 (#231) provides the controller-owned, explicitly invoked record synchronizer.
It uses shared Cloudflare connections. Saving/testing a connection remains read-only.
There is no periodic job, saved DDNS configuration or DDNS management page in this
step; persistence/scheduling and the UI follow in #232 and #233. Starting the
controller or restoring a connection backup starts no DNS automation.

## Targets and explicit ownership

A batch contains 1–100 targets with stable UUIDv7 IDs, a connection ID, selected zone
ID, canonical full DNS name, type (`A`/`AAAA`), proxy flag and selection mode. Apex,
wildcard and individual names work across multiple zones independently of Proxy Hosts.
Names use lowercase ASCII/punycode; a wildcard is allowed only as the leading `*.`.

Only listed name/type pairs may change. Selecting `*.example.com` updates that literal
wildcard record, not every existing subdomain. An unselected `test.example.com` record
keeps its other IP. A selected Git record can receive IP updates with `proxied: false`;
switching off Cloudflare's proxy does not exclude it from DDNS.

- `inspect`: returns current state and whether adoption/creation is needed; sync skips
  this target without writes.
- `adopt`: explicitly identifies an existing `recordId`. A replaced/missing record,
  CNAME or duplicate record requires resolution; another record is never silently chosen.
- `create`: permits creation only when no matching record exists. New records use
  automatic TTL (`1`) and `rentnerproxy-ddns:<targetId>` comments. Replaying the same
  stable target recognizes its own creation, including after a lost acknowledgement.
  Existing unowned records require adoption. Other targets' DDNS markers cannot be taken over.

Updates PATCH only `content` and `proxied`. The controller does not rewrite existing
comments, tags or other fields; Cloudflare's own proxy/TTL rules still apply. No
deletion, renaming, type conversion or TXT update is implemented.

## Private API

`POST /internal/v1/ddns/preview` compares without DNS writes.
`POST /internal/v1/ddns/sync` executes explicit selections. Both require the configured
controller bearer token, including on loopback. Responses use `Cache-Control: no-store`.
Tokens stay inside the encrypted connection registry and are absent from bodies/results.

Example preview body with synthetic identifiers:

```json
{
    "actorUserId": "0198d98a-0000-7000-8000-000000000002",
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
            "selection": { "mode": "inspect" }
        }
    ]
}
```

An existing record appears as `current.id`, `current.address` and `current.proxied`.
After explicit adoption use `"selection": { "mode": "adopt", "recordId": "<current.id>" }`;
for a missing record use `"selection": { "mode": "create" }`. Preview those choices
before sync. Keep target IDs stable between runs. The caller retains target/ownership
choices in this step. Future durable consumers must register/release their connection
references when saved targets or scheduled jobs are introduced.

These are server-to-server APIs: callers derive `actorUserId` from their authenticated
user and enforce DDNS permissions/rate limits before delegation. An actor UUID alone
does not authorize access. The later web entrypoint must preserve that boundary.

Results distinguish `unchanged`, `updated`, `skipped` and `failed`. Preview also returns
`would_create`, `would_update`, `adoption_required` and `creation_required`. Each result
includes its target ID, optional current/desired address, safe error code and optional
`retryAfterSeconds`. One target's failure does not conceal other successes. Duplicate
IDs or zone/name/type pairs reject the entire batch before network access. A name
outside the selected zone fails individually before accessing provider records.

## Bounded operation and failures

Each needed/enabled IP family is discovered once per batch through HTTPS Cloudflare
trace on `1.1.1.1` / `2606:4700:4700::1111`. Discovery sends no bearer header, follows no
redirects or environment HTTP proxies, and rejects empty, malformed, duplicate,
wrong-family and non-public results. Public-unicast validation conservatively excludes
private, reserved, documentation and transition ranges. Disabled families are neither
discovered nor written; disabling IPv6 leaves existing AAAA records untouched.

Batches have a shared 25-second budget and a 128 KiB request limit. Discovery responses
are bounded to 4 KiB/three seconds; provider responses to 128 KiB/five seconds. Exact-name
record queries must be complete and unambiguous. Remaining targets are skipped when
the budget expires. There are no automatic mutation retries. Provider rate limits
pause the remaining batch and further manual runs for the bounded Retry-After duration
(one second when absent). Durable retry/restart state belongs to #232.

Only one preview/sync runs at a time; overlap returns `409` / `busy`. The registry lock
fences token rotation, zone removal and deletion during each record's complete
read/modify/verify sequence. These temporary leases persist no consumer references
or registry-format changes. Connections may change between manual runs; the next
request reports the corresponding per-target failure.

The engine re-reads the exact owner immediately before writing and verifies the
acknowledgement's ID, name, type, address and proxy flag. That check and the provider
write are separate requests, so external changes can still race the final check. Avoid
concurrent ownership of the same records. A timeout/invalid write acknowledgement is
`write_unconfirmed`, not a claim that Cloudflare rolled back. A later explicit sync
reads current state instead of blindly retrying creation or adopting a replacement.

Controlled local fixtures cover scope, untouched records, IPv4-only/dual-stack,
conflicts, adoption, idempotency, rate limits, partial failures, ambiguous writes,
deadlines, authorization and in-flight credential changes. Tests use no live tokens
or domains. No database schema/migration is needed. Complete #232 and #233 before
replacing a standalone DDNS container.

Provider contracts: [list](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/),
[edit](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/),
[create](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/),
[trace](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/).
