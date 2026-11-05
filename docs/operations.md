# Operations

## Runtime dependency maintenance

The web runtime stages remove build tools and their native platform packages after
the frozen production install. Application runtime packages remain installed.
Both custom Caddy builds use the pinned 2.11.7 builder, Go 1.27.2 and CrowdSec SDK v1.8.1,
while retaining the verified HTTP-only community bouncer source revision.
The source transform also adapts its live decision IP filter to the SDK's string
field without changing exact-match filtering.
The appliance updates its inherited PCRE2 package from the configured Debian
repositories and rejects builds below `10.46-1~deb13u3`.
CrowdSec and cscli are rebuilt from the pinned upstream 1.8.1 source archive
using the full upstream static feature profile and RE2 2023-03-01. Reviewed,
read-only module locks update gRPC to 1.84.0 and `golang.org/x/crypto` to 0.58.0;
the build verifies both binaries' embedded dependency versions. The official
image continues to supply configuration and the pinned Hub assets.
The [engine build sources](../docker/crowdsec/tooling/engine-build/)
record the remaining build and compatibility constraints. Axum 0.8.9 also
requires its exact matchit 0.8.4 dependency; the current stable dependency
refresh retains these upstream constraints.
These updates do not establish that an image passes the complete dependency
assessment; unresolved findings continue to block publication.

## CrowdSec

- **Managed:** local detection and blocking work without a CrowdSec account; community intelligence and Console enrollment are separate opt-ins.
- **External:** connect an existing CrowdSec Local API with a bouncer key.
- **Disabled:** default; existing traffic behavior is unchanged.
- Flags use a bundled country-only MMDB. A mounted GeoLite2 Country file can be selected with the optional `RENTNERPROXY_GEOIP_COUNTRY_DB_PATH` (absolute path; maintain its license and updates).
- Enforcement is fail-open when the selected Local API is unavailable.
- Repository backup v4 includes the managed CrowdSec SQLite database, decisions, local API registration, optional Central API/Console credentials and managed bouncer key. External CrowdSec configuration and its encrypted credential are in PostgreSQL; the external LAPI remains operator owned.

## DNS-01 certificates

Manual and delegated DNS-01 are available in the `main` development line for Beta 3.
The published `v1.0.0-beta.2` release supports HTTP-01 and direct Cloudflare DNS-01;
it does not contain these new modes or the guided DNS setup. Use instructions matching
your installed version. The examples below use reserved example domains; substitute
domains and DNS zones you control.

### Choose a validation method

Open **Certificates**, choose **Request with ACME**, enter the certificate domains and
select a DNS-01 method. Wildcards require DNS-01. Include both `example.com` and
`*.example.com` if the certificate must cover the apex and its immediate subdomains.
Choose the staging ACME environment when testing setup; staging certificates are not
trusted by browsers. Request a production certificate after the staging flow works.

| Method                 | DNS access required                                                                                   | Renewal                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Provider API**       | A verified connection to a supported provider covering every certificate domain in the selected zone. | Unattended while the connection and DNS remain usable.                           |
| **Manual TXT records** | Permission to publish TXT records at your DNS provider; no provider API integration is needed.        | Operator action whenever the CA requires fresh DNS proofs.                       |
| **Delegated DNS zone** | A permanent CNAME or NS delegation and a verified API connection for its target zone.                 | Unattended after setup while delegation and the target connection remain usable. |

Manual DNS-01 still requests and renews an ACME certificate. **Import certificate**
instead accepts certificate/key files obtained elsewhere and requires replacement
uploads. DNS-01 does not require inbound port 80, but the controller needs outbound
access to the CA, DNS resolvers and, for automated modes, the provider API. Public
DNS must expose the proof to the CA even when the protected service is private.

Certificate operators need permission to view certificates and issue or renew them,
as appropriate. A provider administrator can prepare the shared connection separately
in **Providers**. A host operator without certificate permissions must hand a pending
manual challenge to a certificate operator through its certificate details.

### Prepare an automated provider connection

In **Providers**, add a named DNS connection, enter its API token, use **Test read access
and load zones**, and select the permitted zones. This test only discovers readable
zones. Saving new credentials and **Recheck** create and remove a temporary TXT record
in each selected zone to verify write and cleanup permissions. Wait for **Connected**
before selecting the connection and zone in the certificate request.

