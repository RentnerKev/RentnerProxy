# Shared Cloudflare connections

The DNS connections page manages named, instance-owned Cloudflare API tokens and their
permitted zones. This is Beta 2 step B2-01 ([#230](https://github.com/RentnerKev/RentnerProxy/issues/230)).
It supplies the management and reference contract for later DNS consumers. Saving or testing
a connection only reads Cloudflare zone metadata; it does not change DNS records, start DDNS,
or convert existing certificates. The explicitly invoked DDNS record engine in B2-02
([#231](https://github.com/RentnerKev/RentnerProxy/issues/231)) is documented in
[DDNS record synchronization](ddns-record-sync.md). B2-03 adds
[durable DDNS automation](ddns-automation.md); its web UI follows in B2-04 (#233).

## Access and ownership

Open **DNS connections** in the application navigation. `dns_connections.view` allows reading
connection names, selected zones, revisions, creator IDs and consumer references.
`dns_connections.manage` allows creating, testing, editing and deleting connections. Neither
permission reveals a saved token. Management operations authorize themselves on the server;
hiding an action in the browser is not the authorization boundary.

Connections belong to the instance, rather than exclusively to their creator. The creator ID
records provenance. Owners and the built-in administrator role receive both permissions through
the existing authorization registry; viewers receive neither. Custom roles require an explicit
grant. Existing installations use the normal upgrade authorization-registry initialization;
this feature adds no database schema or independent startup synchronization mechanism.

## Create and select zones

1. Create a narrowly scoped Cloudflare API token. Grant **Zone / Zone / Read** for only the zones
   this connection should use. Future DNS-01/DDNS consumers also need **Zone / DNS / Edit** on
   their target zones. Use separate connections when different scopes are appropriate.
2. Choose **Add DNS connection**, enter a name and paste the token.
3. Choose **Test read access and load zones**. Select one or more returned zones, then save.

The test lists zones visible to the supplied token. Zone names come from Cloudflare; supplying
an arbitrary zone ID cannot add a zone outside that response. Every save repeats the provider
check against every selected ID. A read-only test cannot prove DNS-edit permission, and the
result explicitly records `dnsWriteVerified: false`. Cloudflare documents the
[zone listing API](https://developers.cloudflare.com/api/resources/zones/methods/list/) and
[token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

An instance supports 100 connections, with names up to 100 characters and 1–50 selected zones
per connection. Discovery is bounded to 500 accessible zones, 25 pages, a 64 KiB response per
page and a 20-second overall timeout. Scope a larger account's token to the needed zones.
The application also limits provider tests and saves to ten per user per minute. The API host
is fixed to Cloudflare; redirects and browser-supplied provider endpoints are not accepted.

## Edit, rotate and remove

Leave the token field blank when editing to retain the saved token. A replacement must pass
zone validation before it replaces the encrypted credential. Failed provider checks, denied
zones, unavailable encryption and failed persistence leave the previous configuration intact.
A Cloudflare-side revocation still makes that token unusable: keeping its configuration cannot
undo revocation. Enter and validate a replacement token to recover.

Updates and deletions require the revision opened by the editor. A stale revision is rejected;
discard the draft, reload and reopen the connection. Previous zone selections remain visible
after a replacement-token test and are checked again on save. The token field is cleared when
the editor closes or a save succeeds, and secret-bearing requests are kept out of Query and
Mutation caches.

Deletion is rejected while any registered consumer references the connection. Removing a
referenced zone is also rejected. The browser explains these restrictions and the controller
checks them again under the store lock. Remove the consumer reference through its owning
feature before removing the connection or zone.

## Consumer contract and certificate compatibility

A reference has this shape:

```json
{
    "connectionId": "0198d98a-0000-7000-8000-000000000001",
    "zoneId": "0123456789abcdef0123456789abcdef",
    "consumer": {
        "type": "ddns",
        "id": "0198d98a-0000-7000-8000-000000000002"
    }
}
```

Supported consumer tags are `dns01` and `ddns`; IDs are canonical UUIDv7 values. The authenticated
controller reference-validation endpoint checks the connection, selected zone and credential
decryption, returning only the reference, revision and zone metadata. This validates a stored
reference, rather than proving current provider access or reserving a consumer.

B2-01 does not attach consumers. Its persisted reference list is controller-owned and initially
empty; there is no public route to fabricate registrations. Each subsequent consumer must
register and release its actual references within the registry's persistence/locking boundary,
enforce its own permissions and verify provider access before DNS writes.

Existing DNS-01 request shapes, encrypted per-certificate credentials, renewal, TXT cleanup,
ACME accounts and candidate state remain unchanged. They continue to use their existing
single-zone token scope. Creating a shared connection neither binds it to an existing
certificate nor changes that certificate's token. Adoption by a new consumer is explicit;
there is no requirement to broaden an existing certificate token or convert it manually.

## Persistence, backups and restore

The controller stores `dns-connections.json` in its configured persistent state directory.
Registry version 1 contains connection metadata and an AES-256-GCM encrypted token per entry.
Tokens use the existing application encryption key, a fresh nonce and the associated-data
context `dns-connection:<connectionId>:v1`; legacy certificate contexts are unchanged. Files
use the existing private atomic state-file operations. Known malformed metadata or references
fail connection operations closed without blocking unrelated proxy or certificate operation.
Failed reads are retried on the next connection operation, so repairing an unreadable or
malformed registry before its first successful load does not require a controller restart.

Tokens, ciphertext and nonces are absent from ordinary reads, audit events, realtime events,
support reports and browser error messages. Audits use the existing `security-settings`
resource, the connection's target ID and the allowlisted `dnsConnections` changed field.
Successful controller changes are not retried or reported as failed because an audit store
is temporarily unavailable.

Full appliance backups include the registry in the controller-state archive and retain its
application encryption key. The current restore preflight validates the registry version,
metadata, encrypted envelope, unique identities, selected-zone references and token decryption
before replacing target state. Backup format v4 is unchanged. Old supported backups without
the file restore with an empty connection registry. Portable host configuration exports do
not include shared credentials or their references.

Restoring this passive registry starts no new external automation. DDNS restores stay
paused until explicitly enabled through the [review workflow](ddns-migration.md).
Future discovery/notification consumers must implement explicit reactivation too.
Keep a pre-upgrade backup for rollback. Beta 1 has no shared-connection UI or consumer support;
use the original Beta 1 backup, restore tooling and image for a rollback instead of expecting
it to operate Beta 2 connections. See [backup and recovery](operations.md#backup-and-recovery).