| Supported target provider | Required access                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare                | Zone discovery/read and DNS edit access scoped to the selected zones.                                                                                                       |
| deSEC                     | Domain discovery and RRset read/write access for the selected zones, including the TXT records used for permission verification.                                            |
| Hetzner Cloud DNS         | A Read & Write API token from the current Hetzner Console project containing the PRIMARY zone. Old standalone DNS Console tokens are unsupported; access is project scoped. |

Restrict credentials to the validation zones where the provider allows it. Tokens are
stored encrypted and are not displayed again. To rotate a token, edit the connection,
enter the replacement and save to verify it. Leaving the token field blank retains
the saved token. Keep the old credential usable until pending operations and cleanup
have settled. Connections and selected zones in use cannot be removed until their
consumer references are removed.

In the request guide, **Check saved connection and zone** checks the verified saved
connection and zone coverage. It does not create a TXT proof or confirm propagation
of a future proof. This differs from the write/cleanup verification in **Providers**.

### Issue with manual TXT records

1. Select **Manual TXT records**, confirm the domains and ACME environment, then choose
   **Set up TXT records**. This starts a real ACME order and loads its exact proofs.
   Closing the guide does not cancel that order.
2. At your DNS provider, create every displayed TXT owner/value pair. Use the separate
   copy controls for the owner and value; check the affected identifier and expiry.
   Some providers append the zone name automatically: enter the relative name or full
   name they require so the final DNS name exactly matches the displayed owner.
3. Keep every required value when several identifiers share an owner. For example,
   `example.com` and `*.example.com` both use `_acme-challenge.example.com` and may need
   two separate TXT values. Add both values to that owner's TXT record set; do not
   join them into one value or replace unrelated values. Use the actual values from
   the current order, never values from an example or a previous order.
4. Save DNS changes and allow time for DNS caches, including cached missing answers,
   to expire. **Check public DNS (read only)** reports whether all current values are
   visible. It does not continue the order or ask the CA to validate it.
5. Select **Done**, then **Request with ACME** in the original dialog to continue the
   prepared order. Alternatively, reopen its certificate **Details** and choose
   **Check DNS and continue**. Continuation checks propagation again before CA validation.
   If the CA reused an existing authorization, the guide reports that no TXT is needed.
6. Follow the current operation through DNS checking, CA validation, finalization and
   activation. A DNS check or accepted continuation alone does not mean a certificate
   has been issued or activated. Confirm the active certificate and host assignment.
7. After completion, cancellation, expiry or terminal failure, remove only this order's
   exact TXT values using the cleanup guidance in **Details**. Manual mode does not
   delete DNS records for you. Preserve other orders' values and unrelated records.

The pending order, proofs and operator waiting state are durable. Waiting for an
operator is expected and releases the active ACME worker slot. Reopen **Details** after
closing the browser or restarting the controller; do not create duplicate requests
just because an order is waiting. The displayed expiry limits how long its proofs
can be used.

### Delegate validation for unattended renewal

Create the target zone at Cloudflare, deSEC or Hetzner Cloud DNS and prepare its verified
connection as above. The provider must actually host that zone and allow TXT creation
and cleanup there. The original domain can stay at another DNS provider. Delegation
routes validation queries; the target provider API performs the TXT updates.

Select **Delegated DNS zone**, choose the target connection and zone, and use the guide
to configure each original `_acme-challenge` owner. Certificate names remain the
original names, such as `example.com` and `*.example.com`; the validation target does
not become a certificate name.

For **CNAME**, enter a target name inside the selected validation zone. For example,
with target zone `validation.example.net`, publish this record in the authoritative
DNS for `example.com`:

```dns
_acme-challenge.example.com. IN CNAME acme.validation.example.net.
```

RentnerProxy writes temporary TXT values at `acme.validation.example.net` through
the target connection. Publish a delegation for every distinct challenge owner shown
by the guide; the apex and wildcard above share one owner. Keep the CNAME permanently
for future renewals. A CNAME owner cannot also contain TXT or NS records; coordinate
any existing validation clients before changing their records. Do not create loops,
multiple CNAME targets or a target outside the selected zone.

For **NS**, the selected provider zone must be exactly the original challenge owner,
for example `_acme-challenge.example.com`. The provider must support hosting this
separate zone. Run **Check public DNS (read only)** to load its provider-assigned
name servers, then copy every displayed NS owner/value into the parent zone's DNS.
Use the provider-assigned servers, not invented server names or the parent zone's
servers. The API writes TXT at the delegated zone apex. The guided NS setup requires
all requested identifiers to share that challenge owner; use CNAME delegation or
separate requests for distinct owners. Delegate the challenge name only, leaving the
site's A/AAAA records and domain-wide name servers in place.

After publishing the records, repeat **Check public DNS (read only)** until the guide
reports **Ready**, then choose **Request with ACME**. Setup checks do not start an order
or modify DNS. Actual issuance resolves the delegation again, writes all required
TXT values, checks their visibility through the original owner and only then asks
the CA to validate. Successful issuance and scheduled renewal clean up their own
TXT values while preserving foreign values and your permanent CNAME/NS delegation.

### Renewal, failures and recovery

For manual mode, enable a notification channel subscribed to **Certificate renewal**
in your notification settings and check its delivery status. When a renewal requires
fresh proofs, an action-required notification points the operator to the certificate;
open **Details**, publish the new values and choose **Check DNS and continue** before
the order and active certificate expire. Notifications do not publish records.
The previous active certificate remains installed during renewal, but it can still
expire if nobody completes the challenge. Manual mode cannot promise unattended renewal.

Delegated mode uses scheduled renewal without human TXT entry while its delegation,
verified provider connection and API permissions remain valid. Keep the permanent
delegation and monitor renewal errors and certificate expiry in either mode.

| Status or problem                                             | Operator action                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Waiting for your TXT records** / TXT values pending         | Check every exact owner and value, including shared-owner values and provider-added domain suffixes. Wait for cached answers to expire, run the read-only check, then continue the current order.                                                                                        |
| Delegation missing or not propagated                          | Publish all CNAME/NS records shown by the guide at the original owners. Confirm their targets and wait for DNS caches before checking again.                                                                                                                                             |
| Conflicting or invalid delegation                             | Correct loops, multiple targets, mixed CNAME/NS/TXT at a CNAME owner, or an out-of-zone target. For NS, select the exact challenge zone and its assigned servers.                                                                                                                        |
| DNS lookup failed / name servers unavailable                  | Check DNS resolution from the controller, the zone's authoritative service and the provider connection. Retry the check after correcting the cause.                                                                                                                                      |
| Provider unavailable, unauthorized or credentials unavailable | Restore API access and the required zone permissions, then verify the saved connection in **Providers**. Do not repeatedly start new ACME orders.                                                                                                                                        |
| Proof expired, order invalid, or stale action rejected        | Reload **Details** and inspect the current operation. An expired or invalid order needs a new request or renewal and fresh values; an old tab cannot continue a replaced challenge set.                                                                                                  |
| DNS cleanup pending                                           | Restore provider access and let cleanup retry before another ACME attempt. Cleanup retains the original target identity even if delegation changed. Preserve the provider zone, credentials and operation state; do not clear state files or delete a whole TXT record set to bypass it. |
| Issued candidate pending activation                           | Check controller/runtime health and use **Retry activation** where offered. Resolve activation separately from DNS; the previous active certificate remains installed until successful activation.                                                                                       |

The guide's DNS observations use the controller's configured recursive resolver and
bounded queries. **Ready** is a point-in-time observation, not proof that every public
resolver or the CA sees the same answer. Recheck after changing domains, the target
zone, credentials or delegation; the issuance/continuation path performs its own checks.

Use **Cancel validation** for a waiting manual challenge if abandoning it, then remove
only its displayed TXT values. Delegated **Cancel issuance** is available during the
early operation stages; once finalization starts it is disabled. Wait for cancellation
and cleanup to settle. Cancellation preserves an existing active certificate. Cancelling
a delegated renewal pauses scheduled attempts for 30 minutes; it does not permanently
disable automatic renewal. Cancelled initial issuance needs an explicit new request.

After a controller restart, reopen **Details** to inspect the recovered operation.
Waiting manual orders retain the same proofs until expiry; an interrupted DNS check
can return to operator confirmation. Delegated cleanup/retry state is durable and
recovers without replaying old proofs as a new order. Use the complete supported
[backup and recovery](#backup-and-recovery) procedure to retain certificate state,
ACME accounts, encrypted provider credentials and encryption material together.
External DNS records are not restored by an appliance backup, and the CA's clock and
order expiry keep advancing while the appliance is offline. Verify current DNS and
order validity after restore; never copy isolated state files to revive an old order.

For the DNS protocol background, see
[Let's Encrypt's challenge documentation](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge)
and [ACME DNS-01 in RFC 8555](https://www.rfc-editor.org/rfc/rfc8555.html#section-8.4).

## Basic Auth

Create an Access Policy, choose **Authenticated** and **Basic Auth**, enter a username and password, and save. The policy and its first account are saved together and applied automatically. Select the policy on the proxy host and save the host to require these credentials when visiting the site. If the controller is unavailable, the UI reports that applying the saved configuration is still pending. Use **Credentials** in the policy list to change credentials or add more accounts. Passwords are stored as Argon2id hashes and are never returned to the browser. Use HTTPS on protected hosts.

## Forward Auth

Forward Auth is configured inside an existing Access Policy. Choose a provider preset, enter its full HTTP or HTTPS check endpoint, and select the request credentials and identity response headers needed by that provider. Basic Auth and Forward Auth are mutually exclusive in one policy. An IP rule can be combined with Forward Auth only when **all** checks must pass. The auth check is fail closed: a denied response or unreachable gateway never grants access to the protected upstream. HTTPS auth gateways use normal certificate verification; the endpoint cannot contain credentials or a query string.

Provider reachability is not measured by the Security Dashboard; it reports configured policy counts and settings only.

## Default Site

Open **Operations** in the main navigation to choose the Default Site response for the server's IP address or a hostname
with no active Proxy Host or Redirect Host. Existing installations keep the empty HTTP 404 response
until an administrator saves another mode. Owners and administrators have the dedicated
`default_site.view` and `default_site.update` permissions; saving also requires `proxy_hosts.apply`.
Custom roles may receive these permissions through role management.

| Mode             | Unmatched request behavior                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| 404              | HTTP 404, preserving the existing default.                                                              |
| Welcome page     | Built-in RentnerProxy HTML page, HTTP 200.                                                              |
| Close connection | Caddy aborts the connection without an HTTP response. No HTTP 444 is sent.                              |
| Redirect         | HTTP 302 to the exact configured absolute HTTP/HTTPS URL; the incoming path and query are not appended. |
| Custom HTML      | The saved HTML, HTTP 200 with `Content-Type: text/html; charset=utf-8`.                                 |

Custom HTML is limited to 256 KiB of UTF-8 text. Edit it as source on the Operations page; it is never rendered
inside the management UI. The public page uses a sandboxed Content Security Policy: scripts,
forms, frames and navigation privileges are disabled; inline styles and HTTP/HTTPS/data images
are allowed. Caddy placeholders, including `{env.*}` and `{file.*}`, are served literally.
Redirect targets reject credentials, control characters and unsupported URL schemes. HTML and
redirect responses disable caching. The close mode follows Caddy's
[abort behavior](https://caddyserver.com/docs/caddyfile/directives/abort), which also interrupts
other active HTTP streams on the same connection.

For HTTP, point the hostname's DNS record at the server or open its IP address on the published
HTTP port. Existing hosts, redirects and access policies take precedence; ACME challenge handling
and the separate management endpoint remain in their existing routing paths.

HTTPS requires a successful TLS handshake before any Default Site response can be delivered.
This setting does not request a certificate, add a default certificate, enable on-demand TLS or
expand the configured SNI policies. The HTTPS listener exists only when a configured host has
certificate material. Unknown names and IP addresses normally fail the handshake, and a Host/SNI
mismatch is still rejected. A Default Site selection cannot solve these certificate limitations;
configure a host and a suitable certificate when visitors need HTTPS for that address.

The selected mode and custom HTML are durable PostgreSQL settings, included in the supported
appliance backup/restore. The controller also persists the active snapshot for restart recovery.
Saving reports when runtime application is pending; the existing reconciliation worker retries
automatically. Reload Operations after a configuration conflict before saving another edit.
Portable host configuration exports do not include these global settings.

## Upgrades

Beta 2 and later supported betas require Beta 1 (`v1.0.0-beta.1`) or a newer
supported beta as their upgrade source. The compatibility workflow tests a fresh
installation and the immutable published Beta 1 image against the candidate.

Before each upgrade, create a backup with the source release's own tools and keep
its exact image reference, Compose configuration, deployment environment and
encryption material. Change the image only after the backup completes. Preserve
the existing volume and verify health, proxy traffic, certificates, permissions
and configuration reconciliation after startup.

For an Alpha installation, first select
`ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1`, complete its startup and
reconciliation, verify the installation and create a new v4 backup. Then select
the intended beta image. Do not use the moving `:beta` tag for the intermediate
step. Alpha v3 backups must first be restored into Beta 1 with that pinned
release's restore tools, then backed up again as v4 before proceeding.

Direct Alpha upgrades, direct v3 restores and import of old environment-file
secrets are unsupported from Beta 2 onward. Existing installations must retain
their persistent `bootstrap/secrets-v1.json`; missing secret state stops startup
instead of generating replacement keys. A Beta 1 start does not guarantee that
every certificate state file has been rewritten, so the existing Beta 1
certificate-reader compatibility remains available.

For rollback, use the pre-upgrade backup, the exact source image and source
release's restore tools on a fresh volume. Do not run an old image against the
upgraded database.

## Backup and recovery

Run `bun run backup:production -- --project <project> --output <directory>` with the current checkout and the deployment's Compose environment. The appliance is stopped while PostgreSQL, controller/certificate state, the application encryption key and managed CrowdSec state are captured together, then restarted. Keep the completed backup directory outside the appliance volume. Its manifest records SHA-256 checksums, the source image identity, public origin and trusted proxy CIDRs; the directory is private (0700) and its files are 0600 on Linux. Checksums detect corruption, so retain backups in trusted storage.

Restore with `bun run restore:production -- --project <project> --input <backup> --confirm-replace`. Restore validates the complete manifest and immutable copies of every artifact before stopping the target. It rejects unsafe archive members, incompatible migration history, corrupted databases and application keys that cannot decrypt persisted secrets. Archive extraction uses private staging directories and repairs ownership before startup. The restored desired configuration is reconciled by the controller; verify the appliance health and actual proxy traffic before accepting recovery.

Controller restart recovery requires the active policy snapshot and its matching `active-proxy-snapshot-authority-v1` file, with no pending activation marker. Confirmed configurations remain recoverable while the web service is offline. On the first startup after upgrading a build that predates this protocol, cached routes wait for the web service to reapply desired configuration. Complete controller backups retain the snapshot, authority file and pending marker together; do not restore or copy the snapshot alone.

Supported restore sources are v4 backups with a nonempty database history that exactly matches a prefix of the target's migration history. Each recorded migration must have the same position, SHA-256 hash and timestamp; empty, newer or divergent histories are rejected before replacing target data. A supported Beta 1 backup can therefore restore into a later target whose history only appends migrations. The restored database is brought up to the target version by its existing startup process; this compatibility check does not run migrations. The [release compatibility matrix](../.github/scripts/ci/release-compatibility/run.ts) creates a backup with the pinned Beta 1 release's own tools, verifies a fresh-volume target restore and exact-source fresh-volume rollback. Formats v1/v2/v3, unlisted source releases and downgrades are unsupported; changing a manifest version does not make a backup compatible. Use the Beta 1 intermediate step above for Alpha v3 archives.

Keep the Compose file, image tag/digest, port mappings and deployment environment alongside the backup, including SMTP credentials, canonical public origin and trusted proxy CIDRs. Environment secrets are deliberately absent from the manifest. A v4 restore checks the origin and CIDRs against the target. Use `--allow-deployment-change` for an intentional environment change only after reviewing authentication, forwarded-client trust and external integration reachability.

Valkey challenge/rate-limit/realtime state, request logs, sockets, PID files, locks, temporary files and supervisor status/staging are excluded. Cache-backed flows restart after restore; durable users, sessions, roles, permissions, policies, Basic Auth, Forward Auth, importer history, hosts, redirects, CAs, certificate jobs/events/retries, candidates, ACME accounts and encrypted DNS credentials remain in PostgreSQL/controller state. Backup v4 retains its historical `redis: "excluded"` manifest field for compatibility; it describes the transient cache exclusion for both engines. CrowdSec's SQLite WAL is retained when present, while its shared-memory file is regenerated. Managed startup re-registers the bouncer with a private key and preserves detections and registrations; the LAPI remains bound to loopback.

If restore is interrupted after replacement begins, the persistent journal prevents startup with partially restored state. Stop the appliance if it was manually started and rerun the same backup with `--resume --confirm-replace`. Resume validates that backup again and repeats all replacement steps. Another backup is rejected while the journal is pending. A failure before replacement leaves the running target intact; no automatic destructive retry is attempted. For rollback, use a fresh volume, the pre-upgrade source backup, that source release's restore tools and its exact image digest.

## Dependency advisory gates

`Deployed Dependency Security` audits RentnerProxy's complete locked Cargo and
Bun graphs on PRs and main pushes. All RustSec vulnerabilities and Bun advisories
at moderate severity or above block the check. Missing, malformed, inconsistent
or incomplete own-dependency evidence also fails.

Debian, PostgreSQL, Valkey, Caddy, CrowdSec, cscli and their Go modules are outside
this advisory assessment. Separate Syft, Grype, govulncheck and historical release
scans are removed. Upstream images/packages remain managed dependencies; tests
still cover RentnerProxy's configuration and integration with them. A green gate
confirms only the own Cargo/Bun scope.

Image assessment extracts embedded lock data from a stopped container without
starting the appliance. The exact Cargo lock and web package manifest/Bun lock
must be present; there is no historical source-lock fallback.

Bun audits retain unfiltered JSON, raw exit status, stderr diagnostics and
lock/manifest checksums. Only copied manifests and lockfiles run in an isolated
temporary workspace, preventing package-manager dotenv loading from importing
deployment configuration. Transport errors, skipped registries and invalid or
inconsistent entries fail. Cargo keeps database fetching and crates.io index
refresh enabled, records lock checksum/RustSec Git revision and validates
database metadata against that revision. Index errors, yanked/advisory warnings
and null metadata fail even when the scanner exits zero. RustSec must be fetched
within 48 hours and its last commit within seven days.

PR/main candidates are isolated production OCI archives. Dev and release builders
have read-only repository permissions and no publishing token. They record exact
source commit, OCI index digest and archive checksum, retaining SBOM/provenance.
A separate trusted publisher verifies the checksum and repeats the own-dependency
assessment before registry login. Only a fresh `own-dependencies-approved` record
with scope `rentnerproxy-locked-cargo-and-bun`,
`externalRuntimePolicy: informational` and the exact source/digest permits
publication. The policy marker describes components outside the gate; it does
not imply upstream scanners run. Legacy full-image approvals and old Dev waivers
are rejected. Every channel uses the same scope. The publisher copies with
`skopeo --all --preserve-digests` and verifies each tag's digest.

The daily 04:17 UTC rescan and manual runs resolve only `:dev` once to an immutable
digest. Own Cargo/Bun findings block it. Invalid identities, missing embedded locks
and incomplete audits fail. PRs changing scanner integration also run this Dev
rescan. The daily run builds no image and scans no historical releases.

`rescan-summary.md` records the Dev source revision, digest and result in the
artifact and job summary. Blocked records remain evidence and cannot authorize
publication. Rerunning a scan cannot patch an immutable image; an update requires
publishing a newly assessed replacement. Evidence artifacts are retained for
30 days.

Cargo uses locked `cargo-audit 0.22.2`; image helpers require `skopeo`.
Required-tool installation failures fail the assessment. See
[the workflow overview](../.github/WORKFLOWS.md) for ownership and required checks.
